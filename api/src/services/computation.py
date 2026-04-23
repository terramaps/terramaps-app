"""Computation service for graph geometry roll-ups."""

import logging
from typing import Annotated

from fastapi import Depends
from sqlalchemy import select, text

from src.app.database import DatabaseSession
from src.models.graph import LayerModel, MapModel, NodeModel
from src.services.base import BaseService

logger = logging.getLogger(__name__)


class ComputationService(BaseService):
    """Compute derived geometry and data for graph nodes."""

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def recompute_from(self, map_id: str, affected_node_ids: set[int]) -> None:
        """Recompute geometry (and data, if configured) for affected nodes and all ancestors.

        Propagates upward layer by layer until no parents remain.
        Call this synchronously inside the request handler before db.commit().
        """
        map_model = self.db.get(MapModel, map_id)
        data_field_config: list[dict[str, object]] = (
            list(map_model.data_field_config) if map_model and map_model.data_field_config else []
        )

        current_ids = set(affected_node_ids)
        while current_ids:
            order_groups = self._get_layer_order_groups(current_ids)
            for order, ids in sorted(order_groups.items()):
                if order == 1:
                    self._recompute_zip_layer(ids)
                    if data_field_config:
                        self._recompute_data_zip_layer(ids, data_field_config)
                else:
                    self._recompute_node_layer(ids)
                    if data_field_config:
                        self._recompute_data_node_layer(ids, data_field_config)
            current_ids = self._get_parent_ids(current_ids)

    def recompute_all_layers(self, map_id: str) -> list[LayerModel]:
        """Full geometry recompute for every order>=1 layer in a map, bottom to top.

        Used by the import task where every node needs computing from scratch.
        Returns the layer list so callers can pass it to recompute_all_data_layers.
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
            node_ids = set(self.db.execute(select(NodeModel.id).where(NodeModel.layer_id == layer.id)).scalars().all())
            if node_ids:
                if layer.order == 1:
                    self._recompute_zip_layer(node_ids)
                else:
                    self._recompute_node_layer(node_ids)
        return layers

    def recompute_all_data_layers(
        self,
        map_id: str,
        data_field_config: list[dict[str, object]],
        layers: list[LayerModel] | None = None,
    ) -> None:
        """Full data recompute for every order>=1 layer in a map, bottom to top.

        Pass `layers` from recompute_all_layers to avoid an extra query.
        """
        numeric_fields = [f for f in data_field_config if f.get("type") == "number" and f.get("aggregations")]
        if not numeric_fields:
            return

        if layers is None:
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
            node_ids = set(self.db.execute(select(NodeModel.id).where(NodeModel.layer_id == layer.id)).scalars().all())
            if node_ids:
                if layer.order == 1:
                    self._recompute_data_zip_layer(node_ids, data_field_config)
                else:
                    self._recompute_data_node_layer(node_ids, data_field_config)

    # ------------------------------------------------------------------
    # Geometry recompute helpers
    # ------------------------------------------------------------------

    def _recompute_zip_layer(self, node_ids: set[int]) -> None:
        """Recompute geometry for order=1 nodes from their zip assignments.

        Uses a LEFT JOIN so nodes with no zips get their geometry set to NULL.
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
        """Recompute geometry for order>1 nodes from their child node geometries.

        Each zoom column on children is already pre-simplified at the correct level,
        so we union them directly — no additional simplification math needed.
        Uses a LEFT JOIN so nodes with no geometry-bearing children get NULL.
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
    # Data recompute helpers
    # ------------------------------------------------------------------

    def _recompute_data_zip_layer(self, node_ids: set[int], data_field_config: list[dict[str, object]]) -> None:
        """Recompute aggregated data for order=1 nodes from their zip assignments."""
        numeric_fields = [f for f in data_field_config if f.get("type") == "number" and f.get("aggregations")]
        if not numeric_fields:
            return
        agg_expr = self._build_agg_expr(numeric_fields, child_alias="za")
        sql = text(
            f"""
            WITH agg AS (
                SELECT za.parent_node_id AS pid,
                       {agg_expr} AS agg_data
                FROM zip_assignments za
                WHERE za.parent_node_id = ANY(:node_ids)
                  AND za.data IS NOT NULL
                GROUP BY za.parent_node_id
            ), affected AS (
                SELECT id FROM nodes WHERE id = ANY(:node_ids)
            )
            UPDATE nodes p
            SET data = agg.agg_data
            FROM affected a
            LEFT JOIN agg ON agg.pid = a.id
            WHERE p.id = a.id
            """  # noqa: S608
        )
        self.db.execute(sql, {"node_ids": list(node_ids)})
        self.db.flush()

    def _recompute_data_node_layer(self, node_ids: set[int], data_field_config: list[dict[str, object]]) -> None:
        """Recompute aggregated data for order>1 nodes from their child nodes."""
        numeric_fields = [f for f in data_field_config if f.get("type") == "number" and f.get("aggregations")]
        if not numeric_fields:
            return
        agg_expr = self._build_agg_expr(numeric_fields, child_alias="c")
        sql = text(
            f"""
            WITH agg AS (
                SELECT c.parent_node_id AS pid,
                       {agg_expr} AS agg_data
                FROM nodes c
                WHERE c.parent_node_id = ANY(:node_ids)
                  AND c.data IS NOT NULL
                GROUP BY c.parent_node_id
            ), affected AS (
                SELECT id FROM nodes WHERE id = ANY(:node_ids)
            )
            UPDATE nodes p
            SET data = agg.agg_data
            FROM affected a
            LEFT JOIN agg ON agg.pid = a.id
            WHERE p.id = a.id
            """  # noqa: S608
        )
        self.db.execute(sql, {"node_ids": list(node_ids)})
        self.db.flush()

    # ------------------------------------------------------------------
    # Propagation helpers
    # ------------------------------------------------------------------

    def _get_layer_order_groups(self, node_ids: set[int]) -> dict[int, set[int]]:
        """Group node IDs by their layer's order value."""
        rows = self.db.execute(
            select(NodeModel.id, LayerModel.order)
            .join(LayerModel, NodeModel.layer_id == LayerModel.id)
            .where(NodeModel.id.in_(node_ids))
        ).all()
        groups: dict[int, set[int]] = {}
        for node_id, order in rows:
            groups.setdefault(order, set()).add(node_id)
        return groups

    def _get_parent_ids(self, node_ids: set[int]) -> set[int]:
        """Return the non-null parent_node_ids of the given nodes."""
        rows = (
            self.db.execute(
                select(NodeModel.parent_node_id).where(NodeModel.id.in_(node_ids), NodeModel.parent_node_id.isnot(None))
            )
            .scalars()
            .all()
        )
        return set(rows)

    # ------------------------------------------------------------------
    # SQL builder
    # ------------------------------------------------------------------

    @staticmethod
    def _build_agg_expr(numeric_fields: list[dict[str, object]], child_alias: str) -> str:
        """Build a jsonb_build_object(...) expression aggregating numeric data fields.

        child_alias is the SQL alias of the child table ('c' for nodes, 'za' for zip_assignments).
        """
        agg_parts: list[str] = []
        for field in numeric_fields:
            field_name = str(field["field"])
            for agg in list(field.get("aggregations", [])):  # type: ignore[arg-type]
                key = f"{field_name}_{agg}"
                if agg == "sum":
                    expr = f"'{key}', SUM(({child_alias}.data->>'{key}')::numeric)"
                else:  # avg
                    expr = f"'{key}', AVG(({child_alias}.data->>'{key}')::numeric)"
                agg_parts.append(expr)
        return f"jsonb_build_object({', '.join(agg_parts)})"


def get_computation_service(db: DatabaseSession) -> ComputationService:
    """Get computation service."""
    return ComputationService(db=db)


ComputationServiceDependency = Annotated[ComputationService, Depends(get_computation_service)]
