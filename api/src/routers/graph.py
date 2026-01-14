"""Layers router."""

from collections.abc import Sequence

from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select

from src.app.database import DatabaseSession
from src.exceptions import TerriscopeException
from src.models.graph import LayerModel, NodeModel
from src.schemas.dtos.graph import BulkUpdateNode, CreateLayer, CreateNode, UpdateNode
from src.schemas.graph import Layer, Node, PaginatedNodes
from src.services.auth import CurrentUserDependency
from src.services.graph import GraphServiceDependency
from src.services.permissions import PermissionsServiceDependency

graph_router = APIRouter(prefix="", tags=["Graph"])


@graph_router.post("/layers", response_model=Layer)
def create_layer(
    layer_data: CreateLayer,
    graph_service: GraphServiceDependency,
    db: DatabaseSession,
    current_user: CurrentUserDependency,
    permission_service: PermissionsServiceDependency,
):
    """Create layer."""
    # Get the highest order layer (the current top layer)
    if not permission_service.check_for_map_access(
        user_id=current_user.id,
        map_id=layer_data.map_id,
        map_roles=["OWNER"],
    ):
        raise HTTPException(403, "User does not have permission to this map.")
    new_layer = graph_service.create_layer(layer_data)
    db.commit()
    return Layer(
        id=new_layer.id,
        name=new_layer.name,
        order=new_layer.order,
        map_id=new_layer.map_id,
    )


@graph_router.get("/layers", response_model=list[Layer])
def list_layers(
    db: DatabaseSession,
    map_id: int,
    current_user: CurrentUserDependency,
    permission_service: PermissionsServiceDependency,
) -> list[Layer]:
    """List layers."""
    if not permission_service.check_for_map_access(
        user_id=current_user.id,
        map_id=map_id,
        map_roles=["OWNER"],
    ):
        raise HTTPException(403, "User does not have permission to this map.")
    return [
        Layer(
            id=layer.id,
            map_id=map_id,
            name=layer.name,
            order=layer.order,
        )
        for layer in db.query(LayerModel).filter(LayerModel.map_id == map_id).all()
    ]


@graph_router.get("/layers/{layer_id}")
def get_layer(
    layer_id: int,
    db: DatabaseSession,
    current_user: CurrentUserDependency,
    permission_service: PermissionsServiceDependency,
):
    """Get a layer by id."""
    layer = db.get(LayerModel, layer_id)
    if layer and permission_service.check_for_map_access(
        user_id=current_user.id,
        map_id=layer.map_id,
        map_roles=["OWNER"],
    ):
        return Layer(
            id=layer.id,
            name=layer.name,
            order=layer.order,
            map_id=layer.map_id,
        )
    raise HTTPException(404)


@graph_router.post("/nodes")
def create_node(
    node_data: CreateNode,
    db: DatabaseSession,
    graph_service: GraphServiceDependency,
    current_user: CurrentUserDependency,
    permission_service: PermissionsServiceDependency,
):
    """Create node."""
    layer = db.get(LayerModel, node_data.layer_id)
    if not layer or not permission_service.check_for_map_access(
        user_id=current_user.id,
        map_id=layer.map_id,
        map_roles=["OWNER"],
    ):
        raise HTTPException(403)
    try:
        new_node = graph_service.create_node(node_data=node_data)
    except TerriscopeException as e:
        if e.code == 400 or e.code == 402:
            raise HTTPException(404, e.msg) from e
        else:
            raise HTTPException(400, e.msg) from e
    db.commit()
    return Node(
        id=new_node.id,
        layer_id=new_node.layer_id,
        color=new_node.color,
        name=new_node.name,
        parent_node_id=new_node.parent_node_id,
        child_count=new_node.child_count,
    )


@graph_router.get("/nodes")
def list_nodes(
    db: DatabaseSession,
    current_user: CurrentUserDependency,
    permission_service: PermissionsServiceDependency,
    layer_id: int | None = None,
    parent_node_id: int | None = None,
    page: int = 1,
    page_size: int = 100,
):
    """List nodes filtered by layer_id OR parent_node_id (not both) with pagination."""
    # Build filter condition - use either layer_id or parent_node_id, not both
    if layer_id is not None and parent_node_id is not None:
        raise HTTPException(400, "Provide either layer_id or parent_node_id, not both")
    elif layer_id is not None:
        filter_condition = NodeModel.layer_id == layer_id
        layer = db.get(LayerModel, layer_id)
        if not layer or not permission_service.check_for_map_access(
            user_id=current_user.id,
            map_id=layer.map_id,
            map_roles=["OWNER"],
        ):
            raise HTTPException(403)
    elif parent_node_id is not None:
        parent_node = db.get(NodeModel, parent_node_id)
        layer = db.get(LayerModel, parent_node.layer_id) if parent_node else None
        if not layer or not permission_service.check_for_map_access(
            user_id=current_user.id,
            map_id=layer.map_id,
            map_roles=["OWNER"],
        ):
            raise HTTPException(403)
        filter_condition = NodeModel.parent_node_id == parent_node_id
    else:
        raise HTTPException(400, "Must provide either layer_id or parent_node_id")

    # Count total nodes
    total = db.execute(select(func.count(NodeModel.id)).filter(filter_condition)).scalar() or 0

    # Calculate pagination
    total_pages = (total + page_size - 1) // page_size if total > 0 else 0
    offset = (page - 1) * page_size

    # Query nodes with pagination
    nodes_query = select(NodeModel).filter(filter_condition).offset(offset).limit(page_size)
    nodes = db.execute(nodes_query).scalars().all()

    return PaginatedNodes(
        nodes=[
            Node(
                id=node.id,
                layer_id=node.layer_id,
                color=node.color,
                name=node.name,
                parent_node_id=node.parent_node_id,
                child_count=node.child_count,
            )
            for node in nodes
        ],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@graph_router.get("/nodes/{node_id}")
def get_node(
    node_id: int,
    db: DatabaseSession,
    current_user: CurrentUserDependency,
    permission_service: PermissionsServiceDependency,
):
    """Get node by id."""
    node_layer_result = (
        db.execute(
            select(NodeModel, LayerModel)
            .join(LayerModel, NodeModel.layer_id == LayerModel.id)
            .filter(NodeModel.id == node_id)
        )
        .tuples()
        .one_or_none()
    )
    if node_layer_result:
        node, layer = node_layer_result
        if not layer or not permission_service.check_for_map_access(
            user_id=current_user.id,
            map_id=layer.map_id,
            map_roles=["OWNER"],
        ):
            raise HTTPException(403)

        return Node(
            id=node.id,
            layer_id=node.layer_id,
            color=node.color,
            name=node.name,
        )
    raise HTTPException(404)


@graph_router.put("/nodes/{node_id}")
def update_node(
    db: DatabaseSession,
    graph_service: GraphServiceDependency,
    permission_service: PermissionsServiceDependency,
    current_user: CurrentUserDependency,
    node_id: int,
    node_data: UpdateNode,
):
    """Update node."""
    node_layer_result = (
        db.execute(
            select(NodeModel, LayerModel)
            .join(LayerModel, NodeModel.layer_id == LayerModel.id)
            .filter(NodeModel.id == node_id)
        )
        .tuples()
        .one_or_none()
    )
    if node_layer_result:
        node, layer = node_layer_result
        if not layer or not permission_service.check_for_map_access(
            user_id=current_user.id,
            map_id=layer.map_id,
            map_roles=["OWNER"],
        ):
            raise HTTPException(403)
        graph_service.update_node(node=node, node_data=node_data)
        db.commit()
        return Node(
            id=node.id,
            layer_id=node.layer_id,
            color=node.color,
            name=node.name,
            child_count=node.child_count,
        )
    raise HTTPException(404)


@graph_router.put("/nodes/bulk")
def bulk_update_node(
    node_datas: Sequence[BulkUpdateNode],
    db: DatabaseSession,
    graph_service: GraphServiceDependency,
    current_user: CurrentUserDependency,
):
    """Update node."""
    nodes_and_layers = (
        db.execute(
            select(NodeModel, LayerModel)
            .join(target=LayerModel, onclause=NodeModel.layer_id == LayerModel.id)
            .filter(NodeModel.id.in_([_node.id for _node in node_datas]))
        )
        .tuples()
        .all()
    )
    if len(nodes_and_layers) != len(node_datas):
        found_ids = {_node.id for _node, _ in nodes_and_layers}
        wanted_ids = [_node.id for _node in node_datas]
        if len(wanted_ids) != len(set(wanted_ids)):
            raise HTTPException(400, f"Invalid request. Can't update the same node twice: {wanted_ids}")
        raise HTTPException(404, f"Can't find nodes: {found_ids - set(wanted_ids)}")

    updated_nodes: Sequence[Node] = []
    for (node, layer), node_data in zip(nodes_and_layers, node_datas, strict=True):
        graph_service.update_node(node=node, node_data=node_data, layer=layer)
        updated_nodes.append(
            Node(
                id=node.id,
                layer_id=node.layer_id,
                color=node.color,
                name=node.name,
                child_count=node.child_count,
            )
        )
    db.commit()
    return updated_nodes


@graph_router.delete("/nodes/{node_id}")
def delete_node(node_id: int):
    """Delete node."""
    pass
