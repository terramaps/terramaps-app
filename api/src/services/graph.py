"""Graph service."""

from typing import Annotated, Literal, cast

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.exc import NoResultFound

from src.app.database import DatabaseSession
from src.exceptions import TerriscopeException
from src.models.graph import LayerModel, MapModel, NodeModel
from src.schemas.dtos.graph import CreateLayer, CreateNode, UpdateNode
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
        child_layer = self.db.execute(select(LayerModel).order_by(LayerModel.order.desc())).scalars().first()

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
            TerriscopeError(400) layer doesn't exist
            TerriscopeError(401) layer is leaf (order 0)
            TerriscopeError(402) parent node doesn't exist
            TerriscopeError(403) parent node is in invalid layer
        """
        layer = self.db.get(LayerModel, node_data.layer_id)
        if not layer:
            raise TerriscopeException(400, f"Can't create node in layer: {node_data.layer_id}. Layer doesn't exist.")
        elif layer.order == 0:
            raise TerriscopeException(401, f"Can't create node in layer: {node_data.layer_id}. Layer order is 0.")

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
            geom=None,
            data=None,
            data_cache_key="",
            data_inputs_cache_key="",
            geom_cache_key="",
            geom_inputs_cache_key="",
        )
        self.db.add(new_node)
        self.db.flush()
        return new_node

    def update_node(
        self,
        node: NodeModel,
        node_data: UpdateNode,
        layer: LayerModel | None = None,  # pass current_layer to prevent query
    ) -> NodeModel:
        """Update node.

        Raises:
            TerriscopeError(402) parent node doesn't exist
            TerriscopeError(403) parent node is in invalid layer
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

    def _propose_node_parent(
        self,
        current_layer: LayerModel,
        proposed_parent_node_id: int,
    ) -> Literal[True]:
        """Raise exception if node parent invalid.

        Raises:
            TerriscopeError(402) parent node doesn't exist
            TerriscopeError(403) parent node is in invalid layer
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
            raise TerriscopeException(
                402, f"Can't create node with parent: {proposed_parent_node_id}. Parent node doesn't exist."
            ) from nre
        if parent_layer.order != current_layer.order + 1:
            raise TerriscopeException(
                403,
                f"Can't create node with parent: {proposed_parent_node_id}. Parent layer order {parent_layer.order} needs to be one level higher than current layer order {current_layer.order}.",
            )
        return True


def get_graph_service(db: DatabaseSession) -> GraphService:
    """Get graph service."""
    return GraphService(db=db)


GraphServiceDependency = Annotated[GraphService, Depends(get_graph_service)]
