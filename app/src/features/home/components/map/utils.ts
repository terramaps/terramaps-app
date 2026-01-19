import type * as maplibregl from "maplibre-gl"

import config from "@/app/config"

import {
  BASE_MAP_SOURCES,
  type BaseMapName,
  type LayerViewOptions,
} from "./config"

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

  layers.forEach((layerOption) => {
    const { id, showFill, showOutline, showLabel } = layerOption
    const fillLayerId = `layer-${id.toString()}-fill`
    const outlineLayerId = `layer-${id.toString()}-outline`
    const labelLayerId = `layer-${id.toString()}-label`
    const sourceId = `layer-${id.toString()}`

    // Fill layer
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
            "fill-opacity": [
              "case",
              ["boolean", ["feature-state", "selected"], false],
              1, // Selected opacity
              0.5, // Default opacity
            ],
          },
        },
        undefined,
      )
    } else if (!showFill && fillLayerExists) {
      map.removeLayer(fillLayerId)
    }

    // Outline layer
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
        undefined,
      )
    } else if (!showOutline && outlineLayerExists) {
      map.removeLayer(outlineLayerId)
    }

    // Label layer
    const labelLayerExists = map.getLayer(labelLayerId)
    if (showLabel && !labelLayerExists) {
      map.addLayer(
        {
          id: labelLayerId,
          type: "symbol",
          source: sourceId,
          "source-layer": "nodes",
          layout: {
            "text-field": ["get", "name"],
            "text-size": 12,
          },
          paint: {
            "text-color": "#202020",
          },
        },
        undefined,
      )
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
