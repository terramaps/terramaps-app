import type * as maplibregl from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"

export type LayerViewOption = {
  id: number
  showFill: boolean
  showOutline: boolean
  showLabel: boolean
  /** Ordered list of MVT property keys to stack in the map label. Defaults to ["name"]. */
  labelFields: string[]
}

export type LayerViewOptions = LayerViewOption[]

export type BaseMapName = "osm" | "satellite" | "terrain"
export const BASE_MAP_SOURCES: Record<
  BaseMapName,
  maplibregl.SourceSpecification
> = {
  osm: {
    type: "raster",
    tileSize: 256,
    tiles: [
      "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
    ],
  },
  satellite: {
    type: "raster",
    tileSize: 256,
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
  },
  terrain: {
    type: "raster",
    tileSize: 256,
    tiles: [
      "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
      "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
      "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
    ],
  },
}
