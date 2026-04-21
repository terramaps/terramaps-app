/**
 * NodeDetailSheet — right-side panel that shows and edits a node or zip code
 * selected from the search bar.
 *
 * For nodes (order >= 1): shows name / color / parent (all editable) plus
 * child count. For zip codes (order = 0): shows the zip code and its current
 * territory assignment (read-only for now).
 */

import {
  IconCheck,
  IconLoader2,
  IconPencil,
  IconX,
} from "@tabler/icons-react"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NodePicker } from "@/features/home/components/node-picker"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"
import { useUpdateNodeMutation } from "@/queries/mutations"
import { queries } from "@/queries/queries"
import type { components } from "@/lib/api/v1"

type SearchResultItem = components["schemas"]["SearchResultItem"]
type Layer = components["schemas"]["Layer"]

interface NodeDetailSheetProps {
  result: SearchResultItem | null
  layers: Layer[]
  onClose: () => void
}

export function NodeDetailSheet({
  result,
  layers,
  onClose,
}: NodeDetailSheetProps) {
  return (
    <Sheet open={result !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex flex-col gap-0 p-0" side="right">
        {result?.type === "node" && (
          <NodeDetail result={result} layers={layers} />
        )}
        {result?.type === "zip" && (
          <ZipDetail result={result} layers={layers} />
        )}
      </SheetContent>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Node detail (order >= 1)
// ---------------------------------------------------------------------------

function NodeDetail({
  result,
  layers,
}: {
  result: SearchResultItem
  layers: Layer[]
}) {
  const nodeId = result.id as number
  const nodeQuery = useQuery(queries.getNode(nodeId))
  const node = nodeQuery.data

  const updateMutation = useUpdateNodeMutation()

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState("")
  const [color, setColor] = useState("")
  const [parentNodeId, setParentNodeId] = useState<number | null>(null)

  // Sync form state whenever the fetched node changes
  useEffect(() => {
    if (node) {
      setName(node.name)
      setColor(node.color)
      setParentNodeId(node.parent_node_id ?? null)
    }
  }, [node])

  // Reset editing state when result changes
  useEffect(() => {
    setEditing(false)
  }, [nodeId])

  const layer = layers.find((l) => l.id === result.layer_id)
  // The layer one order above — used as the parent picker target
  const parentLayer = layers.find(
    (l) => layer && l.order === layer.order + 1,
  )

  const handleSave = () => {
    if (!node) return
    updateMutation.mutate(
      { nodeId, mapId: layer?.map_id ?? "", name, color, parentNodeId },
      { onSuccess: () => setEditing(false) },
    )
  }

  const handleCancel = () => {
    if (node) {
      setName(node.name)
      setColor(node.color)
      setParentNodeId(node.parent_node_id ?? null)
    }
    setEditing(false)
  }

  return (
    <>
      <SheetHeader className="border-border border-b p-4">
        <div className="flex items-start gap-3 pr-8">
          {/* Color swatch / picker */}
          <label className="relative mt-0.5 shrink-0 cursor-pointer">
            <span
              className="border-border block h-6 w-6 rounded-full border-2"
              style={{ backgroundColor: editing ? color : (node?.color ?? result.color) }}
            />
            {editing && (
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            )}
          </label>

          <div className="min-w-0 flex-1">
            {editing ? (
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-7 text-base font-medium"
                autoFocus
              />
            ) : (
              <SheetTitle className="text-base leading-tight">
                {node?.name ?? result.name}
              </SheetTitle>
            )}
            <Badge variant="secondary" className="mt-1 text-xs">
              {result.layer_name}
            </Badge>
          </div>

          {!editing && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setEditing(true)}
              className="shrink-0"
            >
              <IconPencil className="h-4 w-4" />
            </Button>
          )}
        </div>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto p-4">
        {nodeQuery.isPending && (
          <div className="flex justify-center py-8">
            <IconLoader2 className="text-muted-foreground h-5 w-5 animate-spin" />
          </div>
        )}

        {node && (
          <div className="space-y-4">
            {/* Children */}
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-sm">Children</span>
              <span className="text-sm font-medium">{node.child_count}</span>
            </div>

            <Separator />

            {/* Parent */}
            <div className="space-y-1.5">
              <Label className="text-muted-foreground text-xs uppercase tracking-wide">
                Parent ({parentLayer?.name ?? "—"})
              </Label>
              {editing && parentLayer ? (
                <NodePicker
                  layerId={parentLayer.id}
                  excludeNodeIds={[nodeId]}
                  value={parentNodeId}
                  onChange={setParentNodeId}
                  noParentLabel="No parent"
                />
              ) : (
                <p className="text-sm">
                  {node.parent_node_id
                    ? `Node #${node.parent_node_id}`
                    : "No parent"}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {editing && (
        <div className="border-border border-t p-4">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={handleCancel}
              disabled={updateMutation.isPending}
            >
              <IconX className="h-4 w-4" />
              Cancel
            </Button>
            <Button
              size="sm"
              className="flex-1"
              onClick={handleSave}
              disabled={updateMutation.isPending || !name.trim()}
            >
              {updateMutation.isPending ? (
                <IconLoader2 className="h-4 w-4 animate-spin" />
              ) : (
                <IconCheck className="h-4 w-4" />
              )}
              Save
            </Button>
          </div>
          {updateMutation.isError && (
            <p className="text-destructive mt-2 text-xs">
              {updateMutation.error.message}
            </p>
          )}
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Zip detail (order = 0)
// ---------------------------------------------------------------------------

function ZipDetail({
  result,
  layers: _layers,
}: {
  result: SearchResultItem
  layers: Layer[]
}) {
  return (
    <>
      <SheetHeader className="border-border border-b p-4">
        <div className="flex items-center gap-3 pr-8">
          <span
            className="border-border block h-6 w-6 shrink-0 rounded-full border-2"
            style={{ backgroundColor: result.color }}
          />
          <div>
            <SheetTitle className="text-base">{result.name}</SheetTitle>
            <Badge variant="secondary" className="mt-1 text-xs">
              {result.layer_name}
            </Badge>
          </div>
        </div>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto p-4">
        <p className="text-muted-foreground text-sm">
          Zip code detail coming soon. Use the lasso or click tool to assign
          this zip code to a territory.
        </p>
      </div>
    </>
  )
}
