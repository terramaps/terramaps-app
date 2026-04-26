"""MVT tile cache service."""

from typing import Any

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from src.models.cache import MvtTileCacheModel


def get_tile(db: Session, layer_id: int, endpoint: str, z: int, x: int, y: int) -> bytes | None:
    row = db.get(MvtTileCacheModel, (layer_id, endpoint, z, x, y))
    return row.tile_bytes if row is not None else None


def save_tile(db: Session, layer_id: int, endpoint: str, z: int, x: int, y: int, tile_bytes: bytes) -> None:
    stmt = (
        pg_insert(MvtTileCacheModel)
        .values(layer_id=layer_id, endpoint=endpoint, z=z, x=x, y=y, tile_bytes=tile_bytes)
        .on_conflict_do_nothing()
    )
    db.execute(stmt)
    db.commit()


def save_tiles_batch(db: Session, rows: list[dict[str, Any]]) -> None:
    """Bulk-insert tiles without committing. Caller is responsible for the commit."""
    if not rows:
        return
    db.execute(pg_insert(MvtTileCacheModel).values(rows).on_conflict_do_nothing())


def invalidate_layer(db: Session, layer_id: int) -> None:
    db.query(MvtTileCacheModel).filter(MvtTileCacheModel.layer_id == layer_id).delete()
    db.commit()


def invalidate_tiles(db: Session, layer_id: int, tiles: list[tuple[int, int, int]]) -> None:
    """Invalidate specific (z, x, y) tiles for a layer across all endpoints."""
    if not tiles:
        return
    db.execute(
        text("""
            DELETE FROM mvt_tile_cache
            WHERE layer_id = :layer_id
              AND (z, x, y) IN (SELECT z, x, y FROM unnest(:tiles) AS t(z int, x int, y int))
        """),
        {"layer_id": layer_id, "tiles": tiles},
    )
    db.commit()
