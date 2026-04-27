import {
  IconArrowLeft,
  IconCheck,
  IconChevronRight,
  IconLoader2,
  IconPencil,
  IconSearch,
  IconX,
} from "@tabler/icons-react"
import { useQuery } from "@tanstack/react-query"
import pluralize from "pluralize"
import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { NodePicker } from "@/features/home/components/node-picker"
import type { components } from "@/lib/api/v1"
import { useUpdateNodeMutation } from "@/queries/mutations"
import { queries } from "@/queries/queries"

type Layer = components["schemas"]["Layer"]
type DataFieldConfig = components["schemas"]["DataFieldConfig"]

const LIST_PAGE_SIZE = 25

interface SelectionSheetProps {
  selectedNodeIds: number[]
  selectedZipCodes: string[]
  activeLayer: Layer | undefined
  layers: Layer[]
  dataFieldConfig: DataFieldConfig[]
  onClose: () => void
}

export function SelectionSheet({
  selectedNodeIds,
  selectedZipCodes,
  activeLayer,
  layers,
  dataFieldConfig,
}: SelectionSheetProps) {
  const isZipLayer = activeLayer?.order === 0
  const count = isZipLayer ? selectedZipCodes.length : selectedNodeIds.length
  const [focusedNodeId, setFocusedNodeId] = useState<number | null>(null)
  const [focusedZipCode, setFocusedZipCode] = useState<string | null>(null)

  useEffect(() => {
    setFocusedNodeId(null)
    setFocusedZipCode(null)
  }, [selectedNodeIds, selectedZipCodes])

  return (
    <Sheet open={count > 0} onOpenChange={() => {}} modal={false}>
      <SheetContent
        className="flex flex-col gap-0 p-0"
        side="right"
        hideOverlay
        showCloseButton={false}
        onInteractOutside={(e) => {
          e.preventDefault()
        }}
        onPointerDownOutside={(e) => {
          e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          e.preventDefault()
        }}
      >
        {count > 0 && (
          <SheetBody
            selectedNodeIds={selectedNodeIds}
            selectedZipCodes={selectedZipCodes}
            activeLayer={activeLayer}
            layers={layers}
            dataFieldConfig={dataFieldConfig}
            isZipLayer={isZipLayer}
            count={count}
            focusedNodeId={focusedNodeId}
            setFocusedNodeId={setFocusedNodeId}
            focusedZipCode={focusedZipCode}
            setFocusedZipCode={setFocusedZipCode}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function SheetBody({
  selectedNodeIds,
  selectedZipCodes,
  activeLayer,
  layers,
  dataFieldConfig,
  isZipLayer,
  count,
  focusedNodeId,
  setFocusedNodeId,
  focusedZipCode,
  setFocusedZipCode,
}: {
  selectedNodeIds: number[]
  selectedZipCodes: string[]
  activeLayer: Layer | undefined
  layers: Layer[]
  dataFieldConfig: DataFieldConfig[]
  isZipLayer: boolean
  count: number
  focusedNodeId: number | null
  setFocusedNodeId: (id: number | null) => void
  focusedZipCode: string | null
  setFocusedZipCode: (zip: string | null) => void
}) {
  if (focusedNodeId !== null) {
    return (
      <NodeDetailView
        nodeId={focusedNodeId}
        activeLayer={activeLayer}
        layers={layers}
        dataFieldConfig={dataFieldConfig}
        onBack={() => {
          setFocusedNodeId(null)
        }}
      />
    )
  }

  if (focusedZipCode !== null) {
    return (
      <ZipDetailView
        zipCode={focusedZipCode}
        activeLayer={activeLayer}
        layers={layers}
        dataFieldConfig={dataFieldConfig}
        onBack={() => {
          setFocusedZipCode(null)
        }}
      />
    )
  }

  if (count === 1 && !isZipLayer) {
    return (
      <NodeDetailView
        nodeId={selectedNodeIds[0]}
        activeLayer={activeLayer}
        layers={layers}
        dataFieldConfig={dataFieldConfig}
      />
    )
  }

  if (count === 1 && isZipLayer) {
    return (
      <ZipDetailView
        zipCode={selectedZipCodes[0]}
        activeLayer={activeLayer}
        layers={layers}
        dataFieldConfig={dataFieldConfig}
      />
    )
  }

  if (!isZipLayer) {
    return (
      <NodeListView
        selectedNodeIds={selectedNodeIds}
        activeLayer={activeLayer}
        count={count}
        onFocusNode={setFocusedNodeId}
      />
    )
  }

  return (
    <ZipListView
      selectedZipCodes={selectedZipCodes}
      activeLayer={activeLayer}
      count={count}
      onFocusZip={setFocusedZipCode}
    />
  )
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground mb-2 text-[10px] font-semibold uppercase tracking-widest">
      {children}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Single node detail
// ---------------------------------------------------------------------------

function NodeDetailView({
  nodeId,
  activeLayer,
  layers,
  dataFieldConfig,
  onBack,
}: {
  nodeId: number
  activeLayer: Layer | undefined
  layers: Layer[]
  dataFieldConfig: DataFieldConfig[]
  onBack?: () => void
}) {
  const nodeQuery = useQuery(queries.getNode(nodeId))
  const node = nodeQuery.data
  const updateMutation = useUpdateNodeMutation()

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState("")
  const [color, setColor] = useState("")
  const [parentNodeId, setParentNodeId] = useState<number | null>(null)

  useEffect(() => {
    if (node) {
      setName(node.name)
      setColor(node.color)
      setParentNodeId(node.parent_node_id ?? null)
    }
  }, [node])

  useEffect(() => {
    setEditing(false)
  }, [nodeId])

  const parentLayer = layers.find(
    (l) => activeLayer && l.order === activeLayer.order + 1,
  )

  const handleSave = () => {
    if (!node) return
    updateMutation.mutate(
      { nodeId, mapId: activeLayer?.map_id ?? "", name, color, parentNodeId },
      {
        onSuccess: () => {
          setEditing(false)
        },
      },
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

  const ancestorsTopDown = node?.ancestors ? [...node.ancestors].reverse() : []

  return (
    <>
      <SheetHeader className="border-border border-b p-4">
        {onBack && (
          <button
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground mb-2 flex items-center gap-1 text-xs transition-colors"
          >
            <IconArrowLeft className="h-3 w-3" />
            Back to selection
          </button>
        )}
        <div className="flex items-start gap-3 pr-8">
          <label className="relative mt-0.5 shrink-0 cursor-pointer">
            <span
              className="border-border block h-6 w-6 rounded-full border-2"
              style={{
                backgroundColor: editing ? color : (node?.color ?? "#888"),
              }}
            />
            {editing && (
              <input
                type="color"
                value={color}
                onChange={(e) => {
                  setColor(e.target.value)
                }}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            )}
          </label>
          <div className="min-w-0 flex-1">
            {editing ? (
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                }}
                className="h-7 text-base font-medium"
                autoFocus
              />
            ) : (
              <SheetTitle className="text-base leading-tight">
                {node?.name ?? "Loading…"}
              </SheetTitle>
            )}
            <Badge variant="secondary" className="mt-1 text-xs">
              {activeLayer?.name ?? ""}
            </Badge>
          </div>
          {!editing && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                setEditing(true)
              }}
              className="shrink-0"
            >
              <IconPencil className="h-4 w-4" />
            </Button>
          )}
        </div>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto">
        {nodeQuery.isPending && (
          <div className="flex justify-center py-8">
            <IconLoader2 className="text-muted-foreground h-5 w-5 animate-spin" />
          </div>
        )}

        {node && (
          <>
            <div className="p-4">
              <SectionLabel>Hierarchy</SectionLabel>
              <div className="space-y-px">
                {ancestorsTopDown.map((ancestor) => (
                  <div
                    key={ancestor.node_id}
                    className="flex items-center gap-3 rounded-md px-2 py-1.5"
                  >
                    <span
                      className="border-border h-2.5 w-2.5 shrink-0 rounded-full border"
                      style={{ backgroundColor: ancestor.node_color }}
                    />
                    <span className="text-muted-foreground w-20 shrink-0 truncate text-xs">
                      {ancestor.layer_name}
                    </span>
                    <span className="truncate text-sm">
                      {ancestor.node_name}
                    </span>
                  </div>
                ))}
                <div className="bg-muted flex items-center gap-3 rounded-md px-2 py-1.5">
                  <span
                    className="border-border h-2.5 w-2.5 shrink-0 rounded-full border"
                    style={{ backgroundColor: node.color }}
                  />
                  <span className="text-muted-foreground w-20 shrink-0 truncate text-xs">
                    {activeLayer?.name}
                  </span>
                  <span className="truncate text-sm font-medium">
                    {node.name}
                  </span>
                </div>
                <div className="flex items-center gap-3 px-2 py-1.5">
                  <span className="h-2.5 w-2.5 shrink-0" />
                  <span className="text-muted-foreground w-20 shrink-0 text-xs">
                    Children
                  </span>
                  <span className="text-muted-foreground text-sm">
                    {node.child_count}
                  </span>
                </div>
              </div>
            </div>

            {dataFieldConfig.length > 0 && (
              <>
                <Separator />
                <div className="p-4">
                  <SectionLabel>Data</SectionLabel>
                  {node.data ? (
                    <div className="space-y-2">
                      {dataFieldConfig.flatMap((field) =>
                        field.aggregations.map((agg) => {
                          const raw = (
                            node.data?.[field.field] as
                              | Record<string, number>
                              | undefined
                          )?.[agg]
                          const formatted: string =
                            typeof raw === "number"
                              ? new Intl.NumberFormat().format(raw)
                              : "—"
                          return (
                            <div
                              key={`${field.field}-${agg}`}
                              className="flex items-center justify-between gap-4"
                            >
                              <span className="text-muted-foreground truncate text-sm">
                                {field.label || field.field}{" "}
                                <span className="text-muted-foreground/60">
                                  ({agg})
                                </span>
                              </span>
                              <span className="text-sm font-medium tabular-nums">
                                {formatted}
                              </span>
                            </div>
                          )
                        }),
                      )}
                    </div>
                  ) : (
                    <div className="text-muted-foreground flex items-center gap-2 text-sm">
                      <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                      Computing…
                    </div>
                  )}
                </div>
              </>
            )}

            {editing && parentLayer && (
              <>
                <Separator />
                <div className="p-4">
                  <SectionLabel>Parent ({parentLayer.name})</SectionLabel>
                  <NodePicker
                    layerId={parentLayer.id}
                    excludeNodeIds={[nodeId]}
                    value={parentNodeId}
                    onChange={setParentNodeId}
                    noParentLabel="No parent"
                  />
                </div>
              </>
            )}
          </>
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
// Single zip detail
// ---------------------------------------------------------------------------

function ZipDetailView({
  zipCode,
  activeLayer,
  layers,
  dataFieldConfig,
  onBack,
}: {
  zipCode: string
  activeLayer: Layer | undefined
  layers: Layer[]
  dataFieldConfig: DataFieldConfig[]
  onBack?: () => void
}) {
  const layerId = activeLayer?.id
  const zipQuery = useQuery({
    ...queries.getZipAssignment(layerId!, zipCode),
    enabled: !!layerId,
  })
  const za = zipQuery.data

  const parentNodeQuery = useQuery({
    ...queries.getNode(za?.parent_node_id!),
    enabled: !!za?.parent_node_id,
  })
  const parentNode = parentNodeQuery.data

  const ancestorsTopDown = parentNode?.ancestors
    ? [...parentNode.ancestors].reverse()
    : []
  const parentLayerName = parentNode
    ? (layers.find((l) => l.id === parentNode.layer_id)?.name ?? "")
    : ""

  return (
    <>
      <SheetHeader className="border-border border-b p-4">
        {onBack && (
          <button
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground mb-2 flex items-center gap-1 text-xs transition-colors"
          >
            <IconArrowLeft className="h-3 w-3" />
            Back to selection
          </button>
        )}
        <div className="flex items-start gap-3 pr-8">
          <span
            className="border-border mt-0.5 block h-6 w-6 shrink-0 rounded-full border-2"
            style={{ backgroundColor: za?.color ?? "#ffffff" }}
          />
          <div className="min-w-0 flex-1">
            <SheetTitle className="text-base leading-tight">
              {zipCode}
            </SheetTitle>
            <Badge variant="secondary" className="mt-1 text-xs">
              {activeLayer?.name ?? "Zip Code"}
            </Badge>
          </div>
        </div>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto">
        {zipQuery.isPending && (
          <div className="flex justify-center py-8">
            <IconLoader2 className="text-muted-foreground h-5 w-5 animate-spin" />
          </div>
        )}

        {za && (
          <>
            <div className="p-4">
              <SectionLabel>Hierarchy</SectionLabel>
              <div className="space-y-px">
                {ancestorsTopDown.map((ancestor) => (
                  <div
                    key={ancestor.node_id}
                    className="flex items-center gap-3 rounded-md px-2 py-1.5"
                  >
                    <span
                      className="border-border h-2.5 w-2.5 shrink-0 rounded-full border"
                      style={{ backgroundColor: ancestor.node_color }}
                    />
                    <span className="text-muted-foreground w-20 shrink-0 truncate text-xs">
                      {ancestor.layer_name}
                    </span>
                    <span className="truncate text-sm">
                      {ancestor.node_name}
                    </span>
                  </div>
                ))}
                {parentNode ? (
                  <div className="flex items-center gap-3 rounded-md px-2 py-1.5">
                    <span
                      className="border-border h-2.5 w-2.5 shrink-0 rounded-full border"
                      style={{ backgroundColor: parentNode.color }}
                    />
                    <span className="text-muted-foreground w-20 shrink-0 truncate text-xs">
                      {parentLayerName}
                    </span>
                    <span className="truncate text-sm">{parentNode.name}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 px-2 py-1.5">
                    <span className="h-2.5 w-2.5 shrink-0" />
                    <span className="text-muted-foreground w-20 shrink-0 text-xs">
                      Territory
                    </span>
                    <span className="text-muted-foreground text-sm">
                      Unassigned
                    </span>
                  </div>
                )}
                <div className="bg-muted flex items-center gap-3 rounded-md px-2 py-1.5">
                  <span
                    className="border-border h-2.5 w-2.5 shrink-0 rounded-full border"
                    style={{ backgroundColor: za.color }}
                  />
                  <span className="text-muted-foreground w-20 shrink-0 truncate text-xs">
                    {activeLayer?.name ?? "Zip Code"}
                  </span>
                  <span className="truncate text-sm font-medium">
                    {zipCode}
                  </span>
                </div>
              </div>
            </div>

            {dataFieldConfig.length > 0 && (
              <>
                <Separator />
                <div className="p-4">
                  <SectionLabel>Data</SectionLabel>
                  {za.data ? (
                    <div className="space-y-2">
                      {dataFieldConfig.flatMap((field) =>
                        field.aggregations.map((agg) => {
                          const raw = (
                            za.data?.[field.field] as
                              | Record<string, number>
                              | undefined
                          )?.[agg]
                          const formatted: string =
                            typeof raw === "number"
                              ? new Intl.NumberFormat().format(raw)
                              : "—"
                          return (
                            <div
                              key={`${field.field}-${agg}`}
                              className="flex items-center justify-between gap-4"
                            >
                              <span className="text-muted-foreground truncate text-sm">
                                {field.label || field.field}{" "}
                                <span className="text-muted-foreground/60">
                                  ({agg})
                                </span>
                              </span>
                              <span className="text-sm font-medium tabular-nums">
                                {formatted}
                              </span>
                            </div>
                          )
                        }),
                      )}
                    </div>
                  ) : (
                    <div className="text-muted-foreground flex items-center gap-2 text-sm">
                      <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                      Computing…
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Multi-select node list (server-side search + pagination)
// ---------------------------------------------------------------------------

function NodeListView({
  selectedNodeIds,
  activeLayer,
  count,
  onFocusNode,
}: {
  selectedNodeIds: number[]
  activeLayer: Layer | undefined
  count: number
  onFocusNode: (id: number) => void
}) {
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)

  // Reset page when selection or search changes
  useEffect(() => {
    setPage(1)
  }, [selectedNodeIds])

  const nodesQuery = useQuery(
    queries.queryNodes(
      { ids: selectedNodeIds, search: search || undefined },
      page,
      LIST_PAGE_SIZE,
    ),
  )

  const nodes = nodesQuery.data?.nodes ?? []
  const totalPages = nodesQuery.data?.total_pages ?? 1

  const handleSearchChange = (val: string) => {
    setSearch(val)
    setPage(1)
  }

  return (
    <>
      <SheetHeader className="border-border border-b p-4">
        <SheetTitle className="text-base">
          {count} {pluralize(activeLayer?.name ?? "item", count)} selected
        </SheetTitle>
        <div className="relative mt-2">
          <IconSearch className="text-muted-foreground absolute top-2.5 left-2.5 h-4 w-4" />
          <Input
            placeholder="Filter selection…"
            value={search}
            onChange={(e) => {
              handleSearchChange(e.target.value)
            }}
            className="pl-8"
          />
        </div>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto">
        {nodesQuery.isPending && (
          <div className="flex justify-center py-8">
            <IconLoader2 className="text-muted-foreground h-5 w-5 animate-spin" />
          </div>
        )}
        {!nodesQuery.isPending && nodes.length === 0 && (
          <p className="text-muted-foreground px-4 py-8 text-center text-sm">
            No results
          </p>
        )}
        {nodes.map((node) => (
          <button
            key={node.id}
            onClick={() => {
              onFocusNode(node.id)
            }}
            className="border-border hover:bg-muted flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors"
          >
            <span
              className="border-border h-4 w-4 shrink-0 rounded-full border"
              style={{ backgroundColor: node.color }}
            />
            <span className="flex-1 truncate text-sm font-medium">
              {node.name}
            </span>
            <IconChevronRight className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
          </button>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="border-border flex items-center justify-between border-t px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={page === 1}
            onClick={() => {
              setPage((p) => p - 1)
            }}
          >
            Prev
          </Button>
          <span className="text-muted-foreground text-xs">
            {page} / {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => {
              setPage((p) => p + 1)
            }}
          >
            Next
          </Button>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Multi-select zip list (local search + pagination — data already in memory)
// ---------------------------------------------------------------------------

function ZipListView({
  selectedZipCodes,
  activeLayer,
  count,
  onFocusZip,
}: {
  selectedZipCodes: string[]
  activeLayer: Layer | undefined
  count: number
  onFocusZip: (zip: string) => void
}) {
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)

  useEffect(() => {
    setPage(1)
  }, [selectedZipCodes])

  const zipsQuery = useQuery(
    queries.queryZipAssignments(
      {
        layer_id: activeLayer?.id ?? 0,
        zip_codes: selectedZipCodes,
        search: search || undefined,
      },
      page,
      LIST_PAGE_SIZE,
    ),
  )

  const zips = zipsQuery.data?.zip_assignments ?? []
  const totalPages = zipsQuery.data?.total_pages ?? 1

  const handleSearchChange = (val: string) => {
    setSearch(val)
    setPage(1)
  }

  return (
    <>
      <SheetHeader className="border-border border-b p-4">
        <SheetTitle className="text-base">
          {count} {pluralize(activeLayer?.name ?? "item", count)} selected
        </SheetTitle>
        <div className="relative mt-2">
          <IconSearch className="text-muted-foreground absolute top-2.5 left-2.5 h-4 w-4" />
          <Input
            placeholder="Filter by zip code…"
            value={search}
            onChange={(e) => {
              handleSearchChange(e.target.value)
            }}
            className="pl-8"
          />
        </div>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto">
        {zipsQuery.isPending && (
          <div className="flex justify-center py-8">
            <IconLoader2 className="text-muted-foreground h-5 w-5 animate-spin" />
          </div>
        )}
        {!zipsQuery.isPending && zips.length === 0 && (
          <p className="text-muted-foreground px-4 py-8 text-center text-sm">
            No results
          </p>
        )}
        {zips.map((za) => (
          <button
            key={za.zip_code}
            onClick={() => {
              onFocusZip(za.zip_code)
            }}
            className="border-border hover:bg-muted flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors"
          >
            <span
              className="border-border h-4 w-4 shrink-0 rounded-full border"
              style={{ backgroundColor: za.color }}
            />
            <span className="flex-1 text-sm font-medium">{za.zip_code}</span>
            <IconChevronRight className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
          </button>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="border-border flex items-center justify-between border-t px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={page === 1}
            onClick={() => {
              setPage((p) => p - 1)
            }}
          >
            Prev
          </Button>
          <span className="text-muted-foreground text-xs">
            {page} / {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => {
              setPage((p) => p + 1)
            }}
          >
            Next
          </Button>
        </div>
      )}
    </>
  )
}
