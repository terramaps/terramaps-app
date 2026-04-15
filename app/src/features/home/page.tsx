import {
  IconCheck,
  IconChevronDown,
  IconEye,
  IconEyeOff,
  IconHandGrab,
  IconHome,
  IconInfoCircle,
  IconLasso,
  IconLogout,
  IconPlus,
  IconSettings,
  IconTrash,
} from "@tabler/icons-react"
import { useQuery } from "@tanstack/react-query"
import pluralize from "pluralize"
import { useEffect, useMemo, useRef, useState } from "react"
import { type MapRef } from "react-map-gl/maplibre"

import { useMaps } from "@/app/providers/me-provider/context"
import { AppRoutes } from "@/app/routes"
import Logo from "@/assets/logoipsum.svg?react"
import { PageLayout } from "@/components/layout"
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
import { Input } from "@/components/ui/input"
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
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Map } from "@/features/home/components/map"
import {
  useLogoutMutation,
  useSpatialSelectMutation,
} from "@/queries/mutations"
import { queries } from "@/queries/queries"

import type { BaseMapName } from "./components/map/config"
import { updateSelectedFeatureStates } from "./components/map/utils"

const BASE_MAPS = [
  { id: "osm", name: "OpenStreetMap" },
  { id: "satellite", name: "Satellite" },
  { id: "terrain", name: "Terrain" },
  { id: "dark", name: "Dark" },
  { id: "none", name: "None" },
]

export default function HomePage() {
  const mapRef = useRef<MapRef | null>(null)

  // Track which label fields are active per layer (ordered list shown stacked on map)
  const [labelFields, setLabelFields] = useState<Record<number, string[]>>({})
  const maps = useMaps()
  const [currentMapId, setCurrentMapId] = useState<number>(maps[0]?.id ?? 0)
  const currentMap = maps.find((m) => m.id === currentMapId) ?? maps[0]
  const layersQuery = useQuery(queries.listLayers(currentMap.id))
  const [baseMap, setBaseMap] = useState<BaseMapName>("osm")
  const [fillLayerId, setFillLayerId] = useState<number | null>(null)
  const [borderLayerIds, setBorderLayerIds] = useState<Set<number>>(new Set())
  const [labelLayerIds, setLabelLayerIds] = useState<Set<number>>(new Set())
  const [currentTool, setCurrentTool] = useState<"pan" | "lasso">("pan")
  const logoutMutation = useLogoutMutation()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === "INPUT" || tag === "TEXTAREA") return
      if (e.key === "v" || e.key === "V") setCurrentTool("pan")
      if (e.key === "l" || e.key === "L") setCurrentTool("lasso")
    }
    window.addEventListener("keydown", handler)
    return () => {
      window.removeEventListener("keydown", handler)
    }
  }, [])
  const spatialSelectMutation = useSpatialSelectMutation()
  const [activeLayerId, setActiveLayerId] = useState<number | undefined>(
    undefined,
  )
  const activeLayer = layersQuery.data?.find(
    (layer) => layer.id === activeLayerId,
  )
  const [selectedNodes, setSelectedNodes] = useState<number[]>([])

  if (
    layersQuery.isSuccess &&
    activeLayerId == null &&
    layersQuery.data.length
  ) {
    setActiveLayerId(layersQuery.data[0].id)
  }

  const layers = useMemo(
    () =>
      layersQuery.data
        ? layersQuery.data.map((_layer) => ({
            id: _layer.id,
            showFill: fillLayerId === _layer.id,
            showOutline: borderLayerIds.has(_layer.id),
            showLabel: labelLayerIds.has(_layer.id),
            labelFields: labelFields[_layer.id] ?? ["name"],
          }))
        : [],
    [layersQuery.data, fillLayerId, borderLayerIds, labelLayerIds, labelFields],
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
    <PageLayout>
      <PageLayout.SideNav>
        <Sidebar>
          <SidebarHeader className="border-border border-b p-4 gap-4">
            <Logo className="h-8" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton className="h-auto w-full py-2">
                  <div className="flex w-full items-center gap-3">
                    <IconHome className="h-5 w-5 shrink-0" />
                    <div className="flex-1 text-left">
                      <div className="text-sm font-medium leading-tight">
                        {currentMap.name}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        Last edited TODO
                      </div>
                    </div>
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
                      setCurrentMapId(map.id)
                      setActiveLayerId(undefined)
                      setFillLayerId(null)
                      setBorderLayerIds(new Set())
                      setLabelLayerIds(new Set())
                      setLabelFields({})
                      setSelectedNodes([])
                    }}
                  >
                    <IconHome className="h-4 w-4" />
                    <div className="flex-1">
                      <div className="text-sm font-medium">{map.name}</div>
                      <div className="text-muted-foreground text-xs">
                        Last edited TODO
                      </div>
                    </div>
                    {map.id === currentMap.id && (
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
                        Select which geographic layer you want to work with. All
                        editing tools and selection operations will apply to
                        this layer.
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
                      updateSelectedFeatureStates(
                        mapRef.current.getMap(),
                        activeLayerId,
                        selectedNodes,
                        [],
                      )
                      setSelectedNodes([])
                    }
                    setActiveLayerId(parseInt(val))
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {layersQuery.data
                      ? layersQuery.data.map((layer) => (
                          <SelectItem
                            key={layer.id}
                            value={layer.id.toString()}
                          >
                            {layer.name}
                          </SelectItem>
                        ))
                      : undefined}
                  </SelectContent>
                </Select>
              </SidebarGroupContent>
            </SidebarGroup>

            {/* Selection */}
            <SidebarGroup>
              <SidebarGroupLabel>
                Selection
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="text-muted-foreground hover:text-foreground ml-auto">
                      <IconInfoCircle className="h-3.5 w-3.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="right" className="w-80">
                    <div className="space-y-2">
                      <h4 className="font-semibold">Selection Tools</h4>
                      <p className="text-muted-foreground text-sm">
                        Perform actions on selected map features. Use the lasso
                        tool or click to select features from the active layer.
                      </p>
                      <ul className="text-muted-foreground space-y-1 text-xs">
                        <li>
                          • <strong>Assign:</strong> Add to territory
                        </li>
                        <li>
                          • <strong>Move:</strong> Transfer between territories
                        </li>
                        <li>
                          • <strong>Merge:</strong> Combine features
                        </li>
                        <li>
                          • <strong>Split:</strong> Divide features
                        </li>
                      </ul>
                    </div>
                  </PopoverContent>
                </Popover>
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <div className="bg-muted rounded-lg p-3">
                  <div className="mb-3 text-center">
                    <div className="text-foreground text-2xl font-bold">
                      {selectedNodes.length}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {pluralize(activeLayer?.name ?? "")} selected
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" size="sm" disabled>
                      <IconPlus className="h-4 w-4" />
                      Assign
                    </Button>
                    <Button variant="outline" size="sm" disabled>
                      Move
                    </Button>
                    <Button variant="outline" size="sm" disabled>
                      Merge
                    </Button>
                    <Button variant="outline" size="sm" disabled>
                      Split
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled
                      className="col-span-2"
                    >
                      <IconTrash className="h-4 w-4" />
                      Remove
                    </Button>
                  </div>
                </div>
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
                          • <strong>OpenStreetMap:</strong> Detailed streets and
                          labels
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

            {/* Overlays */}
            {/* <SidebarGroup>
              <SidebarGroupLabel>
                Overlays
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="text-muted-foreground hover:text-foreground ml-auto">
                      <IconInfoCircle className="h-3.5 w-3.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="right" className="w-80">
                    <div className="space-y-2">
                      <h4 className="font-semibold">Map Overlays</h4>
                      <p className="text-muted-foreground text-sm">
                        Add contextual data layers on top of your base map to
                        help with territory planning and analysis.
                      </p>
                      <div className="text-muted-foreground text-xs">
                        <strong>Note:</strong> Overlays may affect map
                        performance when multiple are enabled.
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <div className="space-y-2">
                  {OVERLAYS.map((overlay) => (
                    <label key={overlay.id} className="flex items-center gap-2">
                      <input type="checkbox" className="rounded border-input" />
                      <span className="text-sm">{overlay.name}</span>
                    </label>
                  ))}
                </div>
              </SidebarGroupContent>
            </SidebarGroup> */}

            {/* Layers */}
            <SidebarGroup>
              <SidebarGroupLabel>Layers</SidebarGroupLabel>
              <SidebarGroupContent>
                <div className="space-y-1">
                  {layersQuery.data?.map((layer) => {
                    const hasFill = fillLayerId === layer.id
                    const hasBorder = borderLayerIds.has(layer.id)
                    const hasLabels = labelLayerIds.has(layer.id)
                    // Build label options: "Name" plus one entry per field+aggregation combo
                    const mapDataFields = currentMap.data_field_config ?? []
                    const labelFieldOptions = [
                      { value: "name", label: "Name" },
                      ...mapDataFields.flatMap((f) =>
                        f.aggregations.map((agg) => ({
                          value: `${f.field}_${agg}`,
                          label: `${f.field} (${agg})`,
                        })),
                      ),
                    ]
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
                                const allOn = hasFill && hasBorder && hasLabels
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
                            {/* Label field checkboxes — shown when labels are on */}
                            {hasLabels && (
                              <div className="mt-0.5 space-y-0.5">
                                {labelFieldOptions.map((opt) => {
                                  const active =
                                    labelFields[layer.id] ?? ["name"]
                                  return (
                                    <label
                                      key={opt.value}
                                      className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-0.5"
                                    >
                                      <Checkbox
                                        checked={active.includes(opt.value)}
                                        onCheckedChange={(checked) => {
                                          setLabelFields((prev) => {
                                            const cur =
                                              prev[layer.id] ?? ["name"]
                                            const next: string[] =
                                              checked === true
                                                ? cur.includes(opt.value)
                                                  ? cur
                                                  : [...cur, opt.value]
                                                : cur.filter(
                                                    (f) => f !== opt.value,
                                                  )
                                            return {
                                              ...prev,
                                              [layer.id]: next,
                                            }
                                          })
                                        }}
                                      />
                                      <span className="text-muted-foreground text-xs">
                                        {opt.label}
                                      </span>
                                    </label>
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
          </SidebarContent>

          <SidebarFooter className="border-border border-t p-4">
            <Button
              variant="ghost"
              className="w-full justify-start"
              onClick={() => {
                logoutMutation.mutate()
              }}
              disabled={logoutMutation.isPending}
            >
              <IconLogout className="mr-2 h-4 w-4" />
              {logoutMutation.isPending ? "Logging out..." : "Logout"}
            </Button>
          </SidebarFooter>
        </Sidebar>
      </PageLayout.SideNav>

      <PageLayout.TopNav>
        <div className="flex w-full items-center gap-4">
          <SidebarTrigger />
          <Input type="search" className="max-w-80" />
        </div>
      </PageLayout.TopNav>

      <PageLayout.FullScreenBody>
        <div className="relative h-full w-full">
          <Map
            ref={mapRef}
            baseMap={baseMap}
            layers={layers}
            currentTool={currentTool}
            onLassoComplete={(geojson) => {
              if (activeLayerId != null) {
                spatialSelectMutation.mutate(
                  { lasso: geojson, layerId: activeLayerId },
                  {
                    onSuccess: (response) => {
                      console.log(
                        mapRef,
                        activeLayerId,
                        selectedNodes,
                        response.nodes,
                      )
                      if (mapRef.current) {
                        updateSelectedFeatureStates(
                          mapRef.current.getMap(),
                          activeLayerId,
                          selectedNodes,
                          response.nodes,
                        )
                        setSelectedNodes(response.nodes)
                      }
                    },
                  },
                )
              }
            }}
            selectedNodes={selectedNodes}
          />

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
                  tool: "lasso",
                  icon: IconLasso,
                  label: "Lasso",
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
        </div>
      </PageLayout.FullScreenBody>
    </PageLayout>
  )
}
