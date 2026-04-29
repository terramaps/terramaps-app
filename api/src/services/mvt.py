"""MVT tile rendering service."""

import math
import re
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import TextClause

from src.models.graph import LayerModel, MapModel

_SAFE_FIELD_RE = re.compile(r"^[a-z][a-z0-9_]*$")
_SAFE_AGG_RE = re.compile(r"^(sum|avg|min|max)$")

# Continental US bounding box (lon_min, lat_min, lon_max, lat_max), WGS84
_US_BBOX = (-124.85, 24.39, -66.88, 49.38)

_FILTER_BOUNDS_CTE = """
    filter_bounds AS (
        SELECT ST_Transform(
            ST_Expand(
                (SELECT geom FROM tile_bounds),
                ST_Distance(
                    ST_Point(ST_XMin((SELECT geom FROM tile_bounds)), ST_YMin((SELECT geom FROM tile_bounds))),
                    ST_Point(ST_XMax((SELECT geom FROM tile_bounds)), ST_YMax((SELECT geom FROM tile_bounds)))
                ) * 0.1
            ),
            4326
        ) AS geom
    )"""


def extract_data_fields(
    config: list[dict[str, Any]] | None,
) -> tuple[tuple[str, tuple[str, ...], int], ...]:
    if not config:
        return ()
    result: list[tuple[str, tuple[str, ...], int]] = []
    for f in config:
        fname = str(f.get("field", ""))
        raw_aggs: list[Any] = list(f.get("aggregations") or [])
        aggs: tuple[str, ...] = tuple(str(a) for a in raw_aggs if _SAFE_AGG_RE.match(str(a)))
        precision: int = max(1, min(4, int(f.get("precision", 4))))
        if _SAFE_FIELD_RE.match(fname) and aggs:
            result.append((fname, aggs, precision))
    return tuple(result)


def pick_zoom_col(z: int) -> str:
    if z <= 3:
        return "geom_z3"
    if z <= 7:
        return "geom_z7"
    return "geom_z11"


_SEP = ",\n                "


def _data_columns(fields: tuple[tuple[str, tuple[str, ...], int], ...], alias: str) -> str:
    """Numeric columns for the fill/feature tile layer (used by MapLibre style expressions)."""
    if not fields:
        return ""
    parts: list[str] = []
    for fname, aggs, _ in fields:
        for agg in aggs:
            parts.append(f"({alias}.data->'{fname}'->>'{agg}')::numeric AS {fname}_{agg}")
    return _SEP + _SEP.join(parts)


def _label_data_columns(fields: tuple[tuple[str, tuple[str, ...], int], ...], alias: str) -> str:
    """Text columns for the label tile layer — rounded to field precision, trailing zeros stripped."""
    if not fields:
        return ""
    parts: list[str] = []
    for fname, aggs, precision in fields:
        for agg in aggs:
            raw = f"({alias}.data->'{fname}'->>'{agg}')::numeric"
            parts.append(
                f"TRIM(TRAILING '0' FROM TRIM(TRAILING '.' FROM ROUND({raw}, {precision})::text))"
                f" AS {fname}_{agg}"
            )
    return _SEP + _SEP.join(parts)


def _data_column_aliases(fields: tuple[tuple[str, tuple[str, ...], int], ...]) -> str:
    if not fields:
        return ""
    parts: list[str] = []
    for fname, aggs, _ in fields:
        for agg in aggs:
            parts.append(f"{fname}_{agg}")
    return _SEP + _SEP.join(parts)


def _zip_data_columns(fields: tuple[tuple[str, tuple[str, ...], int], ...], alias: str) -> str:
    """Numeric columns for zip fill layer."""
    if not fields:
        return ""
    parts = [f"({alias}.data->>'{fname}')::numeric AS {fname}" for fname, _, _p in fields]
    return _SEP + _SEP.join(parts)


def _label_zip_data_columns(fields: tuple[tuple[str, tuple[str, ...], int], ...], alias: str) -> str:
    """Text columns for zip label layer — rounded, trailing zeros stripped."""
    if not fields:
        return ""
    parts: list[str] = []
    for fname, _, precision in fields:
        raw = f"({alias}.data->>'{fname}')::numeric"
        parts.append(
            f"TRIM(TRAILING '0' FROM TRIM(TRAILING '.' FROM ROUND({raw}, {precision})::text))"
            f" AS {fname}"
        )
    return _SEP + _SEP.join(parts)


def _zip_data_column_aliases(fields: tuple[tuple[str, tuple[str, ...], int], ...]) -> str:
    """Alias list for zip layer flat data columns."""
    if not fields:
        return ""
    return _SEP + _SEP.join(fname for fname, _, _p in fields)


def _node_query(col: str, data_fields: tuple[tuple[str, tuple[str, ...], int], ...]) -> TextClause:
    extra_numeric = _data_columns(data_fields, "n")
    extra_label = _label_data_columns(data_fields, "n")
    extra_aliases = _data_column_aliases(data_fields)
    return text(f"""
        WITH tile_bounds AS (
            SELECT ST_TileEnvelope(:z, :x, :y) AS geom
        ),
        {_FILTER_BOUNDS_CTE},
        tile_data AS (
            SELECT
                n.id,
                n.name,
                n.color,
                n.parent_node_id{extra_numeric},
                ST_AsMVTGeom(
                    n.{col}_merc,
                    (SELECT geom FROM tile_bounds),
                    4096, 256, true
                ) AS geom
            FROM nodes n
            WHERE n.layer_id = :layer_id
              AND n.{col} IS NOT NULL
              AND ST_Intersects(n.{col}, (SELECT geom FROM filter_bounds))
        ),
        label_points AS (
            SELECT
                n.id,
                n.name,
                n.color,
                n.parent_node_id{extra_label},
                ST_PointOnSurface(n.{col}_merc) AS pt
            FROM nodes n
            WHERE n.layer_id = :layer_id
              AND n.{col} IS NOT NULL
              AND ST_Intersects(n.{col}, (SELECT geom FROM filter_bounds))
        ),
        label_data AS (
            SELECT
                id,
                name,
                color,
                parent_node_id{extra_aliases},
                ST_AsMVTGeom(pt, (SELECT geom FROM tile_bounds), 4096, 256, false) AS geom
            FROM label_points
            WHERE ST_Within(pt, (SELECT geom FROM tile_bounds))
        )
        SELECT
            (
                SELECT ST_AsMVT(q, 'nodes', 4096, 'geom', 'id')
                FROM (SELECT * FROM tile_data WHERE geom IS NOT NULL) q
            ) ||
            (
                SELECT ST_AsMVT(q, 'node_labels', 4096, 'geom')
                FROM (SELECT * FROM label_data WHERE geom IS NOT NULL) q
            );
    """)  # noqa: S608


def _zip_query(col: str, data_fields: tuple[tuple[str, tuple[str, ...], int], ...]) -> TextClause:
    extra_numeric = _zip_data_columns(data_fields, "za")
    extra_label = _label_zip_data_columns(data_fields, "za")
    extra_aliases = _zip_data_column_aliases(data_fields)
    return text(f"""
        WITH tile_bounds AS (
            SELECT ST_TileEnvelope(:z, :x, :y) AS geom
        ),
        {_FILTER_BOUNDS_CTE},
        tile_data AS (
            SELECT
                gz.zip_code,
                COALESCE(za.color, '#FFFFFF') AS color,
                za.parent_node_id{extra_numeric},
                ST_AsMVTGeom(
                    gz.{col}_merc,
                    (SELECT geom FROM tile_bounds),
                    4096, 256, true
                ) AS geom
            FROM geography_zip_codes gz
            LEFT JOIN zip_assignments za
                ON za.zip_code = gz.zip_code
                AND za.layer_id = :layer_id
            WHERE gz.{col} IS NOT NULL
              AND ST_Intersects(gz.{col}, (SELECT geom FROM filter_bounds))
        ),
        label_points AS (
            SELECT
                gz.zip_code,
                COALESCE(za.color, '#FFFFFF') AS color,
                za.parent_node_id{extra_label},
                ST_PointOnSurface(gz.{col}_merc) AS pt
            FROM geography_zip_codes gz
            LEFT JOIN zip_assignments za
                ON za.zip_code = gz.zip_code
                AND za.layer_id = :layer_id
            WHERE gz.{col} IS NOT NULL
              AND ST_Intersects(gz.{col}, (SELECT geom FROM filter_bounds))
        ),
        label_data AS (
            SELECT
                zip_code,
                color,
                parent_node_id{extra_aliases},
                ST_AsMVTGeom(pt, (SELECT geom FROM tile_bounds), 4096, 256, false) AS geom
            FROM label_points
            WHERE ST_Within(pt, (SELECT geom FROM tile_bounds))
        )
        SELECT
            (
                SELECT ST_AsMVT(q, 'zips', 4096, 'geom')
                FROM (SELECT * FROM tile_data WHERE geom IS NOT NULL) q
            ) ||
            (
                SELECT ST_AsMVT(q, 'zip_labels', 4096, 'geom')
                FROM (SELECT * FROM label_data WHERE geom IS NOT NULL) q
            );
    """)  # noqa: S608


def render_tile(
    db: Session,
    layer: LayerModel,
    map_model: MapModel | None,
    z: int,
    x: int,
    y: int,
) -> bytes:
    """Render a single MVT tile and return the raw bytes (empty bytes if no features)."""
    col = pick_zoom_col(z)
    data_fields = extract_data_fields(map_model.data_field_config if map_model else None)
    query = _zip_query(col, data_fields) if layer.order == 0 else _node_query(col, data_fields)
    result = db.execute(query, {"layer_id": layer.id, "z": z, "x": x, "y": y}).scalar()
    return bytes(result) if result else b""


def tiles_for_us(z_min: int = 3, z_max: int = 7) -> list[tuple[int, int, int]]:
    """Return all (z, x, y) tile coordinates covering the continental US for z_min..z_max."""
    min_lon, min_lat, max_lon, max_lat = _US_BBOX
    tiles: list[tuple[int, int, int]] = []
    for z in range(z_min, z_max + 1):
        n = 2**z
        x_min = int(math.floor((min_lon + 180.0) / 360.0 * n))
        x_max = int(math.floor((max_lon + 180.0) / 360.0 * n))
        # Mercator: north (larger lat) maps to smaller y
        y_min = int(
            math.floor(
                (1.0 - math.log(math.tan(math.radians(max_lat)) + 1.0 / math.cos(math.radians(max_lat))) / math.pi)
                / 2.0
                * n
            )
        )
        y_max = int(
            math.floor(
                (1.0 - math.log(math.tan(math.radians(min_lat)) + 1.0 / math.cos(math.radians(min_lat))) / math.pi)
                / 2.0
                * n
            )
        )
        for x in range(x_min, x_max + 1):
            for y in range(y_min, y_max + 1):
                tiles.append((z, x, y))
    return tiles
