"""Graph service."""

from typing import Annotated, Literal, cast

from fastapi import Depends
from sqlalchemy import delete, select, text, update
from sqlalchemy.exc import NoResultFound

from src.app.database import DatabaseSession
from src.exceptions import TerramapsException
from src.models.geography import ZipCodeGeography
from src.models.graph import LayerModel, MapModel, NodeModel, ZipAssignmentModel
from src.schemas.dtos.graph import (
    AssignZip,
    BulkAssignZips,
    BulkDeleteNodes,
    CreateLayer,
    CreateNode,
    MergeNodes,
    ReparentNodes,
    UpdateNode,
)
from src.services.base import BaseService


class GraphService(BaseService):
    """GraphService."""

    def create_map(self, name: str) -> MapModel:
        """Create map."""
        new_map = MapModel(name=name)
        self.db.add(new_map)
        self.db.flush()
        return new_map

    def create_layer(self, layer_data: CreateLayer) -> LayerModel:
        """Create layer."""
        child_layer = (
            self.db.execute(
                select(LayerModel).where(LayerModel.map_id == layer_data.map_id).order_by(LayerModel.order.desc())
            )
            .scalars()
            .first()
        )

        # Create new layer one level above
        new_layer = LayerModel(
            name=layer_data.name,
            order=child_layer.order + 1 if child_layer else 0,
            map_id=layer_data.map_id,
        )
        self.db.add(new_layer)
        self.db.flush()
        return new_layer

    def create_node(self, node_data: CreateNode) -> NodeModel:
        """Create node.

        Raises:
            TerramapsError(400) layer doesn't exist or is order=0 (zip layer — use assign_zip instead)
            TerramapsError(402) parent node doesn't exist
            TerramapsError(403) parent node is in invalid layer
        """
        layer = self.db.get(LayerModel, node_data.layer_id)
        if not layer:
            raise TerramapsException(400, f"Can't create node in layer: {node_data.layer_id}. Layer doesn't exist.")
        if layer.order == 0:
            raise TerramapsException(
                400,
                f"Can't create node in layer {node_data.layer_id}: layer order is 0. "
                "Zip-level entries are managed via zip assignments, not nodes.",
            )

        if node_data.parent_node_id:
            self._propose_node_parent(
                current_layer=layer,
                proposed_parent_node_id=node_data.parent_node_id,
            )

        new_node = NodeModel(
            name=node_data.name,
            layer_id=node_data.layer_id,
            color=node_data.color,
            parent_node_id=node_data.parent_node_id,
            data={},
            geom_z3=None,
            geom_z7=None,
            geom_z11=None,
            geom_z3_merc=None,
            geom_z7_merc=None,
            geom_z11_merc=None,
        )
        self.db.add(new_node)
        self.db.flush()
        return new_node

    def update_node(
        self,
        node: NodeModel,
        node_data: UpdateNode,
        layer: LayerModel | None = None,
    ) -> NodeModel:
        """Update node.

        Raises:
            TerramapsError(402) parent node doesn't exist
            TerramapsError(403) parent node is in invalid layer
        """
        if node.parent_node_id != node_data.parent_node_id and node_data.parent_node_id is not None:
            if not layer:
                layer = cast(LayerModel, self.db.get(LayerModel, node.layer_id))
            self._propose_node_parent(current_layer=layer, proposed_parent_node_id=node_data.parent_node_id)
        node.color = node_data.color
        node.parent_node_id = node_data.parent_node_id
        node.name = node_data.name
        self.db.flush()
        return node

    # ------------------------------------------------------------------
    # Bulk node operations
    # ------------------------------------------------------------------

    def reparent_nodes(self, data: ReparentNodes) -> list[NodeModel]:
        """Bulk reparent nodes to a new parent (or orphan them).

        All nodes must be in the same layer. If parent_node_id is provided it
        must be in the layer directly above the current nodes' layer.

        Raises:
            TerramapsException(400) if node_ids is empty or nodes span multiple layers
            TerramapsException(404) if any node_id is not found
            TerramapsException(402/403) if parent validation fails (via _propose_node_parent)
        """
        if not data.node_ids:
            raise TerramapsException(400, "node_ids must not be empty.")

        nodes = self.db.execute(select(NodeModel).where(NodeModel.id.in_(data.node_ids))).scalars().all()

        if len(nodes) != len(set(data.node_ids)):
            found = {n.id for n in nodes}
            missing = set(data.node_ids) - found
            raise TerramapsException(404, f"Nodes not found: {missing}")

        layer_ids = {n.layer_id for n in nodes}
        if len(layer_ids) > 1:
            raise TerramapsException(400, "All nodes must be in the same layer.")

        layer = cast(LayerModel, self.db.get(LayerModel, next(iter(layer_ids))))

        if data.parent_node_id is not None:
            self._propose_node_parent(layer, data.parent_node_id)

        self.db.execute(
            update(NodeModel).where(NodeModel.id.in_(data.node_ids)).values(parent_node_id=data.parent_node_id)
        )
        self.db.flush()

        for node in nodes:
            node.parent_node_id = data.parent_node_id
        return list(nodes)

    def merge_nodes(self, data: MergeNodes) -> NodeModel:
        """Merge multiple nodes into a single new node in the same layer.

        Creates a new node with the given name and parent, reparents all children
        (child nodes for order>1, zip assignments for order=1) to the new node,
        then deletes the originals.

        Raises:
            TerramapsException(400) if fewer than 2 nodes, nodes span layers, or layer is order=0
            TerramapsException(404) if any node_id is not found
            TerramapsException(402/403) if parent validation fails
        """
        if len(data.node_ids) < 2:
            raise TerramapsException(400, "At least 2 nodes are required to merge.")

        nodes = self.db.execute(select(NodeModel).where(NodeModel.id.in_(data.node_ids))).scalars().all()

        if len(nodes) != len(set(data.node_ids)):
            found = {n.id for n in nodes}
            missing = set(data.node_ids) - found
            raise TerramapsException(404, f"Nodes not found: {missing}")

        layer_ids = {n.layer_id for n in nodes}
        if len(layer_ids) > 1:
            raise TerramapsException(400, "All nodes must be in the same layer.")

        layer = cast(LayerModel, self.db.get(LayerModel, next(iter(layer_ids))))

        if layer.order == 0:
            raise TerramapsException(400, "Cannot merge zip-layer entries.")

        if data.parent_node_id is not None:
            self._propose_node_parent(layer, data.parent_node_id)

        if data.target_node_id is not None:
            # Keep the target node; reparent everything from the other nodes into it.
            dest_node = cast(NodeModel, self.db.get(NodeModel, data.target_node_id))
            dest_node.parent_node_id = data.parent_node_id
            other_ids = [nid for nid in data.node_ids if nid != data.target_node_id]
            if layer.order == 1:
                self.db.execute(
                    update(ZipAssignmentModel)
                    .where(ZipAssignmentModel.parent_node_id.in_(other_ids))
                    .values(parent_node_id=dest_node.id)
                )
            else:
                self.db.execute(
                    update(NodeModel)
                    .where(NodeModel.parent_node_id.in_(other_ids))
                    .values(parent_node_id=dest_node.id)
                )
            self.db.execute(delete(NodeModel).where(NodeModel.id.in_(other_ids)))
            self.db.flush()
            return dest_node

        new_node = NodeModel(
            name=data.name,
            layer_id=layer.id,
            color="#CCCCCC",
            parent_node_id=data.parent_node_id,
            geom_z3=None,
            geom_z3_merc=None,
            geom_z7=None,
            geom_z7_merc=None,
            geom_z11=None,
            geom_z11_merc=None,
            data=None,
        )
        self.db.add(new_node)
        self.db.flush()  # obtain new_node.id before reparenting

        if layer.order == 1:
            self.db.execute(
                update(ZipAssignmentModel)
                .where(ZipAssignmentModel.parent_node_id.in_(data.node_ids))
                .values(parent_node_id=new_node.id)
            )
        else:
            self.db.execute(
                update(NodeModel).where(NodeModel.parent_node_id.in_(data.node_ids)).values(parent_node_id=new_node.id)
            )

        self.db.execute(delete(NodeModel).where(NodeModel.id.in_(data.node_ids)))
        self.db.flush()
        return new_node

    def bulk_delete_nodes(self, data: BulkDeleteNodes) -> None:
        """Delete multiple nodes, handling their children first.

        Orphans or reparents children before deletion so FK constraints are not violated.
        Works for both order=1 (zip children) and order>1 (node children).

        Raises:
            TerramapsException(400) if node_ids is empty, nodes span layers, or reparent target is invalid
            TerramapsException(404) if any node_id is not found
        """
        if not data.node_ids:
            raise TerramapsException(400, "node_ids must not be empty.")

        nodes = self.db.execute(select(NodeModel).where(NodeModel.id.in_(data.node_ids))).scalars().all()

        if len(nodes) != len(set(data.node_ids)):
            found = {n.id for n in nodes}
            missing = set(data.node_ids) - found
            raise TerramapsException(404, f"Nodes not found: {missing}")

        layer_ids = {n.layer_id for n in nodes}
        if len(layer_ids) > 1:
            raise TerramapsException(400, "All nodes must be in the same layer.")

        layer = cast(LayerModel, self.db.get(LayerModel, next(iter(layer_ids))))

        new_parent_id: int | None = None
        if data.child_action == "reparent":
            reparent_id = data.reparent_node_id  # model_validator guarantees non-None
            if reparent_id in set(data.node_ids):
                raise TerramapsException(400, "reparent_node_id cannot be one of the nodes being deleted.")
            reparent_node = self.db.get(NodeModel, reparent_id)
            if not reparent_node or reparent_node.layer_id != layer.id:
                raise TerramapsException(400, "reparent_node_id must exist in the same layer as the deleted nodes.")
            new_parent_id = reparent_id

        if layer.order == 1:
            self.db.execute(
                update(ZipAssignmentModel)
                .where(ZipAssignmentModel.parent_node_id.in_(data.node_ids))
                .values(parent_node_id=new_parent_id)
            )
        else:
            self.db.execute(
                update(NodeModel)
                .where(NodeModel.parent_node_id.in_(data.node_ids))
                .values(parent_node_id=new_parent_id)
            )

        self.db.execute(delete(NodeModel).where(NodeModel.id.in_(data.node_ids)))
        self.db.flush()

    # ------------------------------------------------------------------
    # Zip assignment methods
    # ------------------------------------------------------------------

    def assign_zip(
        self,
        layer_id: int,
        zip_code: str,
        data: AssignZip,
    ) -> ZipAssignmentModel:
        """Assign a zip code to a territory, or update an existing assignment.

        If no zip_assignment row exists, creates one with color copied from
        geography_zip_codes unless an explicit color is provided.
        If a row already exists, updates parent_node_id and optionally color.

        Raises:
            TerramapsException(404) zip code not in geography table
            TerramapsException(404) parent node not found
            TerramapsException(400) parent node is not in an order=1 layer
        """
        if data.parent_node_id is not None:
            self._validate_zip_parent(data.parent_node_id)

        existing = self.db.execute(
            select(ZipAssignmentModel).where(
                ZipAssignmentModel.layer_id == layer_id,
                ZipAssignmentModel.zip_code == zip_code,
            )
        ).scalar_one_or_none()

        if existing:
            existing.parent_node_id = data.parent_node_id
            if data.color is not None:
                existing.color = data.color
            self.db.flush()
            return existing

        geography = self.db.get(ZipCodeGeography, zip_code)
        if not geography:
            raise TerramapsException(404, f"Zip code {zip_code} not found in geography data.")

        new_assignment = ZipAssignmentModel(
            layer_id=layer_id,
            zip_code=zip_code,
            parent_node_id=data.parent_node_id,
            color=data.color if data.color is not None else geography.color,
        )
        self.db.add(new_assignment)
        self.db.flush()
        return new_assignment

    def unassign_zip(self, layer_id: int, zip_code: str) -> ZipAssignmentModel | None:
        """Remove a zip code's territory assignment, preserving the row and color.

        If no assignment row exists the zip is already implicitly unassigned — returns None.
        """
        existing = self.db.execute(
            select(ZipAssignmentModel).where(
                ZipAssignmentModel.layer_id == layer_id,
                ZipAssignmentModel.zip_code == zip_code,
            )
        ).scalar_one_or_none()

        if not existing:
            return None

        existing.parent_node_id = None
        self.db.flush()
        return existing

    def reset_zip(self, layer_id: int, zip_code: str) -> None:
        """Remove a zip assignment row entirely, reverting the zip to implicit white state."""
        self.db.execute(
            delete(ZipAssignmentModel).where(
                ZipAssignmentModel.layer_id == layer_id,
                ZipAssignmentModel.zip_code == zip_code,
            )
        )
        self.db.flush()

    def bulk_assign_zips(self, layer_id: int, data: BulkAssignZips) -> int:
        """Bulk assign or unassign zip codes to a territory.

        Uses a single upsert against geography_zip_codes:
        - New rows: color copied from geography unless overridden.
        - Existing rows: parent_node_id updated; color preserved unless overridden.

        Returns the number of rows inserted or updated.
        """
        if not data.zip_codes:
            return 0

        if data.parent_node_id is not None:
            self._validate_zip_parent(data.parent_node_id)

        # JOIN geography_zip_codes so new rows inherit the default color without a separate
        # round-trip. COALESCE(:color_override, ...) is NULL-safe: when color_override is
        # None it becomes SQL NULL and COALESCE falls through to the next expression.
        upsert_sql = text("""
            INSERT INTO zip_assignments
                (layer_id, zip_code, parent_node_id, color)
            SELECT
                :layer_id,
                gz.zip_code,
                :parent_node_id,
                COALESCE(:color_override, gz.color)
            FROM geography_zip_codes gz
            WHERE gz.zip_code = ANY(:zip_codes)
            ON CONFLICT (layer_id, zip_code) DO UPDATE
                SET parent_node_id = EXCLUDED.parent_node_id,
                    color = COALESCE(:color_override, zip_assignments.color)
            RETURNING zip_assignments.zip_code
        """)

        result = self.db.execute(
            upsert_sql,
            {
                "layer_id": layer_id,
                "parent_node_id": data.parent_node_id,
                "color_override": data.color,
                "zip_codes": data.zip_codes,
            },
        )
        self.db.flush()
        return len(result.fetchall())

    # ------------------------------------------------------------------
    # Internal validation helpers
    # ------------------------------------------------------------------

    def _validate_zip_parent(self, parent_node_id: int) -> None:
        """Validate that a proposed parent node exists and is in an order=1 layer.

        Raises:
            TerramapsException(404) node not found
            TerramapsException(400) node's layer order is not 1
        """
        result = self.db.execute(
            select(LayerModel.order)
            .join(NodeModel, NodeModel.layer_id == LayerModel.id)
            .where(NodeModel.id == parent_node_id)
        ).scalar_one_or_none()

        if result is None:
            raise TerramapsException(404, f"Parent node {parent_node_id} not found.")
        if result != 1:
            raise TerramapsException(
                400,
                f"Parent node {parent_node_id} is in a layer with order={result}. "
                "Zip assignments must have a parent in an order=1 layer.",
            )

    def _propose_node_parent(
        self,
        current_layer: LayerModel,
        proposed_parent_node_id: int,
    ) -> Literal[True]:
        """Raise exception if node parent invalid.

        Raises:
            TerramapsError(402) parent node doesn't exist
            TerramapsError(403) parent node is in invalid layer
        """
        try:
            _, parent_layer = (
                self.db.execute(
                    select(NodeModel, LayerModel)
                    .join(target=LayerModel, onclause=LayerModel.id == NodeModel.layer_id)
                    .filter(NodeModel.id == proposed_parent_node_id)
                )
                .one()
                .tuple()
            )
        except NoResultFound as nre:
            raise TerramapsException(
                402, f"Can't create node with parent: {proposed_parent_node_id}. Parent node doesn't exist."
            ) from nre
        if parent_layer.order != current_layer.order + 1:
            raise TerramapsException(
                403,
                f"Can't create node with parent: {proposed_parent_node_id}. Parent layer order {parent_layer.order} needs to be one level higher than current layer order {current_layer.order}.",
            )
        return True


def get_graph_service(db: DatabaseSession) -> GraphService:
    """Get graph service."""
    return GraphService(db=db)


GraphServiceDependency = Annotated[GraphService, Depends(get_graph_service)]
