"""Graph schemas."""

from collections.abc import Sequence
from typing import Literal

from pydantic import BaseModel


class Map(BaseModel):
    """Map."""

    id: int
    name: str


class Layer(BaseModel):
    """Layer."""

    id: int
    map_id: int
    name: str
    order: int


class Node(BaseModel):
    """Node."""

    id: int | Literal["default"]
    layer_id: int
    name: str
    color: str
    parent_node_id: int | None = None
    child_count: int = 0


class PaginatedNodes(BaseModel):
    """Paginated nodes response."""

    nodes: Sequence[Node]
    total: int
    page: int
    page_size: int
    total_pages: int
