"""Maps router."""

import hashlib
import json
import uuid
from typing import Any, TypedDict

import pandas as pd
from fastapi import APIRouter
from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert

from src.app.database import DatabaseSession
from src.models.geography import ZipCodeGeography
from src.models.graph import LayerModel, MapModel, NodeModel
from src.schemas.dtos.graph import CreateLayer
from src.schemas.dtos.maps import DataFieldSetup, ImportMap
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
    data: Any | None
    data_cache_key: str
    data_inputs_cache_key: str
    geom_cache_key: str
    geom_inputs_cache_key: str


def _compute_leaf_data(
    df_values: pd.DataFrame,
    header: str,
    nodes_df: pd.DataFrame,
    numeric_data_fields: list[DataFieldSetup],
) -> dict[str, dict[str, float | None]]:
    """Compute raw aggregated data for leaf (zip code) nodes."""
    leaf_data_by_name: dict[str, dict[str, float | None]] = {}
    normalized_col = df_values[header].astype(str).str.zfill(5)
    for leaf_name in nodes_df[header].unique():
        matching = df_values[normalized_col == str(leaf_name)]
        data_dict: dict[str, float | None] = {}
        for field in numeric_data_fields:
            vals = pd.to_numeric(matching[field.header], errors="coerce").dropna()
            raw = float(vals.sum()) if not vals.empty else None
            for agg in field.aggregations:
                data_dict[f"{field.name}_{agg}"] = raw
        leaf_data_by_name[str(leaf_name)] = data_dict
    return leaf_data_by_name


def _insert_whitespace_zip_codes(db: DatabaseSession, layer_0_id: int) -> None:
    """Insert geography zip codes not already in layer 0 as parentless whitespace nodes with geometry."""
    db.execute(
        text("""
            INSERT INTO nodes (layer_id, name, parent_node_id, color, data, data_cache_key,
                               data_inputs_cache_key, geom_cache_key, geom_inputs_cache_key,
                               geom, geom_z3, geom_z7, geom_z11, geom_z15)
            SELECT
                :layer_id,
                zip_code,
                NULL,
                '#FFFFF',
                NULL,
                '',
                '',
                md5(ST_AsEWKB(geom)::text),
                'zip_geom',
                geom,
                geom_z3,
                geom_z7,
                geom_z11,
                geom_z15
            FROM geography_zip_codes
            WHERE zip_code NOT IN (SELECT name FROM nodes WHERE layer_id = :layer_id)
        """),
        {"layer_id": layer_0_id},
    )


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
    """
    # Build data_field_config from the incoming data fields (numeric with aggregations only)
    data_field_config = [
        {"field": df.name, "type": df.type, "aggregations": df.aggregations}
        for df in import_data.data_fields
        if df.type == "number" and df.aggregations
    ]

    # Create map
    new_map = graph_service.create_map(name=import_data.name)
    new_map.data_field_config = data_field_config or None
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

    # Numeric data fields that need aggregation
    numeric_data_fields = [df for df in import_data.data_fields if df.type == "number" and df.aggregations]

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

        # For leaf nodes, compute raw data from the spreadsheet keyed by suffixed agg name
        # (e.g. "customers_sum": 150) so bulk_recompute_data_layer SQL is uniform at all levels.
        leaf_data_by_name: dict[str, dict[str, float | None]] = (
            _compute_leaf_data(df_values, header, nodes_df, numeric_data_fields)
            if layer.order == 0 and numeric_data_fields
            else {}
        )

        # TODO should add validation that no duplicates of (layer) exists (aka not two different parents for same child)
        current_previous_nodes = previous_nodes.copy() if previous_nodes is not None else None
        current_leaf_data = leaf_data_by_name
        bulk_insert_nodes_df = nodes_df.apply(
            lambda row, layer_id=layer.id, prev_nodes=current_previous_nodes, leaf_data=current_leaf_data: (
                BulkInsertNode(
                    layer_id=layer_id,
                    name=str(row[header]),
                    parent_node_id=next(
                        iter(prev_nodes.loc[prev_nodes["name"] == str(row[previous_header]), "id"]), None
                    )
                    if previous_header is not None
                    else None,
                    geom=None,
                    color="#FFFFF",
                    data=leaf_data.get(str(row[header])) or None,
                    data_cache_key=hashlib.md5(
                        json.dumps(leaf_data[str(row[header])], sort_keys=True).encode()
                    ).hexdigest()
                    if leaf_data.get(str(row[header]))
                    else "",
                    data_inputs_cache_key="",
                    geom_cache_key="",
                    geom_inputs_cache_key="",
                )
            ),
            axis=1,
        )
        bulk_insert_nodes = bulk_insert_nodes_df.to_list()
        bulk_insert_result = db.execute(
            insert(NodeModel).values(bulk_insert_nodes).returning(NodeModel.id, NodeModel.name)
        ).tuples()
        previous_nodes = pd.DataFrame(bulk_insert_result, columns=["id", "name"]).astype(object)
        previous_header = header

    # Insert whitespace nodes: zip codes in geography but not in the import data
    layer_0 = layer_and_headers[0][0]
    if valid_zip_codes is not None:
        _insert_whitespace_zip_codes(db, layer_0.id)

    # Associate geometries with assigned layer 0 nodes (whitespace nodes already have geometry)
    db.execute(
        update(NodeModel)
        .where(
            NodeModel.name == ZipCodeGeography.zip_code,
            NodeModel.layer_id == layer_0.id,
            NodeModel.geom.is_(None),
        )
        .values(
            geom=ZipCodeGeography.geom,
            geom_z3=ZipCodeGeography.geom_z3,
            geom_z7=ZipCodeGeography.geom_z7,
            geom_z11=ZipCodeGeography.geom_z11,
            geom_z15=ZipCodeGeography.geom_z15,
            geom_cache_key=text("md5(ST_AsEWKB(geography_zip_codes.geom)::text)"),
            geom_inputs_cache_key="zip_geom",
        )
    )

    # Recompute geometry for all parent layers from bottom to top
    for layer, _ in layer_and_headers[1:]:  # Skip layer 0
        result = computation_service.bulk_recompute_layer(layer_id=layer.id, force=True)
        print(f"Geometry layer {layer.name} (id={layer.id}): {result}")

    # Recompute aggregated data for all parent layers from bottom to top
    if numeric_data_fields and data_field_config:
        for layer, _ in layer_and_headers[1:]:  # Skip layer 0 (already has raw data)
            result = computation_service.bulk_recompute_data_layer(
                layer_id=layer.id,
                data_field_config=data_field_config,
                force=True,
            )
            print(f"Data layer {layer.name} (id={layer.id}): {result}")

    db.commit()

    return Map(id=new_map.id, name=new_map.name, data_field_config=new_map.data_field_config)


# TODO: Remove this test endpoint
@maps_router.post("/test-all-zips", response_model=Map)
def create_test_all_zips_map(
    graph_service: GraphServiceDependency,
    db: DatabaseSession,
    current_user: CurrentUserDependency,
    permission_service: PermissionsServiceDependency,
):
    """Test endpoint: creates a map with one layer where every zip code is a parentless node."""
    new_map = graph_service.create_map(name=f"test-{uuid.uuid4().hex[:8]}")
    permission_service.add_map_role(user_id=current_user.id, map_id=new_map.id, role="OWNER")

    layer = graph_service.create_layer(layer_data=CreateLayer(name="Zip Codes", map_id=new_map.id))

    db.execute(
        text("""
            INSERT INTO nodes (layer_id, name, parent_node_id, color, data, data_cache_key,
                               data_inputs_cache_key, geom_cache_key, geom_inputs_cache_key,
                               geom, geom_z3, geom_z7, geom_z11, geom_z15)
            SELECT
                :layer_id,
                zip_code,
                NULL,
                '#FFFFF',
                NULL,
                '',
                '',
                md5(ST_AsEWKB(geom)::text),
                'zip_geom',
                geom,
                geom_z3,
                geom_z7,
                geom_z11,
                geom_z15
            FROM geography_zip_codes
        """),
        {"layer_id": layer.id},
    )

    db.commit()
    return Map(id=new_map.id, name=new_map.name, data_field_config=new_map.data_field_config)


@maps_router.get("", response_model=list[Map])
def list_maps(
    db: DatabaseSession,
    current_user: CurrentUserDependency,
    permission_service: PermissionsServiceDependency,
):
    """List maps."""
    map_roles = permission_service.list_map_roles(user_id=current_user.id)
    return [
        Map(id=_map.id, name=_map.name, data_field_config=_map.data_field_config)
        for _map in db
        .execute(select(MapModel).where(MapModel.id.in_([map_role.map_id for map_role in map_roles])))
        .scalars()
        .all()
    ]
