/**
 * MoveDialog — reparent selected nodes or reassign selected zip codes.
 *
 * For zip layers (order=0): shows order=1 territory nodes as parent options.
 * For node layers (order≥1): shows nodes from the layer directly above.
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
import {
  useBulkAssignZipsMutation,
  useMoveNodesMutation,
} from "@/queries/mutations"

import { NodePicker } from "./node-picker"

interface MoveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The active layer. */
  activeLayer: { id: number; order: number; name: string }
  /** The layer directly above the active layer (null if top-level). */
  parentLayer: { id: number; name: string } | null
  /** Selected node ids (for order≥1 layers). */
  selectedNodeIds: number[]
  /** Selected zip codes (for order=0 layer). */
  selectedZipCodes: string[]
  onSuccess: () => void
}

export function MoveDialog({
  open,
  onOpenChange,
  activeLayer,
  parentLayer,
  selectedNodeIds,
  selectedZipCodes,
  onSuccess,
}: MoveDialogProps) {
  const [targetParentId, setTargetParentId] = useState<number | null>(null)

  const moveNodesMutation = useMoveNodesMutation()
  const bulkAssignZipsMutation = useBulkAssignZipsMutation()

  const isZipLayer = activeLayer.order === 0
  const count = isZipLayer ? selectedZipCodes.length : selectedNodeIds.length
  const itemLabel = pluralize(activeLayer.name, count)

  const isPending =
    moveNodesMutation.isPending || bulkAssignZipsMutation.isPending

  const handleConfirm = () => {
    if (isZipLayer) {
      bulkAssignZipsMutation.mutate(
        {
          layerId: activeLayer.id,
          zipCodes: selectedZipCodes,
          parentNodeId: targetParentId,
        },
        {
          onSuccess: () => {
            onOpenChange(false)
            onSuccess()
          },
        },
      )
    } else {
      moveNodesMutation.mutate(
        { nodeIds: selectedNodeIds, parentNodeId: targetParentId },
        {
          onSuccess: () => {
            onOpenChange(false)
            onSuccess()
          },
        },
      )
    }
  }

  const handleOpenChange = (next: boolean) => {
    if (!isPending) {
      setTargetParentId(null)
      onOpenChange(next)
    }
  }

  // For zip layer: parentLayer is the order=1 layer.
  // For node layer: parentLayer is the layer one order above.
  const pickerLayerId = parentLayer?.id

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Move {count} {itemLabel}
          </DialogTitle>
          <DialogDescription>
            Select a new parent{parentLayer ? ` ${parentLayer.name}` : ""}, or
            choose "No parent" to unassign.
          </DialogDescription>
        </DialogHeader>

        {pickerLayerId != null ? (
          <NodePicker
            layerId={pickerLayerId}
            value={targetParentId}
            onChange={setTargetParentId}
            noParentLabel="No parent (unassign)"
          />
        ) : (
          <p className="text-muted-foreground text-sm">
            There is no layer above this one. Moving here will orphan the
            selected items.
          </p>
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
          <Button onClick={handleConfirm} disabled={isPending}>
            {isPending ? "Moving…" : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
