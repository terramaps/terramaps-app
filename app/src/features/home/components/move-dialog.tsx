/**
 * MoveDialog — reparent selected nodes or reassign selected zip codes.
 *
 * For zip layers (order=0): shows order=1 territory nodes as parent options.
 * For node layers (order≥1): shows nodes from the layer directly above.
 *
 * If the user types a name that doesn't exist yet and clicks "Create '…'",
 * the dialog will create that node in the parent layer on submit, then move
 * all selected items to it.
 */
import { IconX } from "@tabler/icons-react"
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
  useCreateNodeMutation,
  useMoveNodesMutation,
} from "@/queries/mutations"

import { NodePicker } from "./node-picker"

const DEFAULT_NODE_COLOR = "#94a3b8"

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
  const [pendingCreate, setPendingCreate] = useState<string | null>(null)

  const moveNodesMutation = useMoveNodesMutation()
  const bulkAssignZipsMutation = useBulkAssignZipsMutation()
  const createNodeMutation = useCreateNodeMutation()

  const isZipLayer = activeLayer.order === 0
  const count = isZipLayer ? selectedZipCodes.length : selectedNodeIds.length
  const itemLabel = pluralize(activeLayer.name, count)

  const isPending =
    moveNodesMutation.isPending ||
    bulkAssignZipsMutation.isPending ||
    createNodeMutation.isPending

  const handlePickerChange = (id: number | null) => {
    setTargetParentId(id)
    setPendingCreate(null)
  }

  const handleCreateRequest = (name: string) => {
    setPendingCreate(name)
    setTargetParentId(null)
  }

  const handleConfirm = async () => {
    let resolvedParentId = targetParentId

    if (pendingCreate && parentLayer) {
      const newNode = await createNodeMutation.mutateAsync({
        layerId: parentLayer.id,
        name: pendingCreate,
        color: DEFAULT_NODE_COLOR,
        parentNodeId: null,
      })
      resolvedParentId = newNode.id
    }

    if (isZipLayer) {
      bulkAssignZipsMutation.mutate(
        {
          layerId: activeLayer.id,
          zipCodes: selectedZipCodes,
          parentNodeId: resolvedParentId,
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
        { nodeIds: selectedNodeIds, parentNodeId: resolvedParentId },
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
      setPendingCreate(null)
      onOpenChange(next)
    }
  }

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
            choose "No parent" to unassign. Search and use "Create" to add a
            new {parentLayer?.name.toLowerCase() ?? "node"} on the fly.
          </DialogDescription>
        </DialogHeader>

        {pickerLayerId != null ? (
          <div className="space-y-2">
            <NodePicker
              layerId={pickerLayerId}
              value={targetParentId}
              onChange={handlePickerChange}
              noParentLabel="No parent (unassign)"
              onCreateRequest={handleCreateRequest}
              pendingCreate={pendingCreate}
            />
            {pendingCreate && (
              <div className="bg-muted flex items-center justify-between rounded-md px-3 py-2 text-sm">
                <span>
                  Will create{" "}
                  <span className="font-medium">&ldquo;{pendingCreate}&rdquo;</span>{" "}
                  as a new {parentLayer?.name.toLowerCase()}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setPendingCreate(null)
                  }}
                  className="text-muted-foreground hover:text-foreground ml-2 shrink-0"
                >
                  <IconX className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
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
          <Button onClick={() => void handleConfirm()} disabled={isPending}>
            {isPending ? "Moving…" : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
