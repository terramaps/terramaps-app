"""Graph dtos."""

from typing import Literal

from pydantic import BaseModel, field_validator, model_validator


class CreateLayer(BaseModel):
    """CreateLayer."""

    name: str
    map_id: str


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


class AssignZip(BaseModel):
    """Assign or update a single zip code's territory assignment.

    PUT with parent_node_id=null unassigns the zip (nulls the FK, preserves the row and color).
    DELETE /layers/{layer_id}/zips/{zip_code} resets the zip (removes the row entirely).
    """

    parent_node_id: int | None
    color: str | None = None
    """Optional color override. If omitted on first assignment, copied from geography_zip_codes.color."""


class ReparentNodes(BaseModel):
    """Bulk reparent nodes to a new parent (or no parent).

    All node_ids must belong to the same layer.
    parent_node_id must be in the layer directly above, or null to orphan.
    """

    node_ids: list[int]
    parent_node_id: int | None


class MergeNodes(BaseModel):
    """Merge multiple nodes into a single new node.

    All node_ids must belong to the same layer (order >= 1).
    Children (child nodes or zip assignments) are reparented to the new node.
    parent_node_id must be in the layer directly above, or null.

    Exactly one of name or target_node_id must be provided:
    - name: create a brand-new node with this name as the merge destination.
    - target_node_id: use an existing node (must be in node_ids) as the
      destination; all other nodes' children are moved into it, then the
      others are deleted.
    """

    node_ids: list[int]
    name: str | None = None
    target_node_id: int | None = None
    parent_node_id: int | None

    @model_validator(mode="after")
    def validate_name_xor_target(self) -> "MergeNodes":
        """Ensure exactly one of name/target_node_id is set and target is in node_ids."""
        has_name = self.name is not None
        has_target = self.target_node_id is not None
        if has_name == has_target:
            raise ValueError("Provide exactly one of 'name' or 'target_node_id'.")
        if has_target and self.target_node_id not in self.node_ids:
            raise ValueError("'target_node_id' must be one of 'node_ids'.")
        return self


class BulkDeleteNodes(BaseModel):
    """Bulk delete nodes, with a declared strategy for their children.

    All node_ids must belong to the same layer (order >= 1).
    child_action='orphan'   → children's parent_node_id set to null.
    child_action='reparent' → children moved to reparent_node_id (same layer, not in delete set).
    """

    node_ids: list[int]
    child_action: Literal["orphan", "reparent"]
    reparent_node_id: int | None = None

    @model_validator(mode="after")
    def reparent_node_required(self) -> "BulkDeleteNodes":
        """Ensure reparent_node_id is provided when child_action is 'reparent'."""
        if self.child_action == "reparent" and self.reparent_node_id is None:
            raise ValueError("reparent_node_id is required when child_action is 'reparent'")
        return self


class NodeQuery(BaseModel):
    """Body for POST /nodes/query.

    At least one of layer_id, parent_node_id, or ids must be provided.
    All conditions are combined with AND.
    """

    layer_id: int | None = None
    parent_node_id: int | None = None
    ids: list[int] | None = None
    search: str | None = None


class ZipQuery(BaseModel):
    """Body for POST /zip-assignments/query.

    layer_id is always required. zip_codes narrows to a specific set (e.g. lasso selection).
    search filters by zip code prefix/substring.
    """

    layer_id: int
    zip_codes: list[str] | None = None
    search: str | None = None

    @field_validator("zip_codes")
    @classmethod
    def pad_zip_codes(cls, v: list[str] | None) -> list[str] | None:
        """Ensure zip codes are always zero-padded to 5 characters."""
        return [z.zfill(5) for z in v] if v else v


class BulkAssignZips(BaseModel):
    """Bulk assign or unassign a list of zip codes to a territory.

    Primary operation after lasso selection: select zips on map, assign to territory.
    parent_node_id=null unassigns all provided zip codes (preserves rows and colors).
    """

    zip_codes: list[str]
    parent_node_id: int | None
    color: str | None = None
    """Optional color override applied to all zip codes in the batch."""

    @field_validator("zip_codes")
    @classmethod
    def pad_zip_codes(cls, v: list[str]) -> list[str]:
        """Ensure zip codes are always zero-padded to 5 characters."""
        return [z.zfill(5) for z in v]
