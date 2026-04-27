import { queryOptions } from "@tanstack/react-query"

import config from "@/app/config"
import { fetchClient } from "@/fetch-client"
import type { components } from "@/lib/api/v1"

type NodeQuery = components["schemas"]["NodeQuery"]
type ZipQuery = components["schemas"]["ZipQuery"]

// Local type for upload status — replace with generated path type after openapi:generate
type UploadStatusData =
  | { document_id: string; status: "parsing" }
  | {
      document_id: string
      status: "ready"
      headers: string[]
      suggested_layers: string[]
      preview_rows: (string | number | null)[][]
      row_count: number
      warnings: string[]
    }
  | {
      document_id: string
      status: "failed"
      error: string
      error_reason?: string | null
    }

const ACTIVE_JOB_STATUSES = new Set(["pending", "processing", "failed"])

function isMapLoading(
  data:
    | {
        active_job?: { status: string } | null
        import_state?: { status: string } | null
      }
    | undefined,
): boolean {
  if (data?.active_job && ACTIVE_JOB_STATUSES.has(data.active_job.status))
    return true
  if (data?.import_state?.status === "importing") return true
  return false
}

export const queries = {
  _root: () => [],
  _layers: () => ["layers"],
  _nodes: () => ["nodes"],
  _uploads: () => ["uploads"],
  _me: () => [...queries._root(), "me"],
  _maps: () => [...queries._root(), "maps"],
  me: () =>
    queryOptions({
      queryKey: [...queries._me()],
      queryFn: async () => {
        const response = await fetchClient.GET("/me")
        if (!response.data || response.response.status !== 200) {
          throw new Error("Failed to fetch user data")
        }
        return response.data
      },
    }),
  listLayers: (mapId: string) =>
    queryOptions({
      queryKey: [...queries._layers(), "list", { mapId }],
      queryFn: async () => {
        const response = await fetchClient.GET("/layers", {
          params: { query: { map_id: mapId } },
        })
        if (!response.data || response.response.status !== 200) {
          throw new Error("Failed to fetch layers")
        }
        return response.data
      },
    }),
  queryNodes: (body: NodeQuery, page = 1, pageSize = 50) =>
    queryOptions({
      queryKey: [...queries._nodes(), "query", { body, page, pageSize }],
      queryFn: async () => {
        const response = await fetchClient.POST("/nodes/query", {
          body,
          params: { query: { page, page_size: pageSize } },
        })
        if (!response.data || response.response.status !== 200) {
          throw new Error("Failed to query nodes")
        }
        return response.data
      },
    }),
  listMaps: () =>
    queryOptions({
      queryKey: [...queries._maps(), "list"],
      queryFn: async () => {
        const response = await fetchClient.GET("/maps")
        if (!response.data || response.response.status !== 200) {
          throw new Error("Failed to fetch maps")
        }
        return response.data
      },
    }),
  getMap: (mapId: string) =>
    queryOptions({
      queryKey: [...queries._maps(), "detail", mapId],
      queryFn: async () => {
        const response = await fetchClient.GET("/maps/{map_id}", {
          params: { path: { map_id: mapId } },
        })
        if (!response.data || response.response.status !== 200) {
          throw new Error("Failed to fetch map")
        }
        return response.data
      },
      refetchInterval: (query) =>
        isMapLoading(query.state.data) ? 2000 : false,
    }),
  getUpload: (documentId: string) =>
    queryOptions({
      queryKey: [...queries._uploads(), documentId],
      queryFn: async () => {
        const baseUrl = config.get("api_base_url")
        const response = await fetch(`${baseUrl}/maps/uploads/${documentId}`, {
          credentials: "include",
        })
        if (!response.ok) {
          throw new Error("Failed to fetch upload status")
        }
        return response.json() as Promise<UploadStatusData>
      },
      refetchInterval: (query) =>
        query.state.data?.status === "parsing" ? 2000 : false,
    }),
  searchMap: (mapId: string, q: string) =>
    queryOptions({
      queryKey: [...queries._root(), "search", { mapId, q }],
      queryFn: async () => {
        const response = await fetchClient.GET("/search", {
          params: { query: { map_id: mapId, q } },
        })
        if (!response.data || response.response.status !== 200) {
          throw new Error("Failed to search map")
        }
        return response.data
      },
      enabled: q.trim().length > 0,
    }),
  getNode: (nodeId: number) =>
    queryOptions({
      queryKey: [...queries._nodes(), "detail", nodeId],
      queryFn: async () => {
        const response = await fetchClient.GET("/nodes/{node_id}", {
          params: { path: { node_id: nodeId } },
        })
        if (!response.data || response.response.status !== 200) {
          throw new Error("Failed to fetch node")
        }
        return response.data
      },
    }),
  queryZipAssignments: (body: ZipQuery, page = 1, pageSize = 50) =>
    queryOptions({
      queryKey: [...queries._nodes(), "zip-query", { body, page, pageSize }],
      queryFn: async () => {
        const response = await fetchClient.POST("/zip-assignments/query", {
          body,
          params: { query: { page, page_size: pageSize } },
        })
        if (!response.data || response.response.status !== 200) {
          throw new Error("Failed to query zip assignments")
        }
        return response.data
      },
    }),
  getZipAssignment: (layerId: number, zipCode: string) =>
    queryOptions({
      queryKey: [...queries._root(), "zip-assignment", { layerId, zipCode }],
      queryFn: async () => {
        const response = await fetchClient.GET(
          "/zip-assignments/{layer_id}/{zip_code}/geography",
          { params: { path: { layer_id: layerId, zip_code: zipCode } } },
        )
        if (!response.data || response.response.status !== 200) {
          throw new Error("Failed to fetch zip assignment")
        }
        return response.data
      },
    }),
}
