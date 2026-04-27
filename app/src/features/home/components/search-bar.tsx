/**
 * SearchBar — debounced global search over all layers in a map.
 *
 * Fires onSelect with the chosen SearchResultItem so the parent can fly the
 * map to the result's centroid and open the node/zip detail sheet.
 */
import { IconLoader2, IconSearch } from "@tabler/icons-react"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import { Input } from "@/components/ui/input"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import type { components } from "@/lib/api/v1"
import { cn } from "@/lib/utils"
import { queries } from "@/queries/queries"

export type SearchResultItem = components["schemas"]["SearchResultItem"]

interface SearchBarProps {
  mapId: string
  onSelect: (result: SearchResultItem) => void
  className?: string
}

export function SearchBar({ mapId, onSelect, className }: SearchBarProps) {
  const [rawQ, setRawQ] = useState("")
  const [debouncedQ, setDebouncedQ] = useState("")
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // 300 ms debounce — no external library needed
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQ(rawQ)
    }, 300)
    return () => {
      clearTimeout(timer)
    }
  }, [rawQ])

  const searchQuery = useQuery(queries.searchMap(mapId, debouncedQ))
  const results = searchQuery.data?.results ?? []
  const showDropdown = open && rawQ.trim().length > 0

  // Group results by layer for display
  const grouped = results.reduce<
    Array<{ layerName: string; items: SearchResultItem[] }>
  >((acc, item) => {
    const existing = acc.find((g) => g.layerName === item.layer_name)
    if (existing) {
      existing.items.push(item)
    } else {
      acc.push({ layerName: item.layer_name, items: [item] })
    }
    return acc
  }, [])

  const handleSelect = (result: SearchResultItem) => {
    onSelect(result)
    setOpen(false)
    setRawQ("")
    setDebouncedQ("")
  }

  return (
    <Popover open={showDropdown} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className={cn("relative", className)}>
          <IconSearch className="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 h-4 w-4" />
          <Input
            ref={inputRef}
            type="search"
            placeholder="Search territories, zip codes…"
            className="pl-8"
            value={rawQ}
            onChange={(e) => {
              setRawQ(e.target.value)
              if (e.target.value.trim()) setOpen(true)
              else setOpen(false)
            }}
            onFocus={() => {
              if (rawQ.trim()) setOpen(true)
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setOpen(false)
                inputRef.current?.blur()
              }
            }}
          />
          {searchQuery.isFetching && (
            <IconLoader2 className="text-muted-foreground absolute top-2.5 right-2.5 h-4 w-4 animate-spin" />
          )}
        </div>
      </PopoverAnchor>

      <PopoverContent
        className="w-80 p-0"
        align="start"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
        }}
        onInteractOutside={() => {
          setOpen(false)
        }}
      >
        <div className="max-h-80 overflow-y-auto p-1">
          {searchQuery.isFetching && results.length === 0 && (
            <p className="text-muted-foreground py-6 text-center text-sm">
              Searching…
            </p>
          )}

          {!searchQuery.isFetching && results.length === 0 && debouncedQ && (
            <p className="text-muted-foreground py-6 text-center text-sm">
              No results for &ldquo;{debouncedQ}&rdquo;
            </p>
          )}

          {grouped.map((group) => (
            <div key={group.layerName}>
              <p className="text-muted-foreground px-2 py-1.5 text-xs font-medium">
                {group.layerName}
              </p>
              {group.items.map((item) => (
                <button
                  key={`${item.type}-${String(item.id)}`}
                  type="button"
                  className="hover:bg-muted flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm"
                  onClick={() => {
                    handleSelect(item)
                  }}
                >
                  <span
                    className="border-border h-3 w-3 shrink-0 rounded-full border"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="flex-1 truncate text-left">{item.name}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
