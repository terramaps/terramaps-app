import type * as maplibregl from "maplibre-gl"

import config from "@/app/config"

import {
  BASE_MAP_SOURCES,
  type BaseMapName,
  type LayerViewOptions,
} from "./config"

/**
 * Build a MapLibre text-field expression that stacks multiple MVT properties
 * into a single label, one per line.
 *
 * - "name" renders as just the node name (no prefix)
 * - Other keys like "customers_sum" render as "customers (sum): <value>"
 * - Falls back to ["get", "name"] when the list is empty
 */
function buildLabelExpression(
  labelFields: string[],
): maplibregl.ExpressionSpecification {
  const fields = labelFields.length > 0 ? labelFields : ["name"]

  const parts: maplibregl.ExpressionSpecification[] = []
  for (let i = 0; i < fields.length; i++) {
    const key = fields[i]
    if (i > 0) parts.push("\n")
    if (key === "name") {
      parts.push(["get", "name"])
    } else {
      const lastUs = key.lastIndexOf("_")
      const prefix =
        lastUs !== -1
          ? `${key.slice(0, lastUs)} (${key.slice(lastUs + 1)}): `
          : `${key}: `
      parts.push(prefix, ["coalesce", ["to-string", ["get", key]], "—"])
    }
  }

  return parts.length === 1
    ? parts[0]
    : (["concat", ...parts] as maplibregl.ExpressionSpecification)
}

const LABEL_BG_IMAGE = "terriscope-label-bg"

/**
 * Registers a stretchable rounded-rect image with the map (once) that is used
 * as the background box behind label text via icon-text-fit.
 */
function ensureLabelBackground(map: maplibregl.Map): void {
  if (map.hasImage(LABEL_BG_IMAGE)) return

  const w = 24
  const h = 24
  const r = 5

  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (!ctx) return

  // Rounded rectangle
  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.lineTo(w - r, 0)
  ctx.arcTo(w, 0, w, r, r)
  ctx.lineTo(w, h - r)
  ctx.arcTo(w, h, w - r, h, r)
  ctx.lineTo(r, h)
  ctx.arcTo(0, h, 0, h - r, r)
  ctx.lineTo(0, r)
  ctx.arcTo(0, 0, r, 0, r)
  ctx.closePath()

  ctx.fillStyle = "rgba(255, 255, 255, 0.95)"
  ctx.fill()
  ctx.strokeStyle = "rgba(0, 0, 0, 0.15)"
  ctx.lineWidth = 1
  ctx.stroke()

  map.addImage(LABEL_BG_IMAGE, ctx.getImageData(0, 0, w, h), {
    stretchX: [[r, w - r]] as [number, number][],
    stretchY: [[r, h - r]] as [number, number][],
    content: [r, r, w - r, h - r] as [number, number, number, number],
  })
}

export function updateSources(map: maplibregl.Map, layers: LayerViewOptions) {
  // Basemap source
  Object.entries(BASE_MAP_SOURCES).forEach(([name, source]) => {
    const sourceId = `base-map-${name}`
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, source)
    }
  })

  // Basemap layers
  layers.forEach((layerOption) => {
    const { id } = layerOption
    const sourceId = `layer-${id.toString()}`
    const labelSourceId = `layer-${id.toString()}-labels`
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: "vector",
        tiles: [
          `${config.get("api_base_url")}/tiles/${id.toString()}/{z}/{x}/{y}.pbf`,
        ],
        minzoom: 0,
        maxzoom: 14,
      })
    }
    if (!map.getSource(labelSourceId)) {
      map.addSource(labelSourceId, {
        type: "vector",
        tiles: [
          `${config.get("api_base_url")}/tiles/${id.toString()}/{z}/{x}/{y}/labels.pbf`,
        ],
        minzoom: 0,
        maxzoom: 14,
      })
    }
  })
}

export function updateLayers(
  map: maplibregl.Map,
  baseMap: BaseMapName,
  layers: LayerViewOptions,
) {
  Object.keys(BASE_MAP_SOURCES).forEach((name) => {
    const layerId = `base-map-${name}-layer`
    const sourceId = `base-map-${name}`
    const isActive = baseMap == name
    const isInLayers = map.getLayer(layerId)
    if (isActive && !isInLayers) {
      map.addLayer(
        {
          id: layerId,
          type: "raster",
          source: sourceId,
        },
        undefined,
      )
    } else if (!isActive && isInLayers) {
      map.removeLayer(layerId)
    }
  })

  ensureLabelBackground(map)

  layers.forEach((layerOption) => {
    const { id, showFill, showOutline, showLabel, labelFields } = layerOption
    const fillLayerId = `layer-${id.toString()}-fill`
    const selectionLayerId = `layer-${id.toString()}-selection`
    const outlineLayerId = `layer-${id.toString()}-outline`
    const labelLayerId = `layer-${id.toString()}-label`
    const sourceId = `layer-${id.toString()}`
    const labelSourceId = `layer-${id.toString()}-labels`

    // Fill layer — inserted below the selection layer so selection always renders on top
    const fillLayerExists = map.getLayer(fillLayerId)
    if (showFill && !fillLayerExists) {
      map.addLayer(
        {
          id: fillLayerId,
          type: "fill",
          source: sourceId,
          "source-layer": "nodes",
          paint: {
            "fill-color": "#888888",
            "fill-opacity": 0.4,
          },
        },
        map.getLayer(selectionLayerId) ? selectionLayerId : undefined,
      )
    } else if (!showFill && fillLayerExists) {
      map.removeLayer(fillLayerId)
    }

    // Selection highlight — always present, transparent until features are selected.
    // This ensures lasso feedback is visible regardless of which layer has fill enabled.
    if (!map.getLayer(selectionLayerId)) {
      map.addLayer(
        {
          id: selectionLayerId,
          type: "fill",
          source: sourceId,
          "source-layer": "nodes",
          paint: {
            "fill-color": "#2563eb",
            "fill-opacity": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              0.5,
              0,
            ],
          },
        },
        map.getLayer(outlineLayerId) ? outlineLayerId : undefined,
      )
    }

    // Outline layer — inserted below the label layer
    const outlineLayerExists = map.getLayer(outlineLayerId)
    if (showOutline && !outlineLayerExists) {
      map.addLayer(
        {
          id: outlineLayerId,
          type: "line",
          source: sourceId,
          "source-layer": "nodes",
          paint: {
            "line-color": "#000000",
            "line-width": 2,
          },
        },
        map.getLayer(labelLayerId) ? labelLayerId : undefined,
      )
    } else if (!showOutline && outlineLayerExists) {
      map.removeLayer(outlineLayerId)
    }

    // Label layer — always on top
    const labelLayerExists = map.getLayer(labelLayerId)
    const textFieldExpr = buildLabelExpression(labelFields)
    if (showLabel && !labelLayerExists) {
      map.addLayer(
        {
          id: labelLayerId,
          type: "symbol",
          source: labelSourceId,
          "source-layer": "nodes",
          layout: {
            "icon-image": LABEL_BG_IMAGE,
            "icon-text-fit": "both",
            "icon-text-fit-padding": [5, 10, 5, 10],
            "text-field": textFieldExpr,
            "text-size": ["interpolate", ["linear"], ["zoom"], 4, 11, 10, 14],
            "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
            "text-max-width": 20,
            "text-line-height": 1.5,
            "text-justify": "left",
          },
          paint: {
            "text-color": "#111111",
          },
        },
        undefined,
      )
    } else if (showLabel && labelLayerExists) {
      map.setLayoutProperty(labelLayerId, "text-field", textFieldExpr)
    } else if (!showLabel && labelLayerExists) {
      map.removeLayer(labelLayerId)
    }
  })
}

export function updateSelectedFeatureStates(
  map: maplibregl.Map,
  layerId: number,
  previousSelection: number[],
  newSelection: number[],
) {
  const sourceId = `layer-${layerId.toString()}`
  const prevSet = new Set(previousSelection)
  const newSet = new Set(newSelection)

  // Clear features no longer selected
  previousSelection.forEach((nodeId) => {
    if (!newSet.has(nodeId)) {
      map.setFeatureState(
        { source: sourceId, sourceLayer: "nodes", id: nodeId },
        { selected: false },
      )
    }
  })

  // Add newly selected features
  newSelection.forEach((nodeId) => {
    if (!prevSet.has(nodeId)) {
      map.setFeatureState(
        { source: sourceId, sourceLayer: "nodes", id: nodeId },
        { selected: true },
      )
    }
  })
}
