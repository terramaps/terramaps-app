"""Background tasks for map operations."""

import contextlib
import hashlib
import io
import logging
import re
import time
from typing import Any

import pandas as pd
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from src.models.geography import ZipCodeGeography
from src.models.graph import LayerModel, MapModel, NodeModel, ZipAssignmentModel
from src.models.uploads import MapUploadModel
from src.services import mvt as mvt_service
from src.services import mvt_cache
from src.services.computation import ComputationService
from src.services.s3 import S3Service
from src.workers import DatabaseTask, celery_app

logger = logging.getLogger(__name__)

_TERRITORY_PALETTE = [
    "#E63946",
    "#F4A261",
    "#2A9D8F",
    "#457B9D",
    "#6A4C93",
    "#F72585",
    "#4CC9F0",
    "#7CB518",
    "#FB8500",
    "#023E8A",
    "#8338EC",
    "#FF006E",
    "#3A86FF",
    "#06D6A0",
    "#FFBE0B",
    "#FB5607",
]


def _normalize_cell(x: object) -> object:
    """Normalize a hierarchy column cell to a canonical string.

    Applied to layer/hierarchy columns only — never data field columns.
    1.0 → "1", 1.2 → "1.2", bool/NaN/None → unchanged.
    """
    if isinstance(x, bool) or pd.isna(x):  # type: ignore[arg-type]
        return x
    if isinstance(x, (int, float)):
        fval = float(x)
        return str(int(fval)) if fval == int(fval) else str(fval)
    return x


def _normalize_field_key(name: str) -> str:
    key = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return key or "field"


def _set_import_step(task: DatabaseTask, upload: MapUploadModel, step: str) -> None:
    upload.import_step = step
    task.db.flush()
    task.db.commit()


def _download_and_parse(s3_key: str, tab_index: int) -> pd.DataFrame:
    """Download file from S3 and parse the target sheet into a DataFrame."""
    s3 = S3Service()
    body = s3.get_private_object(key=s3_key)
    file_bytes = io.BytesIO(body.read())
    return pd.read_excel(file_bytes, sheet_name=tab_index, header=0, dtype=object)


def _validate_columns(
    df: pd.DataFrame,
    layer_configs: list[dict[str, Any]],
    data_field_cfgs: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    """Return (valid_layer_configs, valid_data_cfgs, warnings) after checking columns exist."""
    all_columns = set(df.columns.tolist())
    warnings: list[str] = []
    for h in [lc["header"] for lc in layer_configs] + [dc["header"] for dc in data_field_cfgs]:
        if h not in all_columns:
            warnings.append(f"Column '{h}' not found in spreadsheet")
    valid_layers = [lc for lc in layer_configs if lc["header"] in all_columns]
    valid_data = [dc for dc in data_field_cfgs if dc["header"] in all_columns]
    return valid_layers, valid_data, warnings


def _build_parent_lookup(
    rows_df: pd.DataFrame,
    previous_header: str,
    previous_nodes: pd.DataFrame,
    current_header: str,
    warnings: list[str],
) -> pd.DataFrame:
    """Attach parent_node_id column to rows_df via name→id lookup."""
    name_to_id: dict[str, int] = dict(zip(previous_nodes["name"].astype(str), previous_nodes["id"], strict=False))
    rows_df["parent_node_id"] = rows_df[previous_header].apply(
        lambda x, m=name_to_id: m.get(str(x)) if pd.notna(x) and x != "" else None
    )
    misses = rows_df[
        rows_df["parent_node_id"].isna() & rows_df[previous_header].notna() & (rows_df[previous_header] != "")
    ]
    if not misses.empty:
        sample = misses[previous_header].unique().tolist()[:5]
        warnings.append(
            f"Layer '{current_header}': {len(misses)} rows had unresolvable parent "
            f"values in '{previous_header}'. Sample: {sample}"
        )
    return rows_df


def _insert_zip_layer(
    task: DatabaseTask,
    layer_id: int,
    header: str,
    rows_df: pd.DataFrame,
    number_fields: list[dict[str, Any]],
    warnings: list[str],
    source_df: pd.DataFrame | None = None,
) -> None:
    """Insert ZipAssignmentModel rows for the zip (order=0) layer."""
    rows_df = rows_df.copy()
    rows_df[header] = rows_df[header].astype(str).str.zfill(5)
    zip_codes_in_file = rows_df[header].tolist()

    valid_zips = set(
        task.db.execute(select(ZipCodeGeography.zip_code).where(ZipCodeGeography.zip_code.in_(zip_codes_in_file)))
        .scalars()
        .all()
    )
    missing = set(zip_codes_in_file) - valid_zips
    if missing:
        warnings.append(f"{len(missing)} zip codes not found in geography database. Sample: {sorted(missing)[:10]}")

    rows_df = rows_df[rows_df[header].isin(valid_zips)].copy()

    if number_fields and source_df is not None:
        data_col_names = [dc["header"] for dc in number_fields]
        src = source_df[[header, *data_col_names]].copy()
        src[header] = src[header].astype(str).str.zfill(5)
        src = src[src[header].isin(valid_zips)].drop_duplicates(subset=[header])
        rows_df = rows_df.merge(src, on=header, how="left")

    colors: dict[str, str] = dict(
        task.db.execute(
            select(ZipCodeGeography.zip_code, ZipCodeGeography.color).where(
                ZipCodeGeography.zip_code.in_(rows_df[header].tolist())
            )
        ).all()
    )

    zip_rows: list[dict[str, Any]] = []
    for _, row in rows_df.iterrows():
        z = str(row[header])
        p = row.get("parent_node_id")
        zip_data: dict[str, Any] | None = None
        if number_fields:
            field_data: dict[str, Any] = {}
            for dc in number_fields:
                raw = row.get(dc["header"])
                if raw is not None and not (isinstance(raw, float) and pd.isna(raw)):
                    with contextlib.suppress(ValueError, TypeError):
                        field_data[_normalize_field_key(dc["name"])] = float(raw)
            zip_data = field_data or None
        zip_rows.append({
            "layer_id": layer_id,
            "zip_code": z,
            "parent_node_id": int(p) if pd.notna(p) else None,
            "color": colors.get(z, "#CCCCCC"),
            "data": zip_data,
        })

    if zip_rows:
        task.db.execute(insert(ZipAssignmentModel).values(zip_rows))


def _insert_node_layer(
    task: DatabaseTask,
    layer_id: int,
    header: str,
    rows_df: pd.DataFrame,
) -> pd.DataFrame:
    """Insert NodeModel rows and return a DataFrame(id, name) for parent lookup."""
    names = rows_df[header].tolist()
    parent_ids = rows_df["parent_node_id"].tolist()
    node_rows = [
        {
            "layer_id": layer_id,
            "name": str(name),
            "parent_node_id": int(p) if pd.notna(p) else None,
            "color": _TERRITORY_PALETTE[
                int(hashlib.md5(str(name).encode(), usedforsecurity=False).hexdigest(), 16) % len(_TERRITORY_PALETTE)
            ],
            "data": None,
        }
        for name, p in zip(names, parent_ids, strict=False)
    ]
    result = task.db.execute(insert(NodeModel).values(node_rows).returning(NodeModel.id, NodeModel.name)).tuples()
    return pd.DataFrame(result, columns=["id", "name"]).astype(object)


@celery_app.task(base=DatabaseTask, bind=True, queue="terramaps", name="src.workers.tasks.maps.import_map_task")
def import_map_task(self: DatabaseTask, map_id: str) -> None:  # type: ignore[misc]
    """Import map data from the uploaded spreadsheet stored in S3."""
    map_model = self.db.get(MapModel, map_id)
    if not map_model:
        logger.error("import_map_task: map %s not found", map_id)
        return

    upload = self.db.get(MapUploadModel, map_model.source_upload_id)
    if not upload:
        raise RuntimeError(f"import_map_task: upload record missing for map {map_id}")

    try:
        layer_configs: list[dict[str, Any]] = upload.layer_config or []
        data_field_cfgs: list[dict[str, Any]] = upload.data_config or []
        warnings: list[str] = []

        _set_import_step(self, upload, "Downloading file")
        df = _download_and_parse(upload.s3_key, upload.tab_index)

        _set_import_step(self, upload, "Parsing spreadsheet")
        layer_configs, data_field_cfgs, col_warnings = _validate_columns(df, layer_configs, data_field_cfgs)
        warnings.extend(col_warnings)

        _set_import_step(self, upload, "Normalizing data")
        for col in [lc["header"] for lc in layer_configs]:
            df[col] = df[col].apply(_normalize_cell)

        _set_import_step(self, upload, "Inserting nodes")
        layer_rows = (
            self.db.execute(select(LayerModel).where(LayerModel.map_id == map_id).order_by(LayerModel.order.asc()))
            .scalars()
            .all()
        )
        order_to_header = {i: lc["header"] for i, lc in enumerate(layer_configs)}
        layer_and_headers = sorted(
            [(lr.id, lr.order, order_to_header[lr.order]) for lr in layer_rows if lr.order in order_to_header],
            key=lambda x: x[1],
        )
        number_fields = [dc for dc in data_field_cfgs if dc.get("type") == "number" and dc.get("aggregations")]

        previous_header: str | None = None
        previous_nodes: pd.DataFrame | None = None

        for layer_id, order, header in reversed(layer_and_headers):
            df_idx = [header] if not previous_header else [header, previous_header]
            rows_df = df[df_idx].drop_duplicates().copy()
            rows_df = rows_df[rows_df[header].notna() & (rows_df[header] != "")]

            if previous_nodes is not None and previous_header is not None:
                rows_df = _build_parent_lookup(rows_df, previous_header, previous_nodes, header, warnings)
            else:
                rows_df["parent_node_id"] = None

            if order == 0:
                _insert_zip_layer(self, layer_id, header, rows_df, number_fields, warnings, source_df=df)
            else:
                previous_nodes = _insert_node_layer(self, layer_id, header, rows_df)

            previous_header = header

        self.db.flush()

        _set_import_step(self, upload, "Computing geometry")
        computation = ComputationService(db=self.db)
        layers = computation.recompute_all_layers(map_id)
        if layers:
            computation.invalidate_cache_for_layers({layer.id for layer in layers})
            map_model.tile_version += 1
            self.db.flush()

        _set_import_step(self, upload, "Computing data")
        computation.compute_data_for_map(map_id)

        upload.status = "complete"
        upload.import_step = None
        upload.warnings = list(dict.fromkeys(warnings))[:100]
        self.db.commit()
        logger.info("import_map_task [%s]: complete", map_id)

    except Exception as exc:
        logger.exception("import_map_task [%s]: failed", map_id)
        # If the DB aborted the transaction (e.g. unique constraint violation), the
        # session is deactivated and must be rolled back before we can write anything.
        self.db.rollback()
        upload.status = "failed"
        upload.import_step = None
        upload.error = type(exc).__name__
        upload.error_reason = str(exc)
        self.db.commit()
        raise


@celery_app.task(base=DatabaseTask, bind=True, queue="terramaps")
def warm_map_mvt_cache_task(self: DatabaseTask, map_id: str) -> None:  # type: ignore[misc]
    """Pre-warm the MVT tile cache for all layers in a map at z3–z7.

    Assumes the cache has already been cleared for this map. Renders every
    tile in the continental US bbox per layer and batches inserts in groups
    of 50 to keep transactions small.
    """
    map_model = self.db.get(MapModel, map_id)
    if not map_model:
        logger.error("warm_map_mvt_cache_task: map %s not found", map_id)
        return

    layers = (
        self.db.execute(select(LayerModel).where(LayerModel.map_id == map_id).order_by(LayerModel.order.asc()))
        .scalars()
        .all()
    )

    tiles = mvt_service.tiles_for_us(z_min=3, z_max=7)
    logger.info(
        "warm_map_mvt_cache_task [%s]: %d layers × %d tiles = %d total",
        map_id,
        len(layers),
        len(tiles),
        len(layers) * len(tiles),
    )

    t0 = time.monotonic()
    for layer in layers:
        layer_t0 = time.monotonic()
        batch: list[dict[str, Any]] = []
        for z, x, y in tiles:
            tile_bytes = mvt_service.render_tile(self.db, layer, map_model, z, x, y)
            batch.append({"layer_id": layer.id, "endpoint": "fill", "z": z, "x": x, "y": y, "tile_bytes": tile_bytes})
            if len(batch) >= 50:
                mvt_cache.save_tiles_batch(self.db, batch)
                self.db.commit()
                batch.clear()
        if batch:
            mvt_cache.save_tiles_batch(self.db, batch)
            self.db.commit()
        elapsed = time.monotonic() - layer_t0
        logger.info(
            "warm_map_mvt_cache_task [%s]: layer %d (order=%d) — %d tiles in %.1fs (%.0f ms/tile)",
            map_id,
            layer.id,
            layer.order,
            len(tiles),
            elapsed,
            elapsed / len(tiles) * 1000,
        )

    logger.info("warm_map_mvt_cache_task [%s]: complete in %.1fs", map_id, time.monotonic() - t0)
