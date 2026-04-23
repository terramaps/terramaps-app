"""added zip code geography.

Revision ID: bd9a96a540db
Revises: dc2613846b7f
Create Date: 2025-12-28 09:59:24.701614-08:00

"""

from collections.abc import Sequence
from pathlib import Path
from typing import TYPE_CHECKING, cast

from alembic import op as _op

if TYPE_CHECKING:
    from geoalchemy2.alembic_helpers import GeoAlchemyOperations

    op: GeoAlchemyOperations = cast("GeoAlchemyOperations", _op)
else:
    op = _op  # type: ignore[assignment]

from sqlalchemy import text

# revision identifiers, used by Alembic.
revision: str = "bd9a96a540db"
down_revision: str | None = "dc2613846b7f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SQL_FILE = Path(__file__).resolve().parent.parent / "data" / "secret" / "All-ZIP-Boundaries_postgre.sql"

_GEOM_KWARGS = {
    "srid": 4326,
    "dimension": 2,
    "spatial_index": False,
    "from_text": "ST_GeomFromEWKT",
    "name": "geometry",
}

_COPY_SQL = text("""
    INSERT INTO geography_zip_codes (zip_code, color, geom, geom_z3, geom_z7, geom_z11)
    SELECT DISTINCT ON (lpad(zip, 5, '0'))
        lpad(zip, 5, '0'),
        COALESCE(color, '#000000'),
        ST_MakeValid(geom),
        ST_Transform(ST_MakeValid(ST_SnapToGrid(ST_Transform(geom, 3857), 19568.0)), 4326),
        ST_Transform(ST_MakeValid(ST_SnapToGrid(ST_Transform(geom, 3857),  1223.0)), 4326),
        ST_Transform(ST_MakeValid(ST_SnapToGrid(ST_Transform(geom, 3857),    76.0)), 4326)
    FROM boundary_data
    WHERE zip IS NOT NULL
      AND zip != ''
      AND zip != '00000'
      AND geom IS NOT NULL
    ORDER BY lpad(zip, 5, '0')
""")


_CHUNK_SIZE = 4 * 1024 * 1024  # 4 MB — amortizes Python overhead; peak mem ~2x chunk


def _iter_sql_statements(path: Path):
    # ";\n" is safe as a delimiter — WKT coordinate strings never contain that sequence.
    buf = ""
    with path.open() as f:
        while chunk := f.read(_CHUNK_SIZE):
            buf += chunk
            while ";\n" in buf:
                idx = buf.index(";\n")
                stmt = buf[:idx].strip()
                if stmt:
                    yield stmt
                buf = buf[idx + 2 :]
    if stmt := buf.strip():
        yield stmt


def upgrade() -> None:
    """Upgrade revisions: dc2613846b7f to bd9a96a540db."""
    connection = op.get_bind()

    # Load Boundary_Data from the vendor SQL dump (creates the table + inserts all rows).
    for stmt in _iter_sql_statements(_SQL_FILE):
        connection.exec_driver_sql(stmt)

    # Copy into geography_zip_codes with all zoom levels computed in one pass.
    connection.execute(_COPY_SQL)

    # Drop the staging table — no longer needed.
    connection.exec_driver_sql("DROP TABLE boundary_data")


def downgrade() -> None:
    """Downgrade revisions: bd9a96a540db to dc2613846b7f."""
    op.execute("TRUNCATE TABLE geography_zip_codes RESTART IDENTITY CASCADE")
