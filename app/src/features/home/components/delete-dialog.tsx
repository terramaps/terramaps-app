/**
 * DeleteDialog — delete selected nodes or unassign selected zip codes.
 *
 * For zip layers (order=0): labelled "Unassign", calls bulk_assign_zips with
 * parent_node_id=null. No child handling needed.
 *
 * For node layers (order≥1): shows orphan / reparent choice. The reparent
 * picker shows nodes from the same layer (excluding the nodes being deleted).
 * We always show both options since we can't cheaply know child count for
 * zip assignments (order=1 nodes).
 */
import pluralize from "pluralize"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  useBulkAssignZipsMutation,
  useBulkDeleteNodesMutation,
} from "@/queries/mutations"

import { NodePicker } from "./node-picker"

interface DeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The active layer. */
  activeLayer: { id: number; order: number; name: string }
  /** Selected node ids (for order≥1 layers). */
  selectedNodeIds: number[]
  /** Selected zip codes (for order=0 layer). */
  selectedZipCodes: string[]
  onSuccess: () => void
}

type ChildAction = "orphan" | "reparent"

export function DeleteDialog({
  open,
  onOpenChange,
  activeLayer,
  selectedNodeIds,
  selectedZipCodes,
  onSuccess,
}: DeleteDialogProps) {
  const [childAction, setChildAction] = useState<ChildAction>("orphan")
  const [reparentNodeId, setReparentNodeId] = useState<number | null>(null)

  const bulkDeleteMutation = useBulkDeleteNodesMutation()
  const bulkAssignZipsMutation = useBulkAssignZipsMutation()

  const isZipLayer = activeLayer.order === 0
  const count = isZipLayer ? selectedZipCodes.length : selectedNodeIds.length
  const itemLabel = pluralize(activeLayer.name, count)
  const isPending =
    bulkDeleteMutation.isPending || bulkAssignZipsMutation.isPending

  const handleConfirm = () => {
    if (isZipLayer) {
      bulkAssignZipsMutation.mutate(
        {
          layerId: activeLayer.id,
          zipCodes: selectedZipCodes,
          parentNodeId: null,
        },
        {
          onSuccess: () => {
            onOpenChange(false)
            onSuccess()
          },
        },
      )
      return
    }

    if (childAction === "reparent" && reparentNodeId == null) return

    bulkDeleteMutation.mutate(
      childAction === "reparent"
        ? {
            nodeIds: selectedNodeIds,
            childAction: "reparent",
            reparentNodeId: reparentNodeId!,
          }
        : { nodeIds: selectedNodeIds, childAction: "orphan" },
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
      setChildAction("orphan")
      setReparentNodeId(null)
      onOpenChange(next)
    }
  }

  const canConfirm =
    isZipLayer ||
    childAction === "orphan" ||
    (childAction === "reparent" && reparentNodeId != null)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isZipLayer ? "Unassign" : "Delete"} {count} {itemLabel}
          </DialogTitle>
          <DialogDescription>
            {isZipLayer
              ? `The selected ${itemLabel} will be removed from their territories. This can be undone by reassigning them later.`
              : `This will permanently delete the selected ${itemLabel}. Choose what to do with their children.`}
          </DialogDescription>
        </DialogHeader>

        {!isZipLayer && (
          <div className="space-y-4">
            <RadioGroup
              value={childAction}
              onValueChange={(v) => {
                setChildAction(v as ChildAction)
                setReparentNodeId(null)
              }}
              className="space-y-2"
            >
              <div className="flex items-start gap-3">
                <RadioGroupItem value="orphan" id="orphan" className="mt-0.5" />
                <Label htmlFor="orphan" className="cursor-pointer space-y-0.5">
                  <div className="font-medium">Orphan children</div>
                  <div className="text-muted-foreground text-xs font-normal">
                    Children lose their parent assignment but are kept.
                  </div>
                </Label>
              </div>

              <div className="flex items-start gap-3">
                <RadioGroupItem
                  value="reparent"
                  id="reparent"
                  className="mt-0.5"
                />
                <Label
                  htmlFor="reparent"
                  className="flex-1 cursor-pointer space-y-0.5"
                >
                  <div className="font-medium">Move children to…</div>
                  <div className="text-muted-foreground text-xs font-normal">
                    Children are reassigned to another{" "}
                    {activeLayer.name.toLowerCase()}.
                  </div>
                </Label>
              </div>
            </RadioGroup>

            {childAction === "reparent" && (
              <NodePicker
                layerId={activeLayer.id}
                excludeNodeIds={selectedNodeIds}
                value={reparentNodeId}
                onChange={setReparentNodeId}
                showNoParent={false}
              />
            )}
          </div>
        )}

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
          <Button
            variant={isZipLayer ? "default" : "destructive"}
            onClick={handleConfirm}
            disabled={isPending || !canConfirm}
          >
            {isPending
              ? isZipLayer
                ? "Unassigning…"
                : "Deleting…"
              : isZipLayer
                ? "Unassign"
                : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
