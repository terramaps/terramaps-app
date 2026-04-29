"""PPT export router.

Handles the full lifecycle of a map's PowerPoint territory report export.

Routes:
    POST   /maps/{map_id}/exports/ppt                               — create export, pre-compute all slides
    GET    /maps/{map_id}/exports/ppt/{export_id}/next              — get next capture instruction (or done)
    POST   /maps/{map_id}/exports/ppt/{export_id}/slides/{slide_id} — upload screenshot for a slide
    POST   /maps/{map_id}/exports/ppt/{export_id}/generate          — assemble + stream .pptx  [TODO: worker]
    DELETE /maps/{map_id}/exports/ppt/{export_id}                   — cancel and clean up
"""

import uuid

from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select

from src.app.database import DatabaseSession
from src.models.exports import MapExportModel, MapExportSlideModel
from src.models.graph import MapModel
from src.schemas.exports import CreateExportResponse, NextSlideResponse
from src.services.auth import CurrentUserDependency
from src.services.permissions import PermissionsServiceDependency
from src.services.ppt_builder import build_pptx_chunks
from src.services.ppt_exports import PptExportServiceDependency
from src.services.s3 import S3ServiceDependency

ppt_exports_router = APIRouter(prefix="/maps", tags=["PPT Exports"])

_S3_PREFIX = "map-exports"


@ppt_exports_router.post("/{map_id}/exports/ppt", response_model=CreateExportResponse, status_code=201)
def create_ppt_export(
    map_id: str,
    db: DatabaseSession,
    current_user: CurrentUserDependency,
    permission_service: PermissionsServiceDependency,
    export_service: PptExportServiceDependency,
    s3: S3ServiceDependency,
) -> CreateExportResponse:
    """Create a new PPT export session.

    Cancels any existing non-complete export for this map, then traverses the
    node hierarchy to pre-compute all slide records. Bbox computation is deferred
    to GET /next so this returns immediately.
    """
    if not permission_service.check_for_map_access(user_id=current_user.id, map_id=map_id, map_roles=["OWNER"]):
        raise HTTPException(status_code=404, detail="Map not found")

    map_model = db.get(MapModel, map_id)
    if not map_model:
        raise HTTPException(status_code=404, detail="Map not found")

    existing = (
        db.execute(
            select(MapExportModel)
            .where(MapExportModel.map_id == map_id, MapExportModel.status != "complete")
            .order_by(MapExportModel.created_at.desc())
            .limit(1)
        )
        .scalars()
        .first()
    )
    # if existing:
    #     export_service.cancel_export(existing, s3)

    export = export_service.create_export(map_id)
    db.commit()
    return CreateExportResponse(id=export.id, total_slides=export.total_slides)


@ppt_exports_router.get("/{map_id}/exports/ppt/{export_id}/next", response_model=NextSlideResponse)
def get_next_slide(
    map_id: str,
    export_id: str,
    db: DatabaseSession,
    current_user: CurrentUserDependency,
    permission_service: PermissionsServiceDependency,
    export_service: PptExportServiceDependency,
) -> NextSlideResponse:
    """Return the next slide capture instruction.

    Finds the lowest-order slide with no image_s3_key. Computes and persists its
    bbox on first access via PostGIS. Returns done=True once all slides have been
    uploaded.
    """
    if not permission_service.check_for_map_access(user_id=current_user.id, map_id=map_id, map_roles=["OWNER"]):
        raise HTTPException(status_code=404, detail="Map not found")

    export = db.get(MapExportModel, export_id)
    if not export or export.map_id != map_id:
        raise HTTPException(status_code=404, detail="Export not found")

    uploaded_count = db.execute(
        select(func.count())
        .select_from(MapExportSlideModel)
        .where(
            MapExportSlideModel.export_id == export_id,
            MapExportSlideModel.image_s3_key.is_not(None),
        )
    ).scalar_one()

    next_slide = (
        db.execute(
            select(MapExportSlideModel)
            .where(
                MapExportSlideModel.export_id == export_id,
                MapExportSlideModel.image_s3_key.is_(None),
            )
            .order_by(MapExportSlideModel.order)
            .limit(1)
        )
        .scalars()
        .first()
    )

    if not next_slide:
        return NextSlideResponse(done=True, total_slides=export.total_slides, uploaded_slides=uploaded_count)

    if next_slide.bbox_min_lng is None:
        export_service.compute_slide_bbox(next_slide)
        db.commit()

    return NextSlideResponse(
        done=False,
        slide_id=next_slide.id,
        order=next_slide.order,
        title=next_slide.title,
        layer_id=next_slide.layer_id,
        parent_node_id=next_slide.parent_node_id,
        bbox_min_lng=next_slide.bbox_min_lng,
        bbox_min_lat=next_slide.bbox_min_lat,
        bbox_max_lng=next_slide.bbox_max_lng,
        bbox_max_lat=next_slide.bbox_max_lat,
        total_slides=export.total_slides,
        uploaded_slides=uploaded_count,
    )


@ppt_exports_router.post("/{map_id}/exports/ppt/{export_id}/slides/{slide_id}", status_code=204)
def upload_slide(
    map_id: str,
    export_id: str,
    slide_id: int,
    image: UploadFile,
    db: DatabaseSession,
    current_user: CurrentUserDependency,
    permission_service: PermissionsServiceDependency,
    s3: S3ServiceDependency,
) -> None:
    """Upload the screenshot for a slide.

    Streams the image to S3 under a new UUID key and records it on the slide row.
    Idempotent: re-uploading replaces the previous S3 object.
    """
    if not permission_service.check_for_map_access(user_id=current_user.id, map_id=map_id, map_roles=["OWNER"]):
        raise HTTPException(status_code=404, detail="Map not found")

    export = db.get(MapExportModel, export_id)
    if not export or export.map_id != map_id:
        raise HTTPException(status_code=404, detail="Export not found")

    slide = db.get(MapExportSlideModel, slide_id)
    if not slide or slide.export_id != export_id:
        raise HTTPException(status_code=404, detail="Slide not found")

    if slide.image_s3_key:
        s3.delete_private_file(key=slide.image_s3_key)

    s3_key = f"{_S3_PREFIX}/{export_id}/{uuid.uuid4()}.png"
    s3.upload_private_file(file=image.file, content_type=image.content_type, key=s3_key)

    slide.image_s3_key = s3_key
    if export.status == "pending":
        export.status = "in_progress"
    db.commit()


@ppt_exports_router.post("/{map_id}/exports/ppt/{export_id}/generate")
def generate_ppt(
    map_id: str,
    export_id: str,
    db: DatabaseSession,
    current_user: CurrentUserDependency,
    permission_service: PermissionsServiceDependency,
    s3: S3ServiceDependency,
) -> StreamingResponse:
    """Build and stream the .pptx territory report.

    Fetches slide images from S3 one at a time, assembles the presentation
    with python-pptx, and streams the result back to the caller.
    """
    if not permission_service.check_for_map_access(user_id=current_user.id, map_id=map_id, map_roles=["OWNER"]):
        raise HTTPException(status_code=404, detail="Map not found")

    export = db.get(MapExportModel, export_id)
    if not export or export.map_id != map_id:
        raise HTTPException(status_code=404, detail="Export not found")

    any_missing = db.execute(
        select(func.count())
        .select_from(MapExportSlideModel)
        .where(
            MapExportSlideModel.export_id == export_id,
            MapExportSlideModel.image_s3_key.is_(None),
        )
    ).scalar_one()
    if any_missing:
        raise HTTPException(status_code=409, detail="Not all slides have been uploaded yet.")

    slides = (
        db.execute(
            select(MapExportSlideModel)
            .where(MapExportSlideModel.export_id == export_id)
            .order_by(MapExportSlideModel.order)
        )
        .scalars()
        .all()
    )

    map_model = db.get(MapModel, map_id)
    filename = f"{map_model.name} Territory Report.pptx" if map_model else "Territory Report.pptx"

    export.status = "complete"
    db.commit()

    return StreamingResponse(
        build_pptx_chunks(slides, s3),
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@ppt_exports_router.delete("/{map_id}/exports/ppt/{export_id}", status_code=204)
def cancel_ppt_export(
    map_id: str,
    export_id: str,
    db: DatabaseSession,
    current_user: CurrentUserDependency,
    permission_service: PermissionsServiceDependency,
    export_service: PptExportServiceDependency,
    s3: S3ServiceDependency,
) -> None:
    """Cancel an export and delete all associated S3 files and DB rows."""
    if not permission_service.check_for_map_access(user_id=current_user.id, map_id=map_id, map_roles=["OWNER"]):
        raise HTTPException(status_code=404, detail="Map not found")

    export = db.get(MapExportModel, export_id)
    if not export or export.map_id != map_id:
        raise HTTPException(status_code=404, detail="Export not found")

    export_service.cancel_export(export, s3)
    db.commit()
