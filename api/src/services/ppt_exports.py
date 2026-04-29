"""PPT export service."""

from collections import defaultdict
from typing import Annotated, Any

from fastapi import Depends
from sqlalchemy import select, text
from sqlalchemy.orm import undefer

from src.app.database import DatabaseSession
from src.exceptions import TerramapsException
from src.models.exports import MapExportModel, MapExportSlideModel
from src.models.graph import LayerModel, NodeModel
from src.services.base import BaseService
from src.services.s3 import S3Service


class PptExportService(BaseService):
    """Manages creation and cancellation of PPT export sessions."""

    def create_export(self, map_id: str) -> MapExportModel:
        """Traverse the node hierarchy and pre-compute all slide records.

        Inserts one slide per "group": one root slide per map (all top-layer nodes),
        then one slide per node whose children are also nodes (not zip codes).
        Slides are ordered depth-first: root → Area 1 → Region 1 of Area 1 → …

        Bbox columns are left null — they are computed lazily by compute_slide_bbox
        when GET /next is called for each slide.

        Does not commit — caller owns the transaction.
        """
        layers = (
            self.db.execute(
                select(LayerModel)
                .where(LayerModel.map_id == map_id, LayerModel.order >= 1)
                .order_by(LayerModel.order.desc())
            )
            .scalars()
            .all()
        )
        if not layers:
            raise TerramapsException(400, "Map has no layers above the zip level.")

        layer_ids = [la.id for la in layers]
        layer_by_id = {la.id: la for la in layers}
        top_layer = max(layers, key=lambda la: la.order)

        nodes = (
            self.db.execute(
                select(NodeModel)
                .options(undefer(NodeModel.data))
                .where(NodeModel.layer_id.in_(layer_ids))
                .order_by(NodeModel.name)
            )
            .scalars()
            .all()
        )

        children_by_parent: dict[int | None, list[NodeModel]] = defaultdict(list)
        for node in nodes:
            children_by_parent[node.parent_node_id].append(node)

        top_nodes = [n for n in children_by_parent[None] if n.layer_id == top_layer.id]

        slides: list[dict[str, Any]] = []
        order = 0

        def _node_data(ns: list[NodeModel]) -> list[dict[str, Any]]:
            return [{"name": n.name, **(n.data or {})} for n in ns]

        # Root slide: all top-layer nodes together
        slides.append({
            "order": order,
            "title": top_layer.name,
            "layer_id": top_layer.id,
            "parent_node_id": None,
            "node_data": _node_data(top_nodes),
        })
        order += 1

        # BFS: emit all slides at one level before descending to the next.
        # Produces: all area slides → all region slides → all territory slides.
        current_level = list(top_nodes)
        while current_level:
            next_level: list[NodeModel] = []
            for parent_node in current_level:
                children = children_by_parent.get(parent_node.id, [])
                if not children:
                    continue
                child_layer = layer_by_id[children[0].layer_id]
                slides.append({
                    "order": order,
                    "title": parent_node.name,
                    "layer_id": child_layer.id,
                    "parent_node_id": parent_node.id,
                    "node_data": _node_data(children),
                })
                order += 1
                # Only descend if child layer has node children (order > 1).
                # order=1 nodes' children are zip assignments — stop there.
                if child_layer.order > 1:
                    next_level.extend(children)
            current_level = next_level

        export = MapExportModel(map_id=map_id, status="pending", total_slides=len(slides))
        self.db.add(export)
        self.db.flush()

        for s in slides:
            self.db.add(
                MapExportSlideModel(
                    export_id=export.id,
                    order=s["order"],
                    title=s["title"],
                    layer_id=s["layer_id"],
                    parent_node_id=s["parent_node_id"],
                    node_data=s["node_data"],
                )
            )
        self.db.flush()
        return export

    def cancel_export(self, export: MapExportModel, s3: S3Service) -> None:
        """Remove all DB rows for this export.

        Does not commit — caller owns the transaction.
        """
        slides = (
            self.db.execute(select(MapExportSlideModel).where(MapExportSlideModel.export_id == export.id))
            .scalars()
            .all()
        )
        for slide in slides:
            if slide.image_s3_key:
                s3.delete_private_file(key=slide.image_s3_key)
            self.db.delete(slide)

        self.db.delete(export)
        self.db.flush()

    def compute_slide_bbox(self, slide: MapExportSlideModel) -> tuple[float, float, float, float]:
        """Compute and persist the WGS-84 bounding box for a slide via PostGIS ST_Extent.

        Uses geom_z3 (the lowest-resolution geometry, always present when computation
        has run). Returns (min_lng, min_lat, max_lng, max_lat).

        Raises TerramapsException(422) if no geometry is available for the slide's nodes.
        Does not commit — caller owns the transaction.
        """
        if slide.parent_node_id is None:
            sql = text("""
                SELECT
                    ST_XMin(ST_Extent(geom_z3)) AS min_lng,
                    ST_YMin(ST_Extent(geom_z3)) AS min_lat,
                    ST_XMax(ST_Extent(geom_z3)) AS max_lng,
                    ST_YMax(ST_Extent(geom_z3)) AS max_lat
                FROM nodes
                WHERE layer_id = :layer_id
                  AND geom_z3 IS NOT NULL
            """)
            row = self.db.execute(sql, {"layer_id": slide.layer_id}).one()
        else:
            sql = text("""
                SELECT
                    ST_XMin(ST_Extent(geom_z3)) AS min_lng,
                    ST_YMin(ST_Extent(geom_z3)) AS min_lat,
                    ST_XMax(ST_Extent(geom_z3)) AS max_lng,
                    ST_YMax(ST_Extent(geom_z3)) AS max_lat
                FROM nodes
                WHERE parent_node_id = :parent_node_id
                  AND geom_z3 IS NOT NULL
            """)
            row = self.db.execute(sql, {"parent_node_id": slide.parent_node_id}).one()

        min_lng, min_lat, max_lng, max_lat = row.min_lng, row.min_lat, row.max_lng, row.max_lat
        if any(v is None for v in (min_lng, min_lat, max_lng, max_lat)):
            raise TerramapsException(422, "No geometry computed yet for this slide's nodes.")

        # Clamp to continental US bounds so Alaska/Hawaii zip codes don't blow out the bbox.
        CONUS = (-124.85, 24.40, -66.88, 49.38)
        min_lng = max(min_lng, CONUS[0])
        min_lat = max(min_lat, CONUS[1])
        max_lng = min(max_lng, CONUS[2])
        max_lat = min(max_lat, CONUS[3])

        slide.bbox_min_lng = min_lng
        slide.bbox_min_lat = min_lat
        slide.bbox_max_lng = max_lng
        slide.bbox_max_lat = max_lat
        self.db.flush()
        return (min_lng, min_lat, max_lng, max_lat)


def get_ppt_export_service(db: DatabaseSession) -> PptExportService:
    """Get PPT export service."""
    return PptExportService(db=db)


PptExportServiceDependency = Annotated[PptExportService, Depends(get_ppt_export_service)]
