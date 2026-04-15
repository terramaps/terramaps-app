"""MVT (Mapbox Vector Tile) router for rendering geographic data."""

from fastapi import APIRouter, HTTPException, Response
from sqlalchemy import select, text

from src.app.database import DatabaseSession
from src.models.graph import LayerModel, MapModel

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
        filter_bounds AS (
            SELECT ST_Transform(geom, 4326) AS geom
            FROM expanded_bounds
        ),
        tile_data AS (
            SELECT
                n.id,
                n.name,
                n.color,
                ST_AsMVTGeom(
                    ST_Transform(
                        CASE
                            WHEN :z <= 3  THEN COALESCE(n.geom_z3,  n.geom)
                            WHEN :z <= 7  THEN COALESCE(n.geom_z7,  n.geom)
                            WHEN :z <= 11 THEN COALESCE(n.geom_z11, n.geom)
                            WHEN :z <= 15 THEN COALESCE(n.geom_z15, n.geom)
                            ELSE n.geom
                        END,
                        3857
                    ),
                    (SELECT geom FROM tile_bounds),
                    4096,
                    256,
                    true
                ) AS geom
            FROM nodes n
            WHERE n.layer_id = :layer_id
              AND n.geom IS NOT NULL
              AND ST_Intersects(n.geom, (SELECT geom FROM filter_bounds))
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


@mvt_router.get("/{layer_id}/{z}/{x}/{y}/labels.pbf")
def get_label_tile(layer_id: int, z: int, x: int, y: int, db: DatabaseSession):
    """Get a label tile for a specific layer using point-on-surface geometries.

    Returns one point per node (the pole of inaccessibility), so each polygon
    gets exactly one label placement regardless of how many tiles it spans.
    Includes all configured data field values as tile properties so the frontend
    can dynamically switch the displayed label field.
    """
    if z < 0 or z > 20:
        raise HTTPException(status_code=400, detail="Invalid zoom level")

    # Look up the map's data_field_config via the layer so we can include
    # data field values as properties in the MVT.
    data_field_config = db.execute(
        select(MapModel.data_field_config)
        .join(LayerModel, LayerModel.map_id == MapModel.id)
        .where(LayerModel.id == layer_id)
    ).scalar()

    # Build extra SELECT fragments for each configured data field/aggregation.
    extra_label_selects = ""
    extra_tile_selects = ""
    if data_field_config:
        for field_config in data_field_config:
            for agg in field_config.get("aggregations", []):
                key = f"{field_config['field']}_{agg}"
                extra_label_selects += f',\n                n.data->>{key!r} AS "{key}"'
                extra_tile_selects += f',\n                lp."{key}"'

    query = text(f"""
        WITH tile_bounds AS (
            SELECT ST_TileEnvelope(:z, :x, :y) AS geom
        ),
        label_points AS (
            SELECT
                n.id,
                n.name{extra_label_selects},
                ST_Transform(ST_PointOnSurface(n.geom), 3857) AS pt
            FROM nodes n
            WHERE n.layer_id = :layer_id
              AND n.geom IS NOT NULL
        ),
        tile_data AS (
            SELECT
                lp.id,
                lp.name{extra_tile_selects},
                ST_AsMVTGeom(lp.pt, (SELECT geom FROM tile_bounds), 4096, 0, false) AS geom
            FROM label_points lp
            WHERE ST_Intersects(lp.pt, (SELECT geom FROM tile_bounds))
        )
        SELECT ST_AsMVT(tile_data, 'nodes', 4096, 'geom', 'id')
        FROM tile_data
        WHERE tile_data.geom IS NOT NULL;
    """)

    result = db.execute(query, {"layer_id": layer_id, "z": z, "x": x, "y": y}).scalar()

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
