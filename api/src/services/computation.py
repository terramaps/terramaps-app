"""Computation service for geometry roll-ups."""

import logging
from typing import Annotated

from fastapi import Depends
from sqlalchemy import delete, select, text

from src.app.database import DatabaseSession
from src.models.cache import MvtTileCacheModel
from src.models.graph import LayerModel, NodeModel
from src.services.base import BaseService

logger = logging.getLogger(__name__)


class ComputationService(BaseService):
    """Recompute pre-baked node geometry and invalidate the MVT tile cache."""

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def recompute_from(self, affected_node_ids: set[int]) -> None:
        """Recompute geometry for the given nodes and all their ancestors.

        Walks upward layer by layer until no parents remain, then invalidates
        the MVT tile cache for every layer touched.
        Call before db.commit() so everything lands in one transaction.
        """
        current_ids = set(affected_node_ids)
        while current_ids:
            order_groups = self._get_layer_order_groups(current_ids)
            for order, (layer_id, ids) in sorted(order_groups.items()):
                if order == 1:
                    self._recompute_zip_layer(ids)
                else:
                    self._recompute_node_layer(ids)
                self._invalidate_tiles_for_nodes(layer_id, ids)
            current_ids = self._get_parent_ids(current_ids)

    def recompute_all_layers(self, map_id: str) -> list[LayerModel]:
        """Full geometry recompute for every order>=1 layer in a map, bottom to top.

        Used by the import task. Wipes the entire tile cache for each layer
        since every node is being computed from scratch.
        Returns the layer list in case the caller needs it.
        """
        layers = list(
            self.db.execute(
                select(LayerModel)
                .where(LayerModel.map_id == map_id, LayerModel.order >= 1)
                .order_by(LayerModel.order.asc())
            )
            .scalars()
            .all()
        )
        for layer in layers:
            node_ids = set(
                self.db.execute(select(NodeModel.id).where(NodeModel.layer_id == layer.id)).scalars().all()
            )
            if node_ids:
                if layer.order == 1:
                    self._recompute_zip_layer(node_ids)
                else:
                    self._recompute_node_layer(node_ids)

        layer_ids = {layer.id for layer in layers}
        self.invalidate_cache_for_layers(layer_ids)
        return layers

    # ------------------------------------------------------------------
    # Geometry helpers
    # ------------------------------------------------------------------

    def _recompute_zip_layer(self, node_ids: set[int]) -> None:
        """Set geometry on order=1 nodes (territories) by unioning their assigned zips.

        Each zoom column on geography_zip_codes is already pre-simplified, so we
        union them directly into the matching column on the territory node.
        LEFT JOIN means a territory with no zips gets NULL geometry.
        """
        sql = text("""
            WITH zip_unions AS (
                SELECT za.parent_node_id AS pid,
                       ST_UnaryUnion(ST_Collect(gz.geom_z3))  AS g3,
                       ST_UnaryUnion(ST_Collect(gz.geom_z7))  AS g7,
                       ST_UnaryUnion(ST_Collect(gz.geom_z11)) AS g11
                FROM zip_assignments za
                JOIN geography_zip_codes gz ON gz.zip_code = za.zip_code
                WHERE za.parent_node_id = ANY(:node_ids)
                GROUP BY za.parent_node_id
            ), affected AS (
                SELECT id FROM nodes WHERE id = ANY(:node_ids)
            )
            UPDATE nodes p
            SET geom_z3  = zu.g3,
                geom_z7  = zu.g7,
                geom_z11 = zu.g11
            FROM affected a
            LEFT JOIN zip_unions zu ON zu.pid = a.id
            WHERE p.id = a.id
        """)
        self.db.execute(sql, {"node_ids": list(node_ids)})
        self.db.flush()

    def _recompute_node_layer(self, node_ids: set[int]) -> None:
        """Set geometry on order>1 nodes (regions, areas) by unioning their child nodes.

        Children already have correct pre-simplified geometry per zoom level, so we
        union each column directly — no extra simplification math needed.
        LEFT JOIN means a node with no geometry-bearing children gets NULL geometry.
        """
        sql = text("""
            WITH child_unions AS (
                SELECT c.parent_node_id AS pid,
                       ST_UnaryUnion(ST_Collect(c.geom_z3))  AS g3,
                       ST_UnaryUnion(ST_Collect(c.geom_z7))  AS g7,
                       ST_UnaryUnion(ST_Collect(c.geom_z11)) AS g11
                FROM nodes c
                WHERE c.parent_node_id = ANY(:node_ids)
                GROUP BY c.parent_node_id
            ), affected AS (
                SELECT id FROM nodes WHERE id = ANY(:node_ids)
            )
            UPDATE nodes p
            SET geom_z3  = cu.g3,
                geom_z7  = cu.g7,
                geom_z11 = cu.g11
            FROM affected a
            LEFT JOIN child_unions cu ON cu.pid = a.id
            WHERE p.id = a.id
        """)
        self.db.execute(sql, {"node_ids": list(node_ids)})
        self.db.flush()

    # ------------------------------------------------------------------
    # Tile cache invalidation
    # ------------------------------------------------------------------

    def invalidate_cache_for_layers(self, layer_ids: set[int]) -> None:
        """Delete ALL cached MVT tiles for the given layers.

        Use for full recomputes (import). For incremental edits use recompute_from,
        which scopes cache deletes to the bounding box of changed nodes.
        Does not commit — caller owns the transaction.
        """
        if not layer_ids:
            return
        self.db.execute(delete(MvtTileCacheModel).where(MvtTileCacheModel.layer_id.in_(layer_ids)))
        self.db.flush()

    def _invalidate_tiles_for_nodes(self, layer_id: int, node_ids: set[int]) -> None:
        """Delete MVT cache tiles for layer_id that cover the bounding box of the given nodes.

        Computes tile (x, y) ranges for z=3..11 from the nodes' updated geometry in a
        single SQL statement using the standard Mercator tile formula. Uses integer range
        filters on the cache table — no spatial index needed.
        Does not commit — caller owns the transaction.
        """
        sql = text("""
            WITH bbox AS (
                SELECT ST_Extent(COALESCE(n.geom_z11, n.geom_z7, n.geom_z3)) AS geom
                FROM nodes n
                WHERE n.id = ANY(:node_ids)
            ),
            tile_ranges AS (
                SELECT
                    z::smallint,
                    GREATEST(0, FLOOR((ST_XMin(b.geom) + 180.0) / 360.0 * POW(2, z))::int) AS x_min,
                    FLOOR((ST_XMax(b.geom) + 180.0) / 360.0 * POW(2, z))::int             AS x_max,
                    GREATEST(0, FLOOR(
                        (1.0 - LN(TAN(RADIANS(LEAST(ST_YMax(b.geom), 85.051)))
                               + 1.0 / COS(RADIANS(LEAST(ST_YMax(b.geom), 85.051)))) / PI()
                        ) / 2.0 * POW(2, z)
                    )::int) AS y_min,
                    FLOOR(
                        (1.0 - LN(TAN(RADIANS(GREATEST(ST_YMin(b.geom), -85.051)))
                               + 1.0 / COS(RADIANS(GREATEST(ST_YMin(b.geom), -85.051)))) / PI()
                        ) / 2.0 * POW(2, z)
                    )::int AS y_max
                FROM bbox b, generate_series(3, 11) z
                WHERE b.geom IS NOT NULL
            )
            DELETE FROM mvt_tile_cache c
            USING tile_ranges tr
            WHERE c.layer_id = :layer_id
              AND c.z = tr.z
              AND c.x BETWEEN tr.x_min AND tr.x_max
              AND c.y BETWEEN tr.y_min AND tr.y_max
        """)
        self.db.execute(sql, {"layer_id": layer_id, "node_ids": list(node_ids)})
        self.db.flush()

    # ------------------------------------------------------------------
    # Propagation helpers
    # ------------------------------------------------------------------

    def _get_layer_order_groups(self, node_ids: set[int]) -> dict[int, tuple[int, set[int]]]:
        """Group node IDs by their layer's order. Returns {order: (layer_id, node_ids)}."""
        rows = self.db.execute(
            select(NodeModel.id, LayerModel.id, LayerModel.order)
            .join(LayerModel, NodeModel.layer_id == LayerModel.id)
            .where(NodeModel.id.in_(node_ids))
        ).all()
        groups: dict[int, tuple[int, set[int]]] = {}
        for node_id, layer_id, order in rows:
            if order not in groups:
                groups[order] = (layer_id, set())
            groups[order][1].add(node_id)
        return groups

    def _get_parent_ids(self, node_ids: set[int]) -> set[int]:
        """Return the non-null parent_node_ids of the given nodes."""
        rows = (
            self.db.execute(
                select(NodeModel.parent_node_id)
                .where(NodeModel.id.in_(node_ids), NodeModel.parent_node_id.isnot(None))
            )
            .scalars()
            .all()
        )
        return {r for r in rows if r is not None}


def get_computation_service(db: DatabaseSession) -> ComputationService:
    """Get computation service."""
    return ComputationService(db=db)


ComputationServiceDependency = Annotated[ComputationService, Depends(get_computation_service)]
