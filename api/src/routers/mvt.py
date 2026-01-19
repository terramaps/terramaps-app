"""MVT (Mapbox Vector Tile) router for rendering geographic data."""

from fastapi import APIRouter, HTTPException, Response
from sqlalchemy import text

from src.app.database import DatabaseSession

mvt_router = APIRouter(prefix="/tiles", tags=["MVT"])


@mvt_router.get("/{layer_id}/{z}/{x}/{y}.pbf")
def get_tile(layer_id: int, z: int, x: int, y: int, db: DatabaseSession):
    """Get a vector tile for a specific layer at the given tile coordinates.

    Args:
        layer_id: The layer ID to render nodes from
        z: Zoom level
        x: Tile X coordinate
        y: Tile Y coordinate
        db: Database session

    Returns:
        Mapbox Vector Tile (MVT) in protobuf format
    """
    # Validate zoom level
    if z < 0 or z > 20:
        raise HTTPException(status_code=400, detail="Invalid zoom level")

    # Query to generate MVT using precomputed node geometries only
    query = text("""
        WITH tile_bounds AS (
            SELECT ST_TileEnvelope(:z, :x, :y) AS geom
        ),
        expanded_bounds AS (
            SELECT ST_Expand(geom, ST_Distance(
                ST_Point(ST_XMin(geom), ST_YMin(geom)),
                ST_Point(ST_XMax(geom), ST_YMax(geom))
            ) * 0.1) AS geom
            FROM tile_bounds
        ),
        tile_data AS (
            SELECT
                n.id,
                n.name,
                n.color,
                ST_AsMVTGeom(
                    ST_Transform(n.geom, 3857),
                    (SELECT geom FROM tile_bounds),
                    4096,
                    256,
                    true
                ) AS geom
            FROM nodes n, expanded_bounds
            WHERE n.layer_id = :layer_id
              AND n.geom IS NOT NULL
              AND ST_Intersects(
                    ST_Transform(n.geom, 3857),
                    expanded_bounds.geom
                )
        )
        SELECT ST_AsMVT(tile_data, 'nodes', 4096, 'geom', 'id')
        FROM tile_data
        WHERE tile_data.geom IS NOT NULL;
    """)

    result = db.execute(query, {"layer_id": layer_id, "z": z, "x": x, "y": y}).scalar()

    # Return empty tile if no data found
    if result is None:
        result = b""

    return Response(
        content=bytes(result),
        media_type="application/x-protobuf",
        headers={
            "Content-Type": "application/x-protobuf",
            "Cache-Control": "public, max-age=3600",
        },
    )


@mvt_router.get("/layers")
def list_tile_layers(db: DatabaseSession):
    """List all available layers that can be rendered as tiles.

    Returns a list of layers with their IDs and names, which can be used
    to construct tile URLs.
    """
    query = text("""
        SELECT
            l.id,
            l.name,
            l.order,
            COUNT(n.id) as node_count
        FROM layers l
        LEFT JOIN nodes n ON n.layer_id = l.id AND n.geom IS NOT NULL
        GROUP BY l.id, l.name, l.order
        ORDER BY l.order
    """)

    result = db.execute(query).mappings().all()

    return [
        {
            "id": row["id"],
            "name": row["name"],
            "order": row["order"],
            "node_count": row["node_count"],
            "tile_url": f"/tiles/{row['id']}/{{z}}/{{x}}/{{y}}.pbf",
        }
        for row in result
    ]
