/**
 * NodePicker — searchable, paginated list for selecting a node.
 *
 * Used in Move, Merge, and Delete dialogs. Accepts a layerId to fetch from,
 * an optional list of nodeIds to exclude from the results, and a controlled
 * value/onChange pair.
 */
import {
  IconChevronLeft,
  IconChevronRight,
  IconPlus,
  IconSearch,
} from "@tabler/icons-react"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { queries } from "@/queries/queries"

const PAGE_SIZE = 50

export interface NodePickerNode {
  id: number
  name: string
}

interface NodePickerProps {
  /** The layer to list nodes from. */
  layerId: number
  /** Node IDs to exclude from the results (e.g. nodes being deleted). */
  excludeNodeIds?: number[]
  /** Currently selected node id, or null for "No parent". */
  value: number | null
  onChange: (value: number | null) => void
  /** Show a "No parent" option at the top. Default true. */
  showNoParent?: boolean
  noParentLabel?: string
  /** Pre-highlighted node ids shown at the top of the first page as a hint group. */
  hintNodeIds?: number[]
  hintLabel?: string
  /**
   * When provided, a "Create '[search]'" option appears at the bottom of the
   * list whenever the search field is non-empty. Called with the trimmed search
   * string when the user clicks it.
   */
  onCreateRequest?: (name: string) => void
  /**
   * When set, the "Create '[name]'" row is shown as selected and regular
   * value-based highlighting is suppressed.
   */
  pendingCreate?: string | null
}

export function NodePicker({
  layerId,
  excludeNodeIds = [],
  value,
  onChange,
  showNoParent = true,
  noParentLabel = "No parent",
  hintNodeIds = [],
  hintLabel,
  onCreateRequest,
  pendingCreate,
}: NodePickerProps) {
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)

  const nodesQuery = useQuery(
    queries.queryNodes(
      { layer_id: layerId, search: search || undefined },
      page,
      PAGE_SIZE,
    ),
  )

  const excludeSet = new Set(excludeNodeIds)
  const hintSet = new Set(hintNodeIds)

  const allNodes = (nodesQuery.data?.nodes ?? []).filter(
    (n) => !excludeSet.has(n.id),
  )
  const totalPages = nodesQuery.data?.total_pages ?? 1

  const hintNodes =
    page === 1 && hintNodeIds.length > 0
      ? allNodes.filter((n) => hintSet.has(n.id))
      : []
  const regularNodes = allNodes.filter((n) => !hintSet.has(n.id))

  const handleSearchChange = (val: string) => {
    setSearch(val)
    setPage(1)
  }

  const Row = ({
    id,
    name,
    className,
  }: {
    id: number | null
    name: string
    className?: string
  }) => (
    <button
      type="button"
      onClick={() => {
        onChange(id)
      }}
      className={cn(
        "w-full rounded-md px-3 py-2 text-left text-sm transition-colors",
        !pendingCreate && value === id
          ? "bg-primary text-primary-foreground"
          : "hover:bg-muted text-foreground",
        className,
      )}
    >
      {name}
    </button>
  )

  const trimmedSearch = search.trim()
  const isCreateSelected =
    !!pendingCreate && pendingCreate === trimmedSearch

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <IconSearch className="text-muted-foreground absolute top-2.5 left-2.5 h-4 w-4" />
        <Input
          placeholder="Search..."
          value={search}
          onChange={(e) => {
            handleSearchChange(e.target.value)
          }}
          className="pl-8"
        />
      </div>

      <ScrollArea className="h-56 rounded-md border">
        <div className="p-1">
          {showNoParent && (
            <>
              <Row
                id={null}
                name={noParentLabel}
                className="text-muted-foreground italic"
              />
              <Separator className="my-1" />
            </>
          )}

          {hintNodes.length > 0 && (
            <>
              {hintLabel && (
                <p className="text-muted-foreground px-3 pb-1 text-xs font-medium">
                  {hintLabel}
                </p>
              )}
              {hintNodes.map((n) => (
                <Row key={n.id} id={n.id} name={n.name} />
              ))}
              {regularNodes.length > 0 && <Separator className="my-1" />}
            </>
          )}

          {nodesQuery.isPending && (
            <p className="text-muted-foreground px-3 py-4 text-center text-sm">
              Loading…
            </p>
          )}

          {!nodesQuery.isPending && allNodes.length === 0 && (
            <p className="text-muted-foreground px-3 py-4 text-center text-sm">
              No results
            </p>
          )}

          {regularNodes.map((n) => (
            <Row key={n.id} id={n.id} name={n.name} />
          ))}

          {onCreateRequest && trimmedSearch && (
            <>
              <Separator className="my-1" />
              <button
                type="button"
                onClick={() => {
                  onCreateRequest(trimmedSearch)
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                  isCreateSelected
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted text-foreground",
                )}
              >
                <IconPlus className="h-3.5 w-3.5 shrink-0" />
                Create &ldquo;{trimmedSearch}&rdquo;
              </button>
            </>
          )}
        </div>
      </ScrollArea>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={page === 1}
            onClick={() => {
              setPage((p) => Math.max(1, p - 1))
            }}
          >
            <IconChevronLeft className="h-4 w-4" />
            Prev
          </Button>
          <span className="text-muted-foreground text-xs">
            Page {page} / {totalPages}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => {
              setPage((p) => p + 1)
            }}
          >
            Next
            <IconChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
