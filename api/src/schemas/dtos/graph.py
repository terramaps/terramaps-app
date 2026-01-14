"""Graph dtos."""

from pydantic import BaseModel


class CreateLayer(BaseModel):
    """CreateLayer."""

    name: str
    map_id: int


class UpdateNode(BaseModel):
    """UpdateNode."""

    parent_node_id: int | None
    name: str
    color: str


class BulkUpdateNode(UpdateNode):
    """BulkUpdateNode."""

    id: int


class CreateNode(UpdateNode):
    """CreateNode."""

    layer_id: int
