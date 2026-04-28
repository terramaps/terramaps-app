import { useQuery } from "@tanstack/react-query"
import { type PropsWithChildren } from "react"

import { Spinner } from "@/components/ui/spinner"
import { queries } from "@/queries/queries"

import { ActiveMapContext } from "./context"

export { useActiveMap, useLayers } from "./context"

export const ActiveMapProvider = ({
  mapId,
  children,
}: { mapId: string } & PropsWithChildren) => {
  const mapQuery = useQuery(queries.getMap(mapId))
  const layersQuery = useQuery(queries.listLayers(mapId))

  if (mapQuery.isLoading || layersQuery.isLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  if (!mapQuery.data || !layersQuery.data) return null

  return (
    <ActiveMapContext.Provider
      value={{ map: mapQuery.data, layers: layersQuery.data }}
    >
      {children}
    </ActiveMapContext.Provider>
  )
}
