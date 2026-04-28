import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconEye,
  IconEyeOff,
  IconFileSpreadsheet,
  IconHandGrab,
  IconHome,
  IconInfoCircle,
  IconLasso,
  IconLoader2,
  IconLogout,
  IconPlus,
  IconPresentation,
  IconSettings,
  IconX,
} from "@tabler/icons-react"
import { useQueryClient } from "@tanstack/react-query"
import { differenceInDays, format, formatDistanceToNow } from "date-fns"
import pluralize from "pluralize"
import { useEffect, useMemo, useRef, useState } from "react"
import { type MapRef } from "react-map-gl/maplibre"
import { useNavigate, useParams } from "react-router-dom"

import { useMaps, useMe } from "@/app/providers/me-provider/context"
import { AppRoutes, PageName } from "@/app/routes"
import { BrandLogo } from "@/components/brand-logo"
import { PageLayout } from "@/components/layout"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenuButton,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { DeleteDialog } from "@/features/home/components/delete-dialog"
import { ExportZttDialog } from "@/features/home/components/export-ztt-dialog"
import {
  type ClickSelectResult,
  type HoverHierarchyItem,
  Map,
} from "@/features/home/components/map"
import { MergeDialog } from "@/features/home/components/merge-dialog"
import { MoveDialog } from "@/features/home/components/move-dialog"
import { NodeDetailSheet } from "@/features/home/components/node-detail-sheet"
import {
  SearchBar,
  type SearchResultItem,
} from "@/features/home/components/search-bar"
import { SelectionSheet } from "@/features/home/components/selection-sheet"
import {
  ActiveMapProvider,
  useActiveMap,
  useLayers,
} from "@/features/home/providers/active-map-provider"
import {
  useLogoutMutation,
  useSpatialSelectMutation,
} from "@/queries/mutations"
import { queries } from "@/queries/queries"

import type { BaseMapName } from "./components/map/config"
import {
  updateSelectedNodeStates,
  updateSelectedZipStates,
} from "./components/map/utils"

const ACTIVE_MAP_KEY = "terramaps_active_map_id"

const BASE_MAPS = [
  { id: "osm", name: "OpenStreetMap" },
  { id: "satellite", name: "Satellite" },
  { id: "terrain", name: "Terrain" },
  { id: "dark", name: "Dark" },
  { id: "none", name: "None" },
]

function formatLastEdited(isoDate: string | null | undefined): string {
  if (!isoDate) return "Never edited"
  const date = new Date(isoDate)
  if (differenceInDays(new Date(), date) < 7) {
    return `Edited ${formatDistanceToNow(date, { addSuffix: true })}`
  }
  return `Edited ${format(date, "MMM d, yyyy")}`
}

function HomePageContent() {
  const mapRef = useRef<MapRef | null>(null)

  const activeMap = useActiveMap()
  const layerList = useLayers()

  const [dataLabelFields, setDataLabelFields] = useState<
    Record<number, string | null>
  >({})
  const setDataLabelField = (layerId: number, field: string | null) => {
    setDataLabelFields((prev) => ({ ...prev, [layerId]: field }))
  }
  const queryClient = useQueryClient()
  const maps = useMaps()
  const me = useMe()
  const navigate = useNavigate()

  const activeJob = activeMap.active_job
  const importState = activeMap.import_state
  const isImporting = importState.status === "importing"
  const isImportFailed = importState.status === "failed"

  const [baseMap, setBaseMap] = useState<BaseMapName>("osm")

  // Initialize default view: second layer (index 1) if it exists, otherwise first.
  const defaultLayer = layerList.length > 1 ? layerList[1] : layerList[0]
  const [fillLayerId, setFillLayerId] = useState<number | null>(
    defaultLayer?.id ?? null,
  )
  const [borderLayerIds, setBorderLayerIds] = useState<Set<number>>(
    () => new Set(defaultLayer ? [defaultLayer.id] : []),
  )
  const [labelLayerIds, setLabelLayerIds] = useState<Set<number>>(
    () => new Set(defaultLayer ? [defaultLayer.id] : []),
  )
  const [currentTool, setCurrentTool] = useState<"pan" | "select">("pan")
  const logoutMutation = useLogoutMutation()

  const [selectedNodeIds, setSelectedNodeIds] = useState<number[]>([])
  const [selectedZipCodes, setSelectedZipCodes] = useState<string[]>([])

  // Dialog state
  const [moveOpen, setMoveOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [exportZttOpen, setExportZttOpen] = useState(false)

  const [activeLayerId, setActiveLayerId] = useState<number | undefined>(
    defaultLayer?.id,
  )
  const activeLayer = layerList.find((layer) => layer.id === activeLayerId)

  // Clear selection, reset MapLibre visual state, and close all dialogs
  const clearSelection = () => {
    if (mapRef.current && activeLayerId != null) {
      const map = mapRef.current.getMap()
      if (activeLayer?.order === 0) {
        updateSelectedZipStates(map, activeLayerId, selectedZipCodes, [])
      } else {
        updateSelectedNodeStates(map, activeLayerId, selectedNodeIds, [])
      }
    }
    setSelectedNodeIds([])
    setSelectedZipCodes([])
    setMoveOpen(false)
    setMergeOpen(false)
    setDeleteOpen(false)
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === "INPUT" || tag === "TEXTAREA") return
      if (e.key === "v" || e.key === "V") setCurrentTool("pan")
      if (e.key === "l" || e.key === "L") setCurrentTool("select")
    }
    window.addEventListener("keydown", handler)
    return () => {
      window.removeEventListener("keydown", handler)
    }
  }, [])
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === "INPUT" || tag === "TEXTAREA") return
      if (e.key === "Escape") clearSelection()
    }
    window.addEventListener("keydown", handler)
    return () => {
      window.removeEventListener("keydown", handler)
    }
  })

  const spatialSelectMutation = useSpatialSelectMutation()

  // Search / detail sheet state
  const [detailResult, setDetailResult] = useState<SearchResultItem | null>(
    null,
  )

  // Close search detail sheet when the user makes a lasso/click selection
  const selectionCount =
    activeLayer?.order === 0 ? selectedZipCodes.length : selectedNodeIds.length
  useEffect(() => {
    if (selectionCount > 0) setDetailResult(null)
  }, [selectionCount])

  const [hoveredHierarchy, setHoveredHierarchy] = useState<
    HoverHierarchyItem[]
  >([])

  const handleSearchSelect = (result: SearchResultItem) => {
    // Fly map to the result's centroid if geometry is available
    if (result.centroid && mapRef.current) {
      mapRef.current.getMap().flyTo({
        center: [result.centroid[0], result.centroid[1]],
        zoom: result.type === "zip" ? 12 : 8,
        duration: 1000,
      })
    }
    setDetailResult(result)
  }

  // The layer one order above the active layer — used as the parent picker target
  // for Move and Merge dialogs.
  const parentLayer = useMemo(() => {
    if (!activeLayer) return null
    return layerList.find((l) => l.order === activeLayer.order + 1) ?? null
  }, [activeLayer, layerList])

  const hasSelection = selectionCount > 0
  const isZipLayer = activeLayer?.order === 0

  const handleClickSelect = (result: ClickSelectResult, additive: boolean) => {
    if (!mapRef.current || activeLayerId == null) return
    const map = mapRef.current.getMap()
    if ("zipCode" in result) {
      const next = additive
        ? selectedZipCodes.includes(result.zipCode)
          ? selectedZipCodes.filter((z) => z !== result.zipCode)
          : [...selectedZipCodes, result.zipCode]
        : [result.zipCode]
      updateSelectedZipStates(map, activeLayerId, selectedZipCodes, next)
      setSelectedZipCodes(next)
    } else {
      const next = additive
        ? selectedNodeIds.includes(result.nodeId)
          ? selectedNodeIds.filter((id) => id !== result.nodeId)
          : [...selectedNodeIds, result.nodeId]
        : [result.nodeId]
      updateSelectedNodeStates(map, activeLayerId, selectedNodeIds, next)
      setSelectedNodeIds(next)
    }
  }

  // Called after any bulk action that triggers a recompute job. Clears
  // selection and immediately refreshes the current map so the "Recomputing…"
  // status appears in the sidebar without waiting for the next poll cycle.
  const onActionSuccess = () => {
    clearSelection()
    void queryClient.invalidateQueries({
      queryKey: queries.getMap(activeMap.id).queryKey,
    })
  }

  const layers = useMemo(
    () =>
      layerList.map((_layer) => ({
        id: _layer.id,
        order: _layer.order,
        showFill: fillLayerId === _layer.id,
        showOutline: borderLayerIds.has(_layer.id),
        showLabel: labelLayerIds.has(_layer.id),
        dataLabelField: dataLabelFields[_layer.id] ?? null,
      })),
    [layerList, fillLayerId, borderLayerIds, labelLayerIds, dataLabelFields],
  )

  const toggleFill = (layerId: number) => {
    setFillLayerId((prev) => (prev === layerId ? null : layerId))
  }

  const toggleBorder = (layerId: number) => {
    setBorderLayerIds((prev) => {
      const next = new Set(prev)
      if (next.has(layerId)) next.delete(layerId)
      else next.add(layerId)
      return next
    })
  }

  const toggleLabel = (layerId: number) => {
    setLabelLayerIds((prev) => {
      const next = new Set(prev)
      if (next.has(layerId)) next.delete(layerId)
      else next.add(layerId)
      return next
    })
  }

  return (
    <>
      <PageLayout>
        <PageLayout.SideNav>
          <Sidebar>
            <SidebarHeader className="border-border border-b p-4 gap-4">
              <BrandLogo />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton className="h-auto w-full py-2">
                    <div className="flex w-full items-center gap-3">
                      <IconHome className="h-5 w-5 shrink-0" />
                      <div className="flex-1 text-left">
                        <div className="text-sm font-medium leading-tight">
                          {activeMap.name}
                        </div>
                        <div className="text-muted-foreground text-xs">
                          {activeJob
                            ? activeJob.status === "failed"
                              ? "Recompute failed"
                              : (activeJob.step ?? "Recomputing…")
                            : formatLastEdited(activeMap.updated_at)}
                        </div>
                      </div>
                      {activeJob && activeJob.status !== "failed" && (
                        <IconLoader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                      )}
                      <IconChevronDown className="h-4 w-4 shrink-0" />
                    </div>
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="w-(--radix-popper-anchor-width)"
                >
                  <DropdownMenuLabel>Recent Maps</DropdownMenuLabel>
                  {maps.map((map) => (
                    <DropdownMenuItem
                      key={map.id}
                      className="gap-3"
                      onClick={() => {
                        localStorage.setItem(ACTIVE_MAP_KEY, map.id)
                        void navigate(
                          AppRoutes.getRoute(PageName.Home, { mapId: map.id }),
                        )
                      }}
                    >
                      <IconHome className="h-4 w-4 shrink-0" />
                      <div className="flex-1">
                        <div className="text-sm font-medium">{map.name}</div>
                        <div className="text-muted-foreground text-xs">
                          {map.active_job
                            ? map.active_job.status === "failed"
                              ? "Recompute failed"
                              : (map.active_job.step ?? "Recomputing…")
                            : formatLastEdited(map.updated_at)}
                        </div>
                      </div>
                      {map.active_job && map.active_job.status !== "failed" && (
                        <IconLoader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                      )}
                      {map.id === activeMap.id && !map.active_job && (
                        <IconCheck className="h-4 w-4" />
                      )}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>
                    <IconSettings className="h-4 w-4" />
                    <span>Map Settings</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={AppRoutes.getRoute("InitializePage")}>
                      <IconPlus className="h-4 w-4" />
                      <span>New Map</span>
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarHeader>

            <SidebarContent>
              {/* Active Layer */}
              <SidebarGroup>
                <SidebarGroupLabel>
                  Active Layer
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="text-muted-foreground hover:text-foreground ml-auto">
                        <IconInfoCircle className="h-3.5 w-3.5" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent side="right" className="w-80">
                      <div className="space-y-2">
                        <h4 className="font-semibold">Active Layer</h4>
                        <p className="text-muted-foreground text-sm">
                          Select which geographic layer you want to work with.
                          All editing tools and selection operations will apply
                          to this layer.
                        </p>
                        <div className="text-muted-foreground text-xs">
                          <strong>Tip:</strong> Use keyboard shortcuts 1-4 to
                          quickly switch between layers.
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <Select
                    value={activeLayerId?.toString()}
                    onValueChange={(val) => {
                      if (mapRef.current && activeLayerId) {
                        if (activeLayer?.order === 0) {
                          updateSelectedZipStates(
                            mapRef.current.getMap(),
                            activeLayerId,
                            selectedZipCodes,
                            [],
                          )
                          setSelectedZipCodes([])
                        } else {
                          updateSelectedNodeStates(
                            mapRef.current.getMap(),
                            activeLayerId,
                            selectedNodeIds,
                            [],
                          )
                          setSelectedNodeIds([])
                        }
                      }
                      setActiveLayerId(parseInt(val))
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {layerList.map((layer) => (
                        <SelectItem key={layer.id} value={layer.id.toString()}>
                          {layer.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SidebarGroupContent>
              </SidebarGroup>

              {/* Base Map */}
              <SidebarGroup>
                <SidebarGroupLabel>
                  Base Map
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="text-muted-foreground hover:text-foreground ml-auto">
                        <IconInfoCircle className="h-3.5 w-3.5" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent side="right" className="w-80">
                      <div className="space-y-2">
                        <h4 className="font-semibold">Base Map Style</h4>
                        <p className="text-muted-foreground text-sm">
                          Choose the background map that works best for your
                          workflow. Each style provides different context.
                        </p>
                        <ul className="text-muted-foreground space-y-1 text-xs">
                          <li>
                            • <strong>OpenStreetMap:</strong> Detailed streets
                            and labels
                          </li>
                          <li>
                            • <strong>Satellite:</strong> Aerial imagery
                          </li>
                          <li>
                            • <strong>Terrain:</strong> Topographic features
                          </li>
                          <li>
                            • <strong>Dark:</strong> Reduced eye strain
                          </li>
                        </ul>
                      </div>
                    </PopoverContent>
                  </Popover>
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <Select
                    value={baseMap}
                    onValueChange={(value) => {
                      setBaseMap(value as typeof baseMap)
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BASE_MAPS.map((baseMap) => (
                        <SelectItem key={baseMap.id} value={baseMap.id}>
                          {baseMap.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SidebarGroupContent>
              </SidebarGroup>

              {/* Layers */}
              <SidebarGroup>
                <SidebarGroupLabel>Layers</SidebarGroupLabel>
                <SidebarGroupContent>
                  <div className="space-y-1">
                    {layerList.map((layer) => {
                      const hasFill = fillLayerId === layer.id
                      const hasBorder = borderLayerIds.has(layer.id)
                      const hasLabels = labelLayerIds.has(layer.id)
                      // Build label options: "Name" plus one entry per field+aggregation combo
                      const mapDataFields = activeMap.data_field_config ?? []

                      return (
                        <Collapsible key={layer.id}>
                          <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                            <IconChevronDown className="text-muted-foreground h-3.5 w-3.5 shrink-0 transition-transform group-data-[state=closed]:-rotate-90" />
                            <span className="flex-1 truncate text-left font-medium">
                              {layer.name}
                            </span>
                            <div className="flex items-center gap-1">
                              <span
                                className={`rounded px-1 py-0.5 font-mono text-[10px] font-semibold leading-none transition-colors ${hasFill ? "bg-primary text-primary-foreground" : "text-muted-foreground/50"}`}
                              >
                                F
                              </span>
                              <span
                                className={`rounded px-1 py-0.5 font-mono text-[10px] font-semibold leading-none transition-colors ${hasBorder ? "bg-primary text-primary-foreground" : "text-muted-foreground/50"}`}
                              >
                                B
                              </span>
                              <span
                                className={`rounded px-1 py-0.5 font-mono text-[10px] font-semibold leading-none transition-colors ${hasLabels ? "bg-primary text-primary-foreground" : "text-muted-foreground/50"}`}
                              >
                                L
                              </span>
                              <button
                                className="text-muted-foreground/50 hover:text-foreground ml-0.5 transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  const allOn =
                                    hasFill && hasBorder && hasLabels
                                  if (allOn) {
                                    setFillLayerId((prev) =>
                                      prev === layer.id ? null : prev,
                                    )
                                    toggleBorder(layer.id)
                                    toggleLabel(layer.id)
                                  } else {
                                    setFillLayerId(layer.id)
                                    setBorderLayerIds(
                                      (prev) => new Set([...prev, layer.id]),
                                    )
                                    setLabelLayerIds(
                                      (prev) => new Set([...prev, layer.id]),
                                    )
                                  }
                                }}
                              >
                                {hasFill && hasBorder && hasLabels ? (
                                  <IconEye className="h-3.5 w-3.5" />
                                ) : (
                                  <IconEyeOff className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </div>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="mt-0.5 ml-2 space-y-px border-l pl-3.5 pb-1">
                              <div className="flex items-center justify-between rounded px-1.5 py-1">
                                <span className="text-muted-foreground text-xs">
                                  Fill
                                </span>
                                <Switch
                                  size="sm"
                                  checked={hasFill}
                                  onCheckedChange={() => {
                                    toggleFill(layer.id)
                                  }}
                                />
                              </div>
                              <div className="flex items-center justify-between rounded px-1.5 py-1">
                                <span className="text-muted-foreground text-xs">
                                  Border
                                </span>
                                <Switch
                                  size="sm"
                                  checked={hasBorder}
                                  onCheckedChange={() => {
                                    toggleBorder(layer.id)
                                  }}
                                />
                              </div>
                              <div className="flex items-center justify-between rounded px-1.5 py-1">
                                <span className="text-muted-foreground text-xs">
                                  Labels
                                </span>
                                <Switch
                                  size="sm"
                                  checked={hasLabels}
                                  onCheckedChange={() => {
                                    toggleLabel(layer.id)
                                  }}
                                />
                              </div>
                              {/* Data label — one option per field+agg from data_field_config */}
                              {mapDataFields.length > 0 && (
                                <div className="mt-1 pb-0.5">
                                  <p className="text-muted-foreground/70 px-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wider">
                                    Data label
                                  </p>
                                  {[
                                    {
                                      mvtProp: null as string | null,
                                      label: "None",
                                    },
                                    ...mapDataFields.flatMap((f) =>
                                      f.aggregations.map((agg) => ({
                                        mvtProp: `${f.field}_${agg}`,
                                        label: `${f.label || f.field} (${agg})`,
                                      })),
                                    ),
                                  ].map(({ mvtProp, label }) => {
                                    const isActive =
                                      (dataLabelFields[layer.id] ?? null) ===
                                      mvtProp
                                    return (
                                      <button
                                        key={mvtProp ?? "none"}
                                        onClick={() => {
                                          setDataLabelField(layer.id, mvtProp)
                                        }}
                                        className={`flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left transition-colors ${
                                          isActive
                                            ? "text-primary"
                                            : "text-muted-foreground hover:text-foreground"
                                        }`}
                                      >
                                        <span
                                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? "bg-primary" : "bg-muted-foreground/25"}`}
                                        />
                                        <span className="text-xs">{label}</span>
                                      </button>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      )
                    })}
                  </div>
                </SidebarGroupContent>
              </SidebarGroup>

              {/* Exports */}
              <SidebarGroup>
                <SidebarGroupLabel>Exports</SidebarGroupLabel>
                <SidebarGroupContent>
                  <div className="space-y-1.5 px-0.5">
                    <button
                      onClick={() => {
                        setExportZttOpen(true)
                      }}
                      className="group flex w-full items-center gap-3 rounded-md border bg-card p-2.5 text-left transition-colors hover:bg-accent hover:border-accent-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <IconFileSpreadsheet className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium leading-tight">
                          Export to ZTT
                        </div>
                        <div className="text-muted-foreground mt-0.5 text-[11px] leading-tight">
                          Zip-to-territory Excel file
                        </div>
                      </div>
                      <IconChevronRight className="text-muted-foreground/40 h-3.5 w-3.5 shrink-0 transition-colors group-hover:text-muted-foreground" />
                    </button>

                    <div className="group flex w-full cursor-not-allowed items-center gap-3 rounded-md border border-dashed p-2.5 opacity-45">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <IconPresentation className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <div className="text-xs font-medium leading-tight">
                            Territory Report
                          </div>
                          <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-px text-[9px] font-semibold uppercase leading-none tracking-wide">
                            Soon
                          </span>
                        </div>
                        <div className="text-muted-foreground mt-0.5 text-[11px] leading-tight">
                          PowerPoint slide deck
                        </div>
                      </div>
                    </div>
                  </div>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>

            <SidebarFooter className="border-border border-t p-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-sidebar-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <Avatar size="default">
                      <AvatarFallback>
                        {me.name
                          ? me.name
                              .trim()
                              .split(/\s+/)
                              .map((w) => w[0])
                              .join("")
                              .toUpperCase()
                              .slice(0, 2)
                          : me.email[0].toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      {me.name && (
                        <p className="text-sm font-medium leading-tight truncate">
                          {me.name}
                        </p>
                      )}
                      <p
                        className={`text-muted-foreground truncate ${me.name ? "text-xs" : "text-sm"}`}
                      >
                        {me.email}
                      </p>
                    </div>
                    <IconChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col gap-0.5">
                      {me.name && (
                        <span className="font-medium">{me.name}</span>
                      )}
                      <span className="text-xs text-muted-foreground truncate">
                        {me.email}
                      </span>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() =>
                      void navigate(AppRoutes.getRoute(PageName.Settings))
                    }
                  >
                    <IconSettings className="mr-2 h-4 w-4" />
                    Account settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      logoutMutation.mutate()
                    }}
                    disabled={logoutMutation.isPending}
                    className="text-destructive focus:text-destructive"
                  >
                    <IconLogout className="mr-2 h-4 w-4" />
                    {logoutMutation.isPending ? "Logging out…" : "Log out"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarFooter>
          </Sidebar>
        </PageLayout.SideNav>

        <PageLayout.TopNav>
          <div className="flex w-full items-center gap-4">
            <SidebarTrigger />
            <SearchBar
              mapId={activeMap.id}
              onSelect={handleSearchSelect}
              className="max-w-80 w-full"
            />
          </div>
        </PageLayout.TopNav>

        <PageLayout.FullScreenBody>
          <div className="relative h-full w-full">
            <Map
              ref={mapRef}
              baseMap={baseMap}
              layers={layers}
              currentTool={currentTool}
              activeLayerId={activeLayerId}
              tileVersion={activeMap.tile_version}
              onClickSelect={handleClickSelect}
              onLassoComplete={(geojson, additive) => {
                if (activeLayerId != null) {
                  spatialSelectMutation.mutate(
                    { lasso: geojson, layerId: activeLayerId },
                    {
                      onSuccess: (response) => {
                        if (!mapRef.current) return
                        const map = mapRef.current.getMap()
                        if (activeLayer?.order === 0) {
                          const incoming = response.zip_codes ?? []
                          const next = additive
                            ? [...new Set([...selectedZipCodes, ...incoming])]
                            : incoming
                          updateSelectedZipStates(
                            map,
                            activeLayerId,
                            selectedZipCodes,
                            next,
                          )
                          setSelectedZipCodes(next)
                        } else {
                          const incoming = response.nodes
                          const next = additive
                            ? [...new Set([...selectedNodeIds, ...incoming])]
                            : incoming
                          updateSelectedNodeStates(
                            map,
                            activeLayerId,
                            selectedNodeIds,
                            next,
                          )
                          setSelectedNodeIds(next)
                        }
                      },
                    },
                  )
                }
              }}
              selectedNodeIds={selectedNodeIds}
              selectedZipCodes={selectedZipCodes}
              onHover={setHoveredHierarchy}
              onHoverEnd={() => {
                setHoveredHierarchy([])
              }}
            />

            {hoveredHierarchy.length > 0 && (
              <div
                className={`absolute top-4 rounded-lg border bg-background/90 px-3 py-2 shadow-md backdrop-blur-sm pointer-events-none transition-[right] duration-200 ease-in-out ${hasSelection ? "right-100" : "right-4"}`}
              >
                <div className="space-y-0.5">
                  {[...layerList]
                    .sort((a, b) => b.order - a.order)
                    .map((layer) => {
                      const hit = hoveredHierarchy.find(
                        (h) => h.layerId === layer.id,
                      )
                      const layerDataField = dataLabelFields[layer.id] ?? null
                      const lensValue =
                        layerDataField && hit?.data
                          ? (() => {
                              const raw = hit.data[layerDataField]
                              if (raw == null) return null
                              const fieldCfg = (
                                activeMap.data_field_config ?? []
                              ).find((f) => layerDataField.startsWith(f.field))
                              const prefix = fieldCfg?.field.includes("revenue")
                                ? "$"
                                : ""
                              if (raw >= 1_000_000)
                                return `${prefix}${(raw / 1_000_000).toFixed(1)}M`
                              if (raw >= 10_000)
                                return `${prefix}${(raw / 1_000).toFixed(0)}K`
                              if (raw >= 1_000)
                                return `${prefix}${(raw / 1_000).toFixed(1)}K`
                              return `${prefix}${raw.toFixed(0)}`
                            })()
                          : null
                      return (
                        <div
                          key={layer.id}
                          className="flex items-baseline gap-2"
                        >
                          <span className="text-muted-foreground text-xs w-16 shrink-0 truncate text-right">
                            {layer.name}
                          </span>
                          {hit ? (
                            <>
                              <span className="text-foreground text-xs font-medium truncate max-w-32">
                                {hit.name}
                              </span>
                              {lensValue && (
                                <span className="text-primary ml-auto shrink-0 font-bold tabular-nums text-[11px]">
                                  {lensValue}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-muted-foreground/50 text-xs">
                              —
                            </span>
                          )}
                        </div>
                      )
                    })}
                </div>
              </div>
            )}

            <div className="absolute bottom-4 left-4 flex flex-col gap-0.5 rounded-lg border bg-background/90 p-1 shadow-md backdrop-blur-sm">
              {(
                [
                  {
                    tool: "pan",
                    icon: IconHandGrab,
                    label: "Pan",
                    shortcut: "V",
                  },
                  {
                    tool: "select",
                    icon: IconLasso,
                    label: "Select",
                    shortcut: "L",
                  },
                ] as const
              ).map(({ tool, icon: Icon, label, shortcut }) => (
                <Tooltip key={tool}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => {
                        setCurrentTool(tool)
                      }}
                      className={`rounded p-2 transition-colors ${
                        currentTool === tool
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {label}
                    <kbd className="bg-muted text-muted-foreground ml-2 rounded px-1 py-0.5 font-mono text-[10px]">
                      {shortcut}
                    </kbd>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>

            {/* Floating action bar — appears when something is selected */}
            {hasSelection && activeLayer && (
              <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
                <div className="flex items-center gap-1 rounded-full border bg-background/95 px-3 py-1.5 shadow-lg backdrop-blur-sm">
                  <span className="text-sm font-medium px-1">
                    {selectionCount}{" "}
                    {pluralize(activeLayer.name, selectionCount)}
                  </span>
                  <Separator orientation="vertical" className="mx-1 h-4" />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-full"
                    onClick={() => {
                      setMoveOpen(true)
                    }}
                  >
                    Move
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-full"
                    disabled={isZipLayer || selectionCount < 2}
                    title={
                      isZipLayer
                        ? "Cannot merge zip codes"
                        : selectionCount < 2
                          ? "Select 2 or more to merge"
                          : undefined
                    }
                    onClick={() => {
                      setMergeOpen(true)
                    }}
                  >
                    Merge
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-full text-destructive hover:text-destructive"
                    onClick={() => {
                      setDeleteOpen(true)
                    }}
                  >
                    {isZipLayer ? "Unassign" : "Delete"}
                  </Button>
                  <Separator orientation="vertical" className="mx-1 h-4" />
                  <button
                    onClick={clearSelection}
                    className="text-muted-foreground hover:text-foreground p-1 transition-colors"
                    title="Clear selection (Esc)"
                  >
                    <IconX className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}

            {(isImporting || isImportFailed) && (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-6 rounded-2xl border bg-card/95 p-10 shadow-2xl">
                  {isImportFailed ? (
                    <>
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
                        <span className="text-destructive text-2xl font-bold">
                          !
                        </span>
                      </div>
                      <div className="text-center space-y-1.5">
                        <p className="text-lg font-semibold">Import failed</p>
                        <p className="text-muted-foreground text-sm max-w-xs">
                          {importState.error ??
                            "An error occurred while building this map."}
                        </p>
                      </div>
                      <div className="flex flex-col items-center gap-2">
                        <a
                          href={AppRoutes.getRoute(
                            PageName.InitializeProcessing,
                            { mapId: activeMap.id },
                          )}
                          className="text-sm text-primary underline underline-offset-4"
                        >
                          View import details
                        </a>
                        <a
                          href={AppRoutes.getRoute(PageName.Initialize)}
                          className="text-sm text-muted-foreground underline underline-offset-4"
                        >
                          Start a new import
                        </a>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="relative size-14">
                        <div className="absolute inset-0 rounded-full border-4 border-muted" />
                        <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin" />
                      </div>
                      <div className="text-center space-y-1.5">
                        <p className="text-lg font-semibold">
                          Building your map
                        </p>
                        <p className="text-muted-foreground text-sm">
                          {importState.step ?? "Setting up territories…"}
                        </p>
                        <p className="text-muted-foreground/60 text-xs">
                          This may take a minute
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </PageLayout.FullScreenBody>
      </PageLayout>
      {activeLayer && (
        <>
          <MoveDialog
            open={moveOpen}
            onOpenChange={setMoveOpen}
            activeLayer={activeLayer}
            parentLayer={parentLayer}
            selectedNodeIds={selectedNodeIds}
            selectedZipCodes={selectedZipCodes}
            onSuccess={onActionSuccess}
          />
          <MergeDialog
            open={mergeOpen}
            onOpenChange={setMergeOpen}
            activeLayer={activeLayer}
            parentLayer={parentLayer}
            selectedNodeIds={selectedNodeIds}
            onSuccess={onActionSuccess}
          />
          <DeleteDialog
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            activeLayer={activeLayer}
            selectedNodeIds={selectedNodeIds}
            selectedZipCodes={selectedZipCodes}
            onSuccess={onActionSuccess}
          />
        </>
      )}
      <ExportZttDialog
        open={exportZttOpen}
        onOpenChange={setExportZttOpen}
        mapId={activeMap.id}
        mapName={activeMap.name}
        layers={layerList}
      />
      <NodeDetailSheet
        result={detailResult}
        layers={layerList}
        onClose={() => {
          setDetailResult(null)
        }}
      />
      <SelectionSheet
        selectedNodeIds={selectedNodeIds}
        selectedZipCodes={selectedZipCodes}
        activeLayer={activeLayer}
        layers={layerList}
        dataFieldConfig={activeMap.data_field_config ?? []}
        onClose={clearSelection}
      />
    </>
  )
}

export default function HomePage() {
  const maps = useMaps()
  const { mapId } = useParams<{ mapId: string }>()
  const currentMap = maps.find((m) => m.id === mapId) ?? maps[0]

  return (
    <ActiveMapProvider key={currentMap.id} mapId={currentMap.id}>
      <HomePageContent />
    </ActiveMapProvider>
  )
}
