import { polygon } from "@turf/helpers"
import { simplify } from "@turf/simplify"
import type { Feature, Polygon } from "geojson"
import "maplibre-gl/dist/maplibre-gl.css"
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react"
import MapGL, { type MapProps, type MapRef } from "react-map-gl/maplibre"

import type { LayerViewOptions } from "./config"
import type { BaseMapName } from "./config"
import { refreshTileSources, updateLayers, updateSources } from "./utils"

const EMPTY_STYLE = {
  version: 8 as const,
  glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
  sources: {},
  layers: [],
}

const INITIAL_VIEW_STATE: MapProps["initialViewState"] = {
  longitude: -98.5795,
  latitude: 39.8283,
  zoom: 4,
}

export type HoverHierarchyItem = {
  layerId: number
  name: string
  nodeId?: number
  zipCode?: string
  /** Flat numeric tile properties for this feature (e.g. { customers_sum: 1200 }). */
  data?: Record<string, number | null>
}

export type ClickSelectResult = { nodeId: number } | { zipCode: string }

export const Map = forwardRef<
  MapRef | null,
  {
    baseMap: BaseMapName
    layers: LayerViewOptions
    currentTool: "select" | "pan"
    activeLayerId: number | undefined
    selectedNodeIds: number[]
    selectedZipCodes: string[]
    tileVersion: number
    onLassoComplete: (points: Polygon, additive: boolean) => void
    onClickSelect: (result: ClickSelectResult, additive: boolean) => void
    onHover?: (items: HoverHierarchyItem[]) => void
    onHoverEnd?: () => void
  }
>(
  (
    {
      baseMap,
      layers,
      onLassoComplete,
      onClickSelect,
      currentTool,
      activeLayerId,
      tileVersion,
      onHover,
      onHoverEnd,
    },
    ref,
  ) => {
    const mapRef = useRef<MapRef | null>(null)
    useImperativeHandle(ref, () => mapRef.current as MapRef)

    useEffect(() => {
      const map = mapRef.current?.getMap()
      if (map && map.isStyleLoaded()) {
        updateSources(map, layers, tileVersion)
        updateLayers(map, baseMap, layers)
      }
    }, [baseMap, layers, tileVersion])

    // When tileVersion increments (after a recompute completes), flush MapLibre's
    // tile cache by updating the source URLs with a new cache-busting parameter.
    const isFirstTileVersionRender = useRef(true)
    const layersRef = useRef(layers)
    useEffect(() => {
      layersRef.current = layers
    }, [layers])
    useEffect(() => {
      if (isFirstTileVersionRender.current) {
        isFirstTileVersionRender.current = false
        return
      }
      const map = mapRef.current?.getMap()
      if (!map || !map.isStyleLoaded()) return
      refreshTileSources(map, layersRef.current, tileVersion)
    }, [tileVersion])

    const [isDrawing, setIsDrawing] = useState(false)
    const [lassoPoints, setLassoPoints] = useState<[number, number][]>([])
    const mouseDownPixel = useRef<{ x: number; y: number } | null>(null)

    // Update lasso visualization as it's being drawn
    useEffect(() => {
      const map = mapRef.current?.getMap()
      if (!map || !map.isStyleLoaded()) return

      const sourceId = "lasso-line"
      const layerId = "lasso-line-layer"

      // If we have points, show the lasso
      if (lassoPoints.length > 0) {
        const geojson = {
          type: "FeatureCollection" as const,
          features: [
            {
              type: "Feature" as const,
              properties: {},
              geometry: {
                type: "LineString" as const,
                coordinates: lassoPoints,
              },
            },
          ],
        }

        // Add or update source
        const source = map.getSource(sourceId)
        if (source && source.type === "geojson") {
          ;(source as maplibregl.GeoJSONSource).setData(geojson)
        } else {
          map.addSource(sourceId, {
            type: "geojson",
            data: geojson,
          })
        }

        // Add layer if it doesn't exist
        if (!map.getLayer(layerId)) {
          map.addLayer({
            id: layerId,
            type: "line",
            source: sourceId,
            paint: {
              "line-color": "#3b82f6",
              "line-width": 2,
              "line-dasharray": [2, 2],
            },
          })
        }
      } else {
        // Clear the lasso visualization
        if (map.getLayer(layerId)) {
          map.removeLayer(layerId)
        }
        if (map.getSource(sourceId)) {
          map.removeSource(sourceId)
        }
      }
    }, [lassoPoints])

    // Mouse DOWN - start the select/lasso
    const handleMouseDown = (e: maplibregl.MapMouseEvent) => {
      if (currentTool === "select") {
        e.preventDefault()
        mouseDownPixel.current = { x: e.point.x, y: e.point.y }
        setIsDrawing(true)
        const point: [number, number] = [e.lngLat.lng, e.lngLat.lat]
        setLassoPoints([point])
      }
    }

    // Mouse MOVE - only adds points while drawing (button held)
    const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
      if (isDrawing && currentTool === "select") {
        const point: [number, number] = [e.lngLat.lng, e.lngLat.lat]
        const newPoints = [...lassoPoints, point]
        setLassoPoints(newPoints)
        return
      }

      if (onHover) {
        const map = mapRef.current?.getMap()
        if (!map) return
        const currentLayers = layersRef.current
        const selectionLayerIds = currentLayers
          .map((l) => `layer-${l.id.toString()}-selection`)
          .filter((id) => map.getLayer(id))
        const features = map.queryRenderedFeatures(e.point, {
          layers: selectionLayerIds,
        })
        const seen = new Set<number>()
        const items: HoverHierarchyItem[] = []
        for (const feature of features) {
          const match = /^layer-(\d+)-selection$/.exec(feature.layer.id)
          if (!match) continue
          const layerId = parseInt(match[1])
          if (seen.has(layerId)) continue
          seen.add(layerId)
          const layerOption = currentLayers.find((l) => l.id === layerId)
          const isZip = layerOption?.order === 0
          const zipCode = isZip
            ? (feature.properties.zip_code as string | undefined)
            : undefined
          const nodeId = !isZip ? (feature.id as number | undefined) : undefined
          const name = isZip
            ? (zipCode ?? "")
            : ((feature.properties.name as string | undefined) ?? "")

          const data: Record<string, number | null> = {}
          for (const [k, v] of Object.entries(feature.properties)) {
            if (typeof v === "number") data[k] = v
            else if (v === null) data[k] = null
          }

          if (name) items.push({ layerId, name, nodeId, zipCode, data })
        }
        onHover(items)
      }
    }

    // Mouse UP - click = single select, drag = lasso
    const handleMouseUp = (e: maplibregl.MapMouseEvent) => {
      if (isDrawing && currentTool === "select") {
        setIsDrawing(false)

        const down = mouseDownPixel.current
        const dx = down ? e.point.x - down.x : 999
        const dy = down ? e.point.y - down.y : 999
        mouseDownPixel.current = null

        const additive = e.originalEvent.shiftKey

        if (Math.sqrt(dx * dx + dy * dy) < 5) {
          // Click — single select via point query
          setLassoPoints([])
          const map = mapRef.current?.getMap()
          if (!map || activeLayerId == null) return
          const selectionLayerId = `layer-${activeLayerId}-selection`
          if (!map.getLayer(selectionLayerId)) return
          const features = map.queryRenderedFeatures(e.point, {
            layers: [selectionLayerId],
          })
          if (features.length === 0) return
          const feature = features[0]
          const layerOption = layers.find((l) => l.id === activeLayerId)
          if (layerOption?.order === 0) {
            const zipCode = feature.properties?.zip_code as string | undefined
            if (zipCode) onClickSelect({ zipCode }, additive)
          } else {
            const nodeId = feature.id as number | undefined
            if (nodeId != null) onClickSelect({ nodeId }, additive)
          }
        } else {
          // Drag — lasso polygon
          const closedPoints: number[][] = [...lassoPoints, lassoPoints[0]]
          const lassoPolygon = polygon([closedPoints])
          const simplified = simplify<Feature<Polygon>>(lassoPolygon, {
            tolerance: 0.001,
            highQuality: true,
          })
          onLassoComplete(simplified.geometry, additive)
          setLassoPoints([])
        }
      }
    }

    return (
      <div className={`relative h-full w-full`}>
        <MapGL
          dragPan={currentTool === "pan"}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseOut={onHoverEnd}
          cursor={currentTool === "select" ? "crosshair" : "grab"}
          initialViewState={INITIAL_VIEW_STATE}
          mapStyle={EMPTY_STYLE}
          minZoom={4}
          maxZoom={10}
          ref={mapRef}
          onLoad={(evt) => {
            const map = evt.target
            updateSources(map, layers, tileVersion)
            updateLayers(map, baseMap, layers)
          }}
          style={{ width: "100%", height: "100%" }}
          attributionControl={false}
          maxParallelImageRequests={6}
        />
      </div>
    )
  },
)
