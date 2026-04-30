"""Computation service for geometry roll-ups and data aggregations."""

import logging
import re
from typing import Annotated, Any

from fastapi import Depends
from sqlalchemy import delete, select, text

from src.app.database import DatabaseSession
from src.models.cache import MvtTileCacheModel
from src.models.graph import LayerModel, MapModel, NodeModel
from src.services.base import BaseService

_SAFE_FIELD_RE = re.compile(r"^[a-z][a-z0-9_]*$")

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
    # Data aggregation
    # ------------------------------------------------------------------

    def compute_data_from(self, affected_node_ids: set[int], map_id: str) -> None:
        """Recompute data aggregations for the given nodes and all their ancestors.

        Mirrors recompute_from but for data instead of geometry — only touches
        the affected set and propagates upward, not the entire map.
        """
        map_model = self.db.get(MapModel, map_id)
        if not map_model or not map_model.data_field_config:
            return
        number_fields = [
            f for f in map_model.data_field_config
            if f.get("type") == "number" and f.get("aggregations")
        ]
        if not number_fields:
            return

        current_ids = set(affected_node_ids)
        while current_ids:
            order_groups = self._get_layer_order_groups(current_ids)
            for order, (_layer_id, ids) in sorted(order_groups.items()):
                if order == 1:
                    self._compute_data_zip_layer(ids, number_fields)
                else:
                    self._compute_data_node_layer(ids, number_fields)
            current_ids = self._get_parent_ids(current_ids)

    def compute_data_for_map(self, map_id: str) -> None:
        """Aggregate numeric data fields bottom-to-top for all layers in a map.

        Reads data_field_config from the map, then for each order>=1 layer
        (bottom to top) aggregates child data into parent nodes using SUM and
        naive AVG-of-AVGs. Skips maps with no number fields configured.
        """
        map_model = self.db.get(MapModel, map_id)
        if not map_model or not map_model.data_field_config:
            logger.info("compute_data_for_map: no data_field_config for map %s, skipping", map_id)
            return

        number_fields: list[dict[str, Any]] = [
            f for f in map_model.data_field_config
            if f.get("type") == "number" and f.get("aggregations")
        ]
        if not number_fields:
            return

        for field in number_fields:
            fname = field["field"]
            if not _SAFE_FIELD_RE.match(fname):
                raise ValueError(f"Unsafe field key in data_field_config: {fname!r}")

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
                self.db.execute(
                    select(NodeModel.id).where(NodeModel.layer_id == layer.id)
                )
                .scalars()
                .all()
            )
            if not node_ids:
                continue
            if layer.order == 1:
                self._compute_data_zip_layer(node_ids, number_fields)
            else:
                self._compute_data_node_layer(node_ids, number_fields)

    @staticmethod
    def _data_branch(fname: str, from_clause: str, alias: str, flat: bool = False, precision: int = 4) -> str:
        """Build one UNION ALL branch for a single data field.

        fname is pre-validated against _SAFE_FIELD_RE — no injection risk.
        from_clause is e.g. "zip_assignments za" or "nodes c".
        alias is the table alias used for column references, e.g. "za" or "c".
        flat=True reads a scalar value directly (zip layer); flat=False reads nested {sum,avg,min,max}.
        precision controls ROUND() applied to sum and avg before storage (min/max preserve full precision).
        """
        if flat:
            return (
                f"SELECT {alias}.parent_node_id, '{fname}'::text AS key_name,"  # noqa: S608
                f" ROUND(SUM(({alias}.data->>'{fname}')::numeric), {precision}) AS sum_val,"
                f" ROUND(AVG(({alias}.data->>'{fname}')::numeric), {precision}) AS avg_val,"
                f" MIN(({alias}.data->>'{fname}')::numeric) AS min_val,"
                f" MAX(({alias}.data->>'{fname}')::numeric) AS max_val"
                f" FROM {from_clause}"
                f" WHERE {alias}.parent_node_id = ANY(:node_ids) AND {alias}.data ? '{fname}'"
                f" GROUP BY {alias}.parent_node_id"
            )
        return (
            f"SELECT {alias}.parent_node_id, '{fname}'::text AS key_name,"  # noqa: S608
            f" ROUND(SUM(({alias}.data->'{fname}'->>'sum')::numeric), {precision}) AS sum_val,"
            f" ROUND(AVG(({alias}.data->'{fname}'->>'avg')::numeric), {precision}) AS avg_val,"
            f" MIN(({alias}.data->'{fname}'->>'min')::numeric) AS min_val,"
            f" MAX(({alias}.data->'{fname}'->>'max')::numeric) AS max_val"
            f" FROM {from_clause}"
            f" WHERE {alias}.parent_node_id = ANY(:node_ids) AND {alias}.data ? '{fname}'"
            f" GROUP BY {alias}.parent_node_id"
        )

    def _run_data_agg(
        self, node_ids: set[int], fields: list[dict[str, Any]], from_clause: str, alias: str, flat: bool = False
    ) -> None:
        branches = " UNION ALL ".join(
            self._data_branch(f["field"], from_clause, alias, flat=flat, precision=f.get("precision", 4))
            for f in fields
        )
        sql_str = (
            f"WITH field_aggs AS ({branches}),"  # noqa: S608
            " node_data AS ("
            "   SELECT parent_node_id,"
            "          jsonb_object_agg(key_name, jsonb_build_object('sum', sum_val, 'avg', avg_val, 'min', min_val, 'max', max_val)) AS data"
            "   FROM field_aggs GROUP BY parent_node_id"
            " )"
            " UPDATE nodes n SET data = nd.data"
            " FROM node_data nd WHERE n.id = nd.parent_node_id"
        )
        self.db.execute(text(sql_str), {"node_ids": list(node_ids)})
        self.db.flush()

    def _compute_data_zip_layer(self, node_ids: set[int], fields: list[dict[str, Any]]) -> None:
        """Aggregate zip_assignments.data (flat scalars) into order=1 territory nodes."""
        self._run_data_agg(node_ids, fields, "zip_assignments za", "za", flat=True)

    def _compute_data_node_layer(self, node_ids: set[int], fields: list[dict[str, Any]]) -> None:
        """Aggregate child node data into order>1 nodes."""
        self._run_data_agg(node_ids, fields, "nodes c", "c")

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
                       ST_UnaryUnion(ST_Collect(gz.geom_z3))       AS g3,
                       ST_UnaryUnion(ST_Collect(gz.geom_z3_merc))  AS g3_merc,
                       ST_UnaryUnion(ST_Collect(gz.geom_z7))       AS g7,
                       ST_UnaryUnion(ST_Collect(gz.geom_z7_merc))  AS g7_merc,
                       ST_UnaryUnion(ST_Collect(gz.geom_z11))      AS g11,
                       ST_UnaryUnion(ST_Collect(gz.geom_z11_merc)) AS g11_merc
                FROM zip_assignments za
                JOIN geography_zip_codes gz ON gz.zip_code = za.zip_code
                WHERE za.parent_node_id = ANY(:node_ids)
                GROUP BY za.parent_node_id
            ), affected AS (
                SELECT id FROM nodes WHERE id = ANY(:node_ids)
            )
            UPDATE nodes p
            SET geom_z3      = zu.g3,
                geom_z3_merc = zu.g3_merc,
                geom_z7      = zu.g7,
                geom_z7_merc = zu.g7_merc,
                geom_z11     = zu.g11,
                geom_z11_merc = zu.g11_merc
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
                       ST_UnaryUnion(ST_Collect(c.geom_z3))       AS g3,
                       ST_UnaryUnion(ST_Collect(c.geom_z3_merc))  AS g3_merc,
                       ST_UnaryUnion(ST_Collect(c.geom_z7))       AS g7,
                       ST_UnaryUnion(ST_Collect(c.geom_z7_merc))  AS g7_merc,
                       ST_UnaryUnion(ST_Collect(c.geom_z11))      AS g11,
                       ST_UnaryUnion(ST_Collect(c.geom_z11_merc)) AS g11_merc
                FROM nodes c
                WHERE c.parent_node_id = ANY(:node_ids)
                GROUP BY c.parent_node_id
            ), affected AS (
                SELECT id FROM nodes WHERE id = ANY(:node_ids)
            )
            UPDATE nodes p
            SET geom_z3       = cu.g3,
                geom_z3_merc  = cu.g3_merc,
                geom_z7       = cu.g7,
                geom_z7_merc  = cu.g7_merc,
                geom_z11      = cu.g11,
                geom_z11_merc = cu.g11_merc
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
