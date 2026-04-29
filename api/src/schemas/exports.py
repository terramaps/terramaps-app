"""PPT export schemas."""

from pydantic import BaseModel


class CreateExportResponse(BaseModel):
    """Returned immediately after a new export session is created."""

    id: str
    total_slides: int


class NextSlideResponse(BaseModel):
    """Returned by GET /next.

    When done=True all slide fields are None — the capture loop should stop.
    When done=False all slide fields are populated and the frontend should
    capture + upload the described screenshot.
    """

    done: bool
    slide_id: int | None = None
    order: int | None = None
    title: str | None = None
    layer_id: int | None = None
    parent_node_id: int | None = None
    bbox_min_lng: float | None = None
    bbox_min_lat: float | None = None
    bbox_max_lng: float | None = None
    bbox_max_lat: float | None = None
    total_slides: int
    uploaded_slides: int
