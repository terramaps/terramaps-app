"""Maps router."""

from typing import Any, TypedDict

import pandas as pd
from fastapi import APIRouter
from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert

from src.app.database import DatabaseSession
from src.models.geography import ZipCodeGeography
from src.models.graph import LayerModel, MapModel, NodeModel
from src.schemas.dtos.graph import CreateLayer
from src.schemas.dtos.maps import ImportMap
from src.schemas.graph import Map
from src.services.auth import CurrentUserDependency
from src.services.computation import ComputationServiceDependency
from src.services.graph import GraphServiceDependency
from src.services.permissions import PermissionsServiceDependency

maps_router = APIRouter(prefix="/maps", tags=["Maps"])


class BulkInsertNode(TypedDict):
    """BulkInsertNode."""

    layer_id: int
    name: str
    parent_node_id: int | None
    geom: Any | None
    color: str
    data_cache_key: str
    data_inputs_cache_key: str
    geom_cache_key: str
    geom_inputs_cache_key: str


@maps_router.post("", response_model=Map)
def create_map(
    graph_service: GraphServiceDependency,
    db: DatabaseSession,
    import_data: ImportMap,
    computation_service: ComputationServiceDependency,
    current_user: CurrentUserDependency,
    permission_service: PermissionsServiceDependency,
):
    """Create map.

    TOODS:
        - Return errors for zip codes we don't have data for
        - Validate no duplicate layer names
        - Validate no duplicate parents and raise error if so
        - Fix all typing issues
        - Recompute after loading zip codes
        - Add data fields
    """
    # Create map
    new_map = graph_service.create_map(name=import_data.name)
    permission_service.add_map_role(
        user_id=current_user.id,
        map_id=new_map.id,
        role="OWNER",
    )

    # Create layers
    layer_and_headers: list[tuple[LayerModel, str]] = []
    for layer_setup in import_data.layers:
        layer = graph_service.create_layer(
            layer_data=CreateLayer(
                name=layer_setup.name,
                map_id=new_map.id,
            )
        )
        layer_and_headers.append((layer, layer_setup.header))

    # Convert values to numpy array for efficient column access
    df_values = pd.DataFrame(import_data.values, columns=list[str](import_data.headers)).astype(object)

    # Get unique combinations of layer values with their layer IDs
    previous_header: str | None = None
    previous_nodes: pd.DataFrame | None = None

    # Get valid zip codes from geography table for filtering layer 0
    valid_zip_codes = None
    if any(layer.order == 0 for layer, _ in layer_and_headers):
        valid_zips_result = db.execute(select(ZipCodeGeography.zip_code)).scalars().all()
        valid_zip_codes = set(valid_zips_result)

    for layer, header in reversed(layer_and_headers):
        df_idx = [header] if not previous_header else [header, previous_header]
        nodes_df = df_values[df_idx].drop_duplicates().copy()
        nodes_df = nodes_df[nodes_df[header].notna() & (nodes_df[header] != "")]
        if layer.order == 0:
            nodes_df[header] = nodes_df[header].astype(str).str.zfill(5)
            # Filter out zip codes that don't exist in geography table
            if valid_zip_codes is not None:
                nodes_df = nodes_df[nodes_df[header].isin(valid_zip_codes)]
        # TODO should add validation that no duplicates of (layer) exists (aka not two different parents for same child)
        current_previous_nodes = previous_nodes.copy() if previous_nodes is not None else None
        bulk_insert_nodes_df = nodes_df.apply(
            lambda row, layer_id=layer.id, prev_nodes=current_previous_nodes: BulkInsertNode(
                layer_id=layer_id,
                name=str(row[header]),
                parent_node_id=next(iter(prev_nodes.loc[prev_nodes["name"] == str(row[previous_header]), "id"]), None)
                if previous_header is not None
                else None,
                geom=None,
                color="#FFFFF",
                data_cache_key="",
                data_inputs_cache_key="",
                geom_cache_key="",
                geom_inputs_cache_key="",
            ),
            axis=1,
        )
        bulk_insert_nodes = bulk_insert_nodes_df.to_list()
        bulk_insert_result = db.execute(
            insert(NodeModel).values(bulk_insert_nodes).returning(NodeModel.id, NodeModel.name)
        ).tuples()
        previous_nodes = pd.DataFrame(bulk_insert_result, columns=["id", "name"]).astype(object)
        previous_header = header

    # Associate geometries with layer 0 (zip codes)
    layer_0 = layer_and_headers[0][0]
    db.execute(
        update(NodeModel)
        .where(NodeModel.name == ZipCodeGeography.zip_code, NodeModel.layer_id == layer_0.id)
        .values(
            geom=ZipCodeGeography.geom,
            geom_cache_key=text("md5(ST_AsEWKB(geography_zip_codes.geom)::text)"),
            geom_inputs_cache_key="zip_geom",
        )
    )

    # Recompute all parent layers from bottom to top
    for layer, _ in layer_and_headers[1:]:  # Skip layer 0
        result = computation_service.bulk_recompute_layer(layer_id=layer.id, force=True)
        print(f"Layer {layer.name} (id={layer.id}): {result}")

    db.commit()

    return Map(id=new_map.id, name=new_map.name)


@maps_router.post("", response_model=list[Map])
def list_maps(
    db: DatabaseSession,
    current_user: CurrentUserDependency,
    permission_service: PermissionsServiceDependency,
):
    """List maps."""
    map_roles = permission_service.list_map_roles(user_id=current_user.id)
    return [
        Map(id=_map.id, name=_map.name)
        for _map in db.execute(select(MapModel).where(MapModel.id.in_([map_role.map_id for map_role in map_roles])))
        .scalars()
        .all()
    ]
