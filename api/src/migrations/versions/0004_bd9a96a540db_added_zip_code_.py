"""added zip code geography.

Revision ID: bd9a96a540db
Revises: 700f9e50e2e7
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

import sqlalchemy as sa
from geoalchemy2 import Geometry
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision: str = "bd9a96a540db"
down_revision: str | None = "700f9e50e2e7"
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
    INSERT INTO geography_zip_codes (zip_code, geom, geom_z3, geom_z7, geom_z11, geom_z15)
    SELECT DISTINCT ON (lpad(zip, 5, '0'))
        lpad(zip, 5, '0'),
        geom,
        ST_Transform(ST_MakeValid(ST_SnapToGrid(ST_Transform(geom, 3857), 19568.0)), 4326),
        ST_Transform(ST_MakeValid(ST_SnapToGrid(ST_Transform(geom, 3857),  1223.0)), 4326),
        ST_Transform(ST_MakeValid(ST_SnapToGrid(ST_Transform(geom, 3857),    76.0)), 4326),
        ST_Transform(ST_MakeValid(ST_SnapToGrid(ST_Transform(geom, 3857),     4.8)), 4326)
    FROM boundary_data
    WHERE zip IS NOT NULL
      AND zip != ''
      AND zip != '00000'
      AND geom IS NOT NULL
    ORDER BY lpad(zip, 5, '0')
""")


def upgrade() -> None:
    """Upgrade revisions: 700f9e50e2e7 to bd9a96a540db."""
    op.create_geospatial_table(
        "geography_zip_codes",
        sa.Column("zip_code", sa.String(length=5), nullable=False),
        sa.Column(
            "geom",
            Geometry(srid=4326, dimension=2, spatial_index=False, from_text="ST_GeomFromEWKT", name="geometry"),
            nullable=True,
        ),
        sa.Column(
            "geom_z3",
            Geometry(srid=4326, dimension=2, spatial_index=False, from_text="ST_GeomFromEWKT", name="geometry"),
            nullable=True,
        ),
        sa.Column(
            "geom_z7",
            Geometry(srid=4326, dimension=2, spatial_index=False, from_text="ST_GeomFromEWKT", name="geometry"),
            nullable=True,
        ),
        sa.Column(
            "geom_z11",
            Geometry(srid=4326, dimension=2, spatial_index=False, from_text="ST_GeomFromEWKT", name="geometry"),
            nullable=True,
        ),
        sa.Column(
            "geom_z15",
            Geometry(srid=4326, dimension=2, spatial_index=False, from_text="ST_GeomFromEWKT", name="geometry"),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("zip_code", name=op.f("pk_geography_zip_codes")),
    )
    op.create_geospatial_index(
        "idx_geography_zip_codes_geom",
        "geography_zip_codes",
        ["geom"],
        unique=False,
        postgresql_using="gist",
        postgresql_ops={},
    )

    connection = op.get_bind()

    # Load Boundary_Data from the vendor SQL dump (creates the table + inserts all rows).
    # Split on ";\n" — safe because WKT coordinate strings never contain that sequence.
    sql_content = _SQL_FILE.read_text()
    for statement in sql_content.split(";\n"):
        stmt = statement.strip()
        if stmt:
            connection.exec_driver_sql(stmt)

    # Copy into geography_zip_codes with all zoom levels computed in one pass.
    connection.execute(_COPY_SQL)

    # Drop the staging table — no longer needed.
    connection.exec_driver_sql("DROP TABLE boundary_data")


def downgrade() -> None:
    """Downgrade revisions: bd9a96a540db to 700f9e50e2e7."""
    op.drop_geospatial_index(
        "idx_geography_zip_codes_geom",
        table_name="geography_zip_codes",
        postgresql_using="gist",
        column_name="geom",
    )
    op.drop_geospatial_table("geography_zip_codes")
