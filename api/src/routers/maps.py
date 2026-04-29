"""Maps router."""

import logging
import re
import uuid

from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from src.app.database import DatabaseSession
from src.models.exports import MapExportModel, MapExportSlideModel
from src.models.graph import LayerModel, MapModel
from src.models.jobs import MapJobModel
from src.models.uploads import MapUploadModel
from src.schemas.dtos.maps import CreateMap
from src.schemas.graph import Map, MapExport, MapJob
from src.services.auth import CurrentUserDependency
from src.services.graph import GraphServiceDependency
from src.services.permissions import PermissionsServiceDependency
from src.workers.tasks.maps import import_map_task

logger = logging.getLogger(__name__)

maps_router = APIRouter(prefix="/maps", tags=["Maps"])

# Visually distinct palette for territory/region nodes on order>=1 layers.
_TERRITORY_PALETTE = [
    "#E63946", "#F4A261", "#2A9D8F", "#457B9D", "#6A4C93", "#F72585",
    "#4CC9F0", "#7CB518", "#FB8500", "#023E8A", "#8338EC", "#FF006E",
    "#3A86FF", "#06D6A0", "#FFBE0B", "#FB5607",
]


def _normalize_field_key(name: str) -> str:
    """Normalize a display name to a safe JSONB key (lowercase alphanumeric + underscore)."""
    key = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return key or "field"


@maps_router.post("", response_model=Map, status_code=202)
def create_map(
    graph_service: GraphServiceDependency,
    db: DatabaseSession,
    create_data: CreateMap,
    current_user: CurrentUserDependency,
    permission_service: PermissionsServiceDependency,
) -> Map:
    """Create a map from a previously uploaded and parsed document."""
    upload = db.get(MapUploadModel, create_data.document_id)
    if not upload or not permission_service.check_for_upload_access(
        user_id=current_user.id, upload_id=create_data.document_id
    ):
        raise HTTPException(status_code=404, detail="Upload not found")

    if upload.status != "ready":
        detail = {
            "parsing": "Upload is still being parsed",
            "failed": "Upload failed to parse",
            "importing": "Upload has already been claimed by a map",
            "complete": "Upload has already been claimed by a map",
        }.get(upload.status, "Upload is not ready")
        raise HTTPException(status_code=409, detail=detail)

    new_map = graph_service.create_map(name=create_data.name)
    new_map.source_upload_id = upload.id

    number_fields = [f for f in create_data.data_fields if f.type == "number" and f.aggregations]
    if number_fields:
        new_map.data_field_config = [
            {
                "field": _normalize_field_key(f.name),
                "label": f.name,
                "type": f.type,
                "aggregations": list(f.aggregations),
            }
            for f in number_fields
        ]

    permission_service.add_map_role(user_id=current_user.id, map_id=new_map.id, role="OWNER")

    db.execute(
        insert(LayerModel).values(
            [{"map_id": new_map.id, "name": s.name, "order": i} for i, s in enumerate(create_data.layers)]
        )
    )

    upload.layer_config = [layer.model_dump() for layer in create_data.layers]
    upload.data_config = [field.model_dump() for field in create_data.data_fields]
    upload.status = "importing"

    db.commit()

    import_map_task.delay(new_map.id)

    return Map.create(new_map, upload, active_job=None, active_export=None)


@maps_router.get("", response_model=list[Map])
def list_maps(
    db: DatabaseSession,
    current_user: CurrentUserDependency,
    permission_service: PermissionsServiceDependency,
) -> list[Map]:
    """List maps for the current user, each with its active job and import state."""
    map_roles = permission_service.list_map_roles(user_id=current_user.id)
    map_ids = [mr.map_id for mr in map_roles]
    if not map_ids:
        return []

    maps = db.execute(select(MapModel).where(MapModel.id.in_(map_ids))).scalars().all()

    upload_ids = [m.source_upload_id for m in maps if m.source_upload_id]
    uploads_by_id: dict[str, MapUploadModel] = {}
    if upload_ids:
        upload_rows = db.execute(select(MapUploadModel).where(MapUploadModel.id.in_(upload_ids))).scalars().all()
        uploads_by_id = {u.id: u for u in upload_rows}

    # Latest non-complete job per map (single query)
    active_jobs: dict[str, MapJob] = {}
    job_rows = (
        db.execute(
            select(MapJobModel)
            .where(MapJobModel.map_id.in_(map_ids))
            .order_by(MapJobModel.map_id, MapJobModel.created_at.desc())
        )
        .scalars()
        .all()
    )
    seen: set[str] = set()
    for job in job_rows:
        if job.map_id not in seen:
            seen.add(job.map_id)
            if job.status != "complete":
                active_jobs[job.map_id] = MapJob.create(job)

    # Latest non-complete export per map + uploaded slide count
    active_exports: dict[str, MapExport] = {}
    export_rows = (
        db.execute(
            select(MapExportModel)
            .where(MapExportModel.map_id.in_(map_ids), MapExportModel.status != "complete")
            .order_by(MapExportModel.map_id, MapExportModel.created_at.desc())
        )
        .scalars()
        .all()
    )
    seen_export: set[str] = set()
    export_ids = []
    export_by_id: dict[str, MapExportModel] = {}
    for export in export_rows:
        if export.map_id not in seen_export:
            seen_export.add(export.map_id)
            export_ids.append(export.id)
            export_by_id[export.id] = export

    if export_ids:
        upload_counts = db.execute(
            select(MapExportSlideModel.export_id, func.count().label("cnt"))
            .where(
                MapExportSlideModel.export_id.in_(export_ids),
                MapExportSlideModel.image_s3_key.is_not(None),
            )
            .group_by(MapExportSlideModel.export_id)
        ).all()
        counts_by_export = {row.export_id: row.cnt for row in upload_counts}
        for export_id, export_model in export_by_id.items():
            active_exports[export_model.map_id] = MapExport.create(
                export_model, counts_by_export.get(export_id, 0)
            )

    return [
        Map.create(m, uploads_by_id[m.source_upload_id], active_jobs.get(m.id), active_exports.get(m.id))
        for m in maps
        if m.source_upload_id and m.source_upload_id in uploads_by_id
    ]


@maps_router.get("/{map_id}", response_model=Map)
def get_map(
    map_id: str,
    db: DatabaseSession,
    current_user: CurrentUserDependency,
    permission_service: PermissionsServiceDependency,
) -> Map:
    """Get a single map with its active job and import state."""
    if not permission_service.check_for_map_access(
        user_id=current_user.id, map_id=map_id, map_roles=["OWNER", "MEMBER"]
    ):
        raise HTTPException(status_code=404, detail="Map not found")

    map_model = db.get(MapModel, map_id)
    if not map_model:
        raise HTTPException(status_code=404, detail="Map not found")

    if not map_model.source_upload_id:
        raise HTTPException(status_code=500, detail="Map is missing source upload reference")

    upload = db.get(MapUploadModel, map_model.source_upload_id)
    if not upload:
        raise HTTPException(status_code=500, detail="Map source upload record not found")

    job_row = (
        db.execute(
            select(MapJobModel)
            .where(MapJobModel.map_id == map_id)
            .order_by(MapJobModel.created_at.desc())
            .limit(1)
        )
        .scalars()
        .first()
    )
    active_job = MapJob.create(job_row) if job_row and job_row.status != "complete" else None

    export_row = (
        db.execute(
            select(MapExportModel)
            .where(MapExportModel.map_id == map_id, MapExportModel.status != "complete")
            .order_by(MapExportModel.created_at.desc())
            .limit(1)
        )
        .scalars()
        .first()
    )
    active_export: MapExport | None = None
    if export_row:
        uploaded_count = db.execute(
            select(func.count())
            .select_from(MapExportSlideModel)
            .where(
                MapExportSlideModel.export_id == export_row.id,
                MapExportSlideModel.image_s3_key.is_not(None),
            )
        ).scalar_one()
        active_export = MapExport.create(export_row, uploaded_count)

    return Map.create(map_model, upload, active_job, active_export)
