"""MVT (Mapbox Vector Tile) router for rendering geographic data."""

from fastapi import APIRouter, HTTPException, Response

from src.app.database import DatabaseSession
from src.models.graph import LayerModel, MapModel
from src.services import mvt as mvt_service
from src.services import mvt_cache

mvt_router = APIRouter(prefix="/tiles", tags=["MVT"])

_TILE_HEADERS = {
    "Content-Type": "application/x-protobuf",
    "Cache-Control": "public, max-age=86400",
}


@mvt_router.get("/{layer_id}/{z}/{x}/{y}.pbf")
def get_tile(
    layer_id: int,
    z: int,
    x: int,
    y: int,
    db: DatabaseSession,
):
    """Get a vector tile for a specific layer at the given tile coordinates.

    For order=0 (zip) layers: queries geography_zip_codes LEFT JOIN zip_assignments.
    For order>=1 layers: queries pre-computed node geometries.
    Data fields from data_field_config are included as flat numeric properties.
    """
    if z < 3 or z > 11:
        raise HTTPException(status_code=400, detail="Invalid zoom level")

    cached = mvt_cache.get_tile(db, layer_id, "fill", z, x, y)
    if cached is not None:
        return Response(content=cached, media_type="application/x-protobuf", headers=_TILE_HEADERS)

    layer = db.get(LayerModel, layer_id)
    if layer is None:
        raise HTTPException(status_code=404, detail="Layer not found")

    map_model = db.get(MapModel, layer.map_id)
    tile_bytes = mvt_service.render_tile(db, layer, map_model, z, x, y)
    mvt_cache.save_tile(db, layer_id, "fill", z, x, y, tile_bytes)

    return Response(content=tile_bytes, media_type="application/x-protobuf", headers=_TILE_HEADERS)


@mvt_router.get("/warm")
def warm_cache(map_id: str):
    from src.workers.tasks.maps import warm_map_mvt_cache_task

    warm_map_mvt_cache_task.delay(map_id)
