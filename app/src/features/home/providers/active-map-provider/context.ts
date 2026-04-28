import { createContext, useContext } from "react"

import type { components } from "@/lib/api/v1"

type Map = components["schemas"]["Map"]
type Layer = components["schemas"]["Layer"]

export const ActiveMapContext = createContext<{
  map: Map | null
  layers: Layer[] | null
}>({
  map: null,
  layers: null,
})

export const useActiveMap = () => {
  const ctx = useContext(ActiveMapContext)
  if (ctx.map != null) return ctx.map
  throw new Error("useActiveMap must be used within an ActiveMapProvider.")
}

export const useLayers = () => {
  const ctx = useContext(ActiveMapContext)
  if (ctx.layers != null) return ctx.layers
  throw new Error("useLayers must be used within an ActiveMapProvider.")
}
