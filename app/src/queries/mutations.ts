import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { Polygon } from "geojson"
import type { FetchResponse } from "openapi-fetch"

import config from "@/app/config"
import { fetchClient } from "@/fetch-client"
import type { components, paths } from "@/lib/api/v1"

import { queries } from "./queries"

export const useUploadSpreadsheetMutation = () => {
  return useMutation({
    mutationFn: async (vars: { file: File; tabIndex: number }) => {
      const formData = new FormData()
      formData.append("file", vars.file)
      formData.append("tab_index", String(vars.tabIndex))

      const baseUrl = config.get("api_base_url")
      const response = await fetch(`${baseUrl}/maps/uploads`, {
        method: "POST",
        body: formData,
        credentials: "include",
      })
      if (!response.ok) {
        throw new Error("Upload failed")
      }
      return response.json() as Promise<{
        document_id: string
        status: "parsing"
      }>
    },
  })
}

export const useCreateMapMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (variables: {
      document_id: string
      name: string
      layers: { name: string; header: string }[]
      data_fields: {
        name: string
        header: string
        type: "text" | "number"
        aggregations: ("sum" | "avg")[]
      }[]
    }) => {
      const response = await fetchClient.POST("/maps", {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        body: variables as any,
      })
      if (
        !response.data ||
        (response.response.status !== 200 && response.response.status !== 202)
      ) {
        throw new Error("Failed to create map")
      }
      return response.data
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queries.getMap(data.id).queryKey, data)
      void queryClient.invalidateQueries({ queryKey: queries._maps() })
    },
  })
}

export const useLoginMutation = (options?: {
  onSuccess?: (
    response: FetchResponse<
      paths["/auth/login"]["post"],
      "json",
      "application/json"
    >["data"],
  ) => void
  onError?: (error: Error) => void
}) => {
  return useMutation({
    mutationFn: async (variables: {
      email: string
      password: string
      remember_me?: boolean
    }) => {
      const response = await fetchClient.POST("/auth/login", {
        body: {
          email: variables.email,
          password: variables.password,
          remember_me: variables.remember_me ?? false,
        },
      })
      if (response.response.status !== 200 || response.data == null) {
        throw new Error("Invalid email or password")
      }
      return response.data
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  })
}

export const useRegisterMutation = (options?: {
  onSuccess?: (
    response: FetchResponse<
      paths["/auth/register"]["post"],
      "json",
      "application/json"
    >["data"],
  ) => void
  onError?: (error: Error) => void
}) => {
  return useMutation({
    mutationFn: async (variables: { email: string; password: string }) => {
      const response = await fetchClient.POST("/auth/register", {
        body: {
          email: variables.email,
          password: variables.password,
        },
      })
      if (response.response.status !== 201 || response.data == null) {
        throw new Error("Registration failed")
      }
      return response.data
    },
    onSuccess: options?.onSuccess,
    onError: options?.onError,
  })
}

export const useLogoutMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    retry: 3,
    mutationFn: async () => {
      const response = await fetchClient.POST("/auth/logout")
      if (response.response.status !== 200) {
        throw new Error("Logout failed")
      }
    },
    onSuccess: () => {
      void queryClient.resetQueries()
    },
  })
}

// ---------------------------------------------------------------------------
// Bulk node / zip operations (Move, Merge, Delete, Unassign)
// ---------------------------------------------------------------------------

export const useBulkAssignZipsMutation = () => {
  return useMutation({
    mutationFn: async (vars: {
      layerId: number
      zipCodes: string[]
      parentNodeId: number | null
      color?: string | null
    }) => {
      const response = await fetchClient.PUT(
        "/zip-assignments/{layer_id}/bulk",
        {
          params: { path: { layer_id: vars.layerId } },
          body: {
            zip_codes: vars.zipCodes,
            parent_node_id: vars.parentNodeId,
            color: vars.color ?? null,
          },
        },
      )
      if (response.response.status !== 200 || !response.data) {
        throw new Error("Failed to update zip assignments")
      }
      return response.data
    },
  })
}

export const useMoveNodesMutation = () => {
  return useMutation({
    mutationFn: async (vars: {
      nodeIds: number[]
      parentNodeId: number | null
    }) => {
      const response = await fetchClient.PUT("/nodes/bulk/reparent", {
        body: {
          node_ids: vars.nodeIds,
          parent_node_id: vars.parentNodeId,
        },
      })
      if (response.response.status !== 200 || !response.data) {
        throw new Error("Failed to move nodes")
      }
      return response.data
    },
  })
}

export const useCreateNodeMutation = () => {
  return useMutation({
    mutationFn: async (vars: {
      layerId: number
      name: string
      color: string
      parentNodeId: number | null
    }) => {
      const response = await fetchClient.POST("/nodes", {
        body: {
          layer_id: vars.layerId,
          name: vars.name,
          color: vars.color,
          parent_node_id: vars.parentNodeId,
        },
      })
      if (response.response.status !== 200 || !response.data) {
        throw new Error("Failed to create node")
      }
      return response.data
    },
  })
}

export const useMergeNodesMutation = () => {
  return useMutation({
    mutationFn: async (vars: {
      nodeIds: number[]
      name: string
      parentNodeId: number | null
    }) => {
      const response = await fetchClient.POST("/nodes/merge", {
        body: {
          node_ids: vars.nodeIds,
          name: vars.name,
          parent_node_id: vars.parentNodeId,
        },
      })
      if (response.response.status !== 200 || !response.data) {
        throw new Error("Failed to merge nodes")
      }
      return response.data
    },
  })
}

export const useBulkDeleteNodesMutation = () => {
  return useMutation({
    mutationFn: async (
      vars:
        | { nodeIds: number[]; childAction: "orphan" }
        | {
            nodeIds: number[]
            childAction: "reparent"
            reparentNodeId: number
          },
    ) => {
      const response = await fetchClient.DELETE("/nodes/bulk", {
        body:
          vars.childAction === "reparent"
            ? {
                node_ids: vars.nodeIds,
                child_action: "reparent",
                reparent_node_id: vars.reparentNodeId,
              }
            : {
                node_ids: vars.nodeIds,
                child_action: "orphan",
                reparent_node_id: null,
              },
      })
      if (response.response.status !== 204) {
        throw new Error("Failed to delete nodes")
      }
    },
  })
}

export const useUpdateNodeMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (vars: {
      nodeId: number
      mapId: string
      name: string
      color: string
      parentNodeId: number | null
    }) => {
      const response = await fetchClient.PUT("/nodes/{node_id}", {
        params: { path: { node_id: vars.nodeId } },
        body: {
          name: vars.name,
          color: vars.color,
          parent_node_id: vars.parentNodeId,
        },
      })
      if (response.response.status !== 200 || !response.data) {
        throw new Error("Failed to update node")
      }
      return { ...response.data, mapId: vars.mapId }
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queries.getNode(data.id).queryKey, data)
      void queryClient.invalidateQueries({ queryKey: queries._nodes() })
      void queryClient.invalidateQueries({
        queryKey: queries.getMap(data.mapId).queryKey,
      })
    },
  })
}

export const useUpdateMeMutation = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (vars: {
      name: string | null
      avatar_url: string | null
    }) => {
      const response = await fetchClient.PATCH("/me", {
        body: { name: vars.name, avatar_url: vars.avatar_url },
      })
      if (response.response.status !== 200 || !response.data) {
        throw new Error("Failed to update profile")
      }
      return response.data
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queries.me().queryKey, data)
    },
  })
}

export const useRequestPasswordResetMutation = () => {
  return useMutation({
    mutationFn: async () => {
      const response = await fetchClient.POST("/me/request-password-reset")
      if (response.response.status !== 202) {
        throw new Error("Failed to send password reset email")
      }
    },
  })
}

export const useSpatialSelectMutation = () => {
  return useMutation({
    mutationFn: async (vars: { layerId: number; lasso: Polygon }) => {
      const response = await fetchClient.POST("/spatial/select", {
        body: {
          layer_id: vars.layerId,
          polygon:
            vars.lasso as components["schemas"]["SpatialSelectRequest"]["polygon"],
        },
      })
      if (response.response.status !== 200 || !response.data) {
        throw new Error("Unknown error.")
      }
      return response.data
    },
  })
}
