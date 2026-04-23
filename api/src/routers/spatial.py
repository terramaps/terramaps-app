"""Router for spatial operations."""

from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select, text

from src.app.database import DatabaseSession
from src.models.graph import LayerModel, NodeModel
from src.schemas.dtos.spatial import SpatialSelectRequest, SpatialSelectResponse

spatial_router = APIRouter(prefix="/spatial", tags=["Spatial"])


@spatial_router.post("/select", response_model=SpatialSelectResponse)
def select_features_in_lasso(selection: SpatialSelectRequest, db: DatabaseSession):
    """Select all features from a layer that intersect with a lasso polygon.

    For order=0 (zip) layers: returns zip_codes (strings) from geography_zip_codes.
    For order>=1 layers: returns node IDs (integers) from nodes.
    """
    layer = db.get(LayerModel, selection.layer_id)
    if layer is None:
        raise HTTPException(status_code=404, detail="Layer not found")

    polygon_geojson = selection.polygon.model_dump_json()

    if layer.order == 0:
        # Zip layer: intersect against geography_zip_codes geometries
        result = db.execute(
            text("""
                SELECT
                    COUNT(*) AS count,
                    ARRAY_AGG(gz.zip_code ORDER BY gz.zip_code) AS zip_codes
                FROM geography_zip_codes gz
                WHERE gz.geom_z11 IS NOT NULL
                  AND ST_Intersects(gz.geom_z11, ST_GeomFromGeoJSON(:polygon))
            """),
            {"polygon": polygon_geojson},
        ).one()
        count = result.count or 0
        zip_codes = list(result.zip_codes) if result.zip_codes else []
        return SpatialSelectResponse(count=count, nodes=[], zip_codes=zip_codes)

    # Node layer: intersect against node geometries
    count, ids = (
        db.execute(
            select(
                func.count(NodeModel.id).label("count"),
                func.array_agg(NodeModel.id).label("ids"),
            ).where(
                NodeModel.layer_id == selection.layer_id,
                NodeModel.geom_z11.isnot(None),
                func.ST_Intersects(
                    NodeModel.geom_z11,
                    func.ST_GeomFromGeoJSON(polygon_geojson),
                ),
            )
        )
        .tuples()
        .one()
    )
    return SpatialSelectResponse(count=count or 0, nodes=list[int](ids or []))
