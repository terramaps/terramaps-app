"""Maps router."""

import hashlib
import logging
import uuid
from typing import Any, TypedDict

logger = logging.getLogger(__name__)

import pandas as pd
from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from src.app.database import DatabaseSession
from src.models.geography import ZipCodeGeography
from src.models.graph import LayerModel, MapModel, NodeModel, ZipAssignmentModel
from src.models.jobs import MapJobModel
from src.schemas.dtos.maps import ImportMap
from src.schemas.graph import Map, MapJob
from src.services.auth import CurrentUserDependency
from src.services.graph import GraphServiceDependency
from src.services.permissions import PermissionsServiceDependency

maps_router = APIRouter(prefix="/maps", tags=["Maps"])

# Visually distinct palette for territory/region nodes on order>=1 layers.
# Colors are cycled by insertion index within each layer so every territory
# gets a unique color (up to 16; wraps after that).
_TERRITORY_PALETTE = [
    "#E63946", "#F4A261", "#2A9D8F", "#457B9D", "#6A4C93",
    "#F72585", "#4CC9F0", "#7CB518", "#FB8500", "#023E8A",
    "#8338EC", "#FF006E", "#3A86FF", "#06D6A0", "#FFBE0B",
    "#FB5607",
]


class BulkInsertNode(TypedDict):
    """BulkInsertNode — used for order>=1 layers only."""

    layer_id: int
    name: str
    parent_node_id: int | None
    color: str
    data: Any | None


class BulkInsertZipAssignment(TypedDict):
    """BulkInsertZipAssignment — used for the order=0 zip layer."""

    layer_id: int
    zip_code: str
    parent_node_id: int | None
    color: str
    data: Any | None


def _load_active_job(db: DatabaseSession, map_id: str) -> MapJob | None:
    """Return the most recent non-complete job for a map, or None."""
    job = db.execute(
        select(MapJobModel)
        .where(MapJobModel.map_id == map_id)
        .order_by(MapJobModel.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()

    if job is None or job.status == "complete":
        return None

    return MapJob(
        id=job.id,
        job_type=job.job_type,
        status=job.status,
        step=job.step,
        error=job.error,
    )


def _map_to_schema(map_model: MapModel, active_job: MapJob | None) -> Map:
    """Convert a MapModel ORM object to a Map schema, attaching job state."""
    return Map(
        id=map_model.id,
        name=map_model.name,
        tile_version=map_model.tile_version,
        data_field_config=map_model.data_field_config,
        active_job=active_job,
        updated_at=map_model.updated_at,
    )


@maps_router.post("", response_model=Map, status_code=202)
def create_map(
    graph_service: GraphServiceDependency,
    db: DatabaseSession,
    import_data: ImportMap,
    current_user: CurrentUserDependency,
    permission_service: PermissionsServiceDependency,
) -> Map:
    """Create map.

    Synchronously inserts all nodes and zip assignments, then enqueues a
    background task to compute geometry and data aggregations.  Returns 202
    with the new map and an ``active_job`` tracking the pending computation.

    TODO:
        - Return errors for zip codes we don't have data for
        - Validate no duplicate layer names
        - Validate no duplicate parents and raise error if so
    """
    # Lazy import to avoid importing Celery at module load time in API workers
    from src.workers.tasks.maps import import_map_task  # noqa: PLC0415

    # Create map + permission role
    new_map = graph_service.create_map(name=import_data.name)
    permission_service.add_map_role(user_id=current_user.id, map_id=new_map.id, role="OWNER")

    # Bulk insert all layers; order mirrors position in import_data.layers (0 = zip layer)
    layer_result = db.execute(
        insert(LayerModel)
        .values([{"map_id": new_map.id, "name": s.name, "order": i} for i, s in enumerate(import_data.layers)])
        .returning(LayerModel.id, LayerModel.order)
    ).all()
    order_to_header = {i: s.header for i, s in enumerate(import_data.layers)}
    # list of (layer_id, order, header) sorted lowest → highest order
    layer_and_headers: list[tuple[int, int, str]] = sorted(
        [(row.id, row.order, order_to_header[row.order]) for row in layer_result],
        key=lambda x: x[1],
    )

    df_values = pd.DataFrame(import_data.values, columns=list[str](import_data.headers)).astype(object)

    # Excel auto-types numeric-looking cells as int or float (territory "1" → 1 or 1.0).
    # Normalize all numeric values to consistent strings so that int(1), float(1.0),
    # numpy.int64(1), and numpy.float64(1.0) all become "1" before dedup, node
    # insertion, and parent lookup. Booleans and NaN/None are left unchanged.
    def _normalize_cell(x: object) -> object:
        if isinstance(x, bool) or pd.isna(x):  # type: ignore[arg-type]
            return x
        if isinstance(x, (int, float)):
            fval = float(x)
            return str(int(fval)) if fval == int(fval) else str(fval)
        return x

    for col in [s.header for s in import_data.layers]:
        if col in df_values.columns:
            df_values[col] = df_values[col].apply(_normalize_cell)

    previous_header: str | None = None
    previous_nodes: pd.DataFrame | None = None  # DataFrame(id, name) from the layer above

    # Process layers from top (highest order) down to the zip layer (order=0)
    for layer_id, order, header in reversed(layer_and_headers):
        df_idx = [header] if not previous_header else [header, previous_header]
        rows_df = df_values[df_idx].drop_duplicates().copy()
        rows_df = rows_df[rows_df[header].notna() & (rows_df[header] != "")]

        # Map parent node IDs by name. After normalization both sides are strings.
        if previous_nodes is not None and previous_header is not None:
            name_to_id: dict[str, int] = dict(
                zip(previous_nodes["name"].astype(str), previous_nodes["id"])
            )
            rows_df["parent_node_id"] = rows_df[previous_header].apply(
                lambda x: name_to_id.get(str(x)) if pd.notna(x) and x != "" else None
            )
            # Warn on any rows that had a non-empty parent value but got no match
            misses = rows_df[
                rows_df["parent_node_id"].isna()
                & rows_df[previous_header].notna()
                & (rows_df[previous_header] != "")
            ]
            if not misses.empty:
                miss_vals = misses[previous_header].unique().tolist()[:10]
                logger.warning(
                    "Parent lookup missed %d rows for header=%r. "
                    "Sample unmatched values: %s. name_to_id keys sample: %s",
                    len(misses), previous_header,
                    miss_vals, list(name_to_id.keys())[:10],
                )
        else:
            rows_df["parent_node_id"] = None

        if order == 0:
            # --- Zip layer: insert into zip_assignments ---
            rows_df[header] = rows_df[header].astype(str).str.zfill(5)

            # Filter to valid zips using only the zips present in the file
            zip_codes_in_file = rows_df[header].tolist()
            valid_zip_codes = set(
                db.execute(
                    select(ZipCodeGeography.zip_code).where(ZipCodeGeography.zip_code.in_(zip_codes_in_file))
                ).scalars().all()
            )
            rows_df = rows_df[rows_df[header].isin(valid_zip_codes)].copy()

            geography_colors: dict[str, str] = dict(
                db.execute(
                    select(ZipCodeGeography.zip_code, ZipCodeGeography.color)
                    .where(ZipCodeGeography.zip_code.in_(rows_df[header].tolist()))
                ).all()
            )

            zip_codes = rows_df[header].tolist()
            parent_ids = rows_df["parent_node_id"].tolist()
            bulk_insert_zips = [
                BulkInsertZipAssignment(
                    layer_id=layer_id,
                    zip_code=str(z),
                    parent_node_id=int(p) if pd.notna(p) else None,
                    color=geography_colors.get(str(z), "#CCCCCC"),
                    data=None,
                )
                for z, p in zip(zip_codes, parent_ids)
            ]
            db.execute(insert(ZipAssignmentModel).values(bulk_insert_zips))

        else:
            # --- Parent layer (order>=1): insert into nodes ---
            names = rows_df[header].tolist()
            parent_ids = rows_df["parent_node_id"].tolist()
            bulk_insert_nodes = [
                BulkInsertNode(
                    layer_id=layer_id,
                    name=str(name),
                    parent_node_id=int(p) if pd.notna(p) else None,
                    color=_TERRITORY_PALETTE[int(hashlib.md5(str(name).encode()).hexdigest(), 16) % len(_TERRITORY_PALETTE)],
                    data=None,
                )
                for name, p in zip(names, parent_ids)
            ]
            result = db.execute(
                insert(NodeModel).values(bulk_insert_nodes).returning(NodeModel.id, NodeModel.name)
            ).tuples()
            previous_nodes = pd.DataFrame(result, columns=["id", "name"]).astype(object)

        previous_header = header

    # Commit nodes/zips + job record together so the worker always sees committed rows
    job_id = str(uuid.uuid4())
    db.add(MapJobModel(id=job_id, map_id=new_map.id, job_type="import", status="pending", step=None, error=None))
    db.commit()

    import_map_task.delay(job_id, new_map.id)

    return _map_to_schema(new_map, MapJob(id=job_id, job_type="import", status="pending"))


@maps_router.get("", response_model=list[Map])
def list_maps(
    db: DatabaseSession,
    current_user: CurrentUserDependency,
    permission_service: PermissionsServiceDependency,
) -> list[Map]:
    """List maps for the current user, each with its latest active job if any."""
    map_roles = permission_service.list_map_roles(user_id=current_user.id)
    map_ids = [mr.map_id for mr in map_roles]

    maps = db.execute(select(MapModel).where(MapModel.id.in_(map_ids))).scalars().all()

    # Fetch the most recent non-complete job per map in a single query.
    # We use a subquery to rank jobs per map and take the latest one.
    active_jobs: dict[str, MapJob] = {}
    if map_ids:
        job_rows = db.execute(
            select(MapJobModel)
            .where(MapJobModel.map_id.in_(map_ids))
            .order_by(MapJobModel.map_id, MapJobModel.created_at.desc())
        ).scalars().all()

        seen: set[str] = set()
        for job in job_rows:
            if job.map_id not in seen:
                seen.add(job.map_id)
                if job.status != "complete":
                    active_jobs[job.map_id] = MapJob(
                        id=job.id,
                        job_type=job.job_type,
                        status=job.status,
                        step=job.step,
                        error=job.error,
                    )

    return [_map_to_schema(m, active_jobs.get(m.id)) for m in maps]


@maps_router.get("/{map_id}", response_model=Map)
def get_map(
    map_id: str,
    db: DatabaseSession,
    current_user: CurrentUserDependency,
    permission_service: PermissionsServiceDependency,
) -> Map:
    """Get a single map with its latest active job."""
    map_roles = permission_service.list_map_roles(user_id=current_user.id)
    if not any(mr.map_id == map_id for mr in map_roles):
        raise HTTPException(status_code=404, detail="Map not found")

    map_model = db.get(MapModel, map_id)
    if not map_model:
        raise HTTPException(status_code=404, detail="Map not found")

    return _map_to_schema(map_model, _load_active_job(db, map_id))
