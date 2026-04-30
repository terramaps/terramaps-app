/**
 * MergeDialog — combine multiple selected nodes into one new node.
 *
 * Only valid for order≥1 layers. Prompts for a new name (or one of the
 * existing names) and a parent node. If all selected nodes share the same
 * parent, that parent is pre-selected. If they have mixed parents, the
 * distinct set of current parents is shown as a hint group at the top.
 *
 * Fetches node details (name, parent_node_id) internally when opened so the
 * caller only needs to pass selectedNodeIds.
 */
import { useQuery } from "@tanstack/react-query"
import pluralize from "pluralize"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useMergeNodesMutation } from "@/queries/mutations"
import { queries } from "@/queries/queries"

import { NodePicker } from "./node-picker"

interface MergeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The active layer (order≥1). */
  activeLayer: { id: number; order: number; name: string }
  /** The layer directly above the active layer (null if top-level). */
  parentLayer: { id: number; name: string } | null
  /** IDs of nodes to merge. */
  selectedNodeIds: number[]
  onSuccess: () => void
}

export function MergeDialog({
  open,
  onOpenChange,
  activeLayer,
  parentLayer,
  selectedNodeIds,
  onSuccess,
}: MergeDialogProps) {
  const [name, setName] = useState("")
  const [targetNodeId, setTargetNodeId] = useState<number | null>(null)
  const [targetParentId, setTargetParentId] = useState<number | null>(null)
  const [initialised, setInitialised] = useState(false)

  const mergeNodesMutation = useMergeNodesMutation()
  const isPending = mergeNodesMutation.isPending

  // Fetch node details for the selected nodes so we can show names + derive
  // the common parent. Page size 1000 covers all practical layer sizes.
  const selectedIdsSet = new Set(selectedNodeIds)
  const activeLayerNodesQuery = useQuery({
    ...queries.queryNodes({ layer_id: activeLayer.id }, 1, 1000),
    enabled: open,
  })
  const selectedNodeData =
    activeLayerNodesQuery.data?.nodes.filter((n) => selectedIdsSet.has(n.id)) ??
    []

  // Once we have the node data, pre-select the common parent (if all nodes
  // share the same parent).
  useEffect(() => {
    if (!open || initialised || selectedNodeData.length === 0) return
    const parentIds = [
      ...new Set(selectedNodeData.map((n) => n.parent_node_id ?? null)),
    ]
    if (parentIds.length === 1) {
      setTargetParentId(parentIds[0])
    }
    setInitialised(true)
  }, [open, initialised, selectedNodeData])

  const handleConfirm = () => {
    if (!name.trim()) return
    mergeNodesMutation.mutate(
      targetNodeId !== null
        ? { nodeIds: selectedNodeIds, targetNodeId, parentNodeId: targetParentId }
        : { nodeIds: selectedNodeIds, name: name.trim(), parentNodeId: targetParentId },
      {
        onSuccess: () => {
          onOpenChange(false)
          onSuccess()
        },
      },
    )
  }

  const handleOpenChange = (next: boolean) => {
    if (!isPending) {
      setName("")
      setTargetNodeId(null)
      setTargetParentId(null)
      setInitialised(false)
      onOpenChange(next)
    }
  }

  // Hint node IDs: the distinct set of non-null parent node IDs in the selection
  const hintNodeIds = [
    ...new Set(
      selectedNodeData
        .map((n) => n.parent_node_id)
        .filter((id): id is number => id !== null),
    ),
  ]
  const hasCommonParent =
    new Set(selectedNodeData.map((n) => n.parent_node_id ?? null)).size === 1

  const count = selectedNodeIds.length

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Merge {count} {pluralize(activeLayer.name, count)}
          </DialogTitle>
          <DialogDescription>
            The selected {pluralize(activeLayer.name, count)} will be combined
            into a single new {activeLayer.name.toLowerCase()}. All their
            children will be reparented to the new{" "}
            {activeLayer.name.toLowerCase()}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label>New name</Label>
            <Input
              placeholder={`${activeLayer.name} name…`}
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setTargetNodeId(null)
              }}
            />
            {selectedNodeData.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs">
                  Or keep existing:
                </span>
                <Select
                  value={targetNodeId !== null ? String(targetNodeId) : ""}
                  onValueChange={(val) => {
                    const node = selectedNodeData.find(
                      (n) => n.id === Number(val),
                    )
                    if (!node) return
                    setName(node.name)
                    setTargetNodeId(node.id)
                  }}
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue placeholder="Pick a name…" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedNodeData.map((n) => (
                      <SelectItem key={n.id} value={String(n.id)}>
                        {n.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Parent picker */}
          {parentLayer && (
            <div className="space-y-1.5">
              <Label>
                Parent {parentLayer.name}
                {hasCommonParent && targetParentId !== null && (
                  <span className="text-muted-foreground ml-1 text-xs font-normal">
                    (pre-selected from selection)
                  </span>
                )}
              </Label>
              <NodePicker
                layerId={parentLayer.id}
                value={targetParentId}
                onChange={setTargetParentId}
                noParentLabel={`No parent ${parentLayer.name}`}
                hintNodeIds={hintNodeIds}
                hintLabel={
                  hintNodeIds.length > 0 && !hasCommonParent
                    ? "Current parents of selection"
                    : undefined
                }
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              handleOpenChange(false)
            }}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isPending || !name.trim()}>
            {isPending ? "Merging…" : "Merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
