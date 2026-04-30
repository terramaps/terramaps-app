import { IconCheck } from "@tabler/icons-react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useFormik } from "formik"
import * as React from "react"
import { useNavigate, useParams } from "react-router-dom"

import { useMaps } from "@/app/providers/me-provider/context"
import { AppRoutes, PageName } from "@/app/routes"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import { useCreateMapMutation } from "@/queries/mutations"
import { queries } from "@/queries/queries"

import DataStep from "./components/data-step"
import ImportStep from "./components/import-step"
import LayerStep from "./components/layer-step"
import ReviewStep from "./components/review-step"
import type {
  DataField,
  DataFields,
  LayerFields,
  UploadResult,
} from "./initialize"

interface Step {
  id: string
  title: string
  description: string
  component: React.ReactNode
}

export default function InitializePage() {
  const { documentId: urlDocumentId, mapId: urlMapId } = useParams<{
    documentId?: string
    mapId?: string
  }>()

  const [activeStepIdx, setActiveStepIdx] = React.useState<number>(0)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const createMapMutation = useCreateMapMutation()
  const maps = useMaps()
  const hasExistingMaps = maps.length > 0

  // Restore mode: documentId in URL — poll the upload to re-hydrate wizard state
  const isRestoringUpload = !!urlDocumentId
  const uploadRestoreQuery = useQuery({
    ...queries.getUpload(urlDocumentId ?? ""),
    enabled: isRestoringUpload,
  })

  // Processing mode: mapId in URL — poll import_state
  const isProcessingFromUrl = !!urlMapId
  const mapQuery = useQuery({
    ...queries.getMap(urlMapId ?? ""),
    enabled: isProcessingFromUrl,
  })

  const isProcessing = isProcessingFromUrl
  const processingFailed = mapQuery.data?.import_state.status === "failed"
  const processingStep = mapQuery.data?.import_state.step ?? "Queuing…"

  // Navigate to home once import completes
  React.useEffect(() => {
    if (!mapQuery.data) return
    if (mapQuery.data.import_state.status === "complete") {
      void queryClient.invalidateQueries({ queryKey: queries._maps() })
      void navigate(
        AppRoutes.getRoute(PageName.Home, { mapId: urlMapId ?? "" }),
      )
    }
  }, [mapQuery.data, navigate, queryClient, urlMapId])

  const formik = useFormik({
    initialValues: {
      name: "",
      documentId: "",
      headers: [] as string[],
      suggestedLayers: [] as string[],
      previewRows: [] as (string | number | null)[][],
      rowCount: 0,
      layers: [] as LayerFields,
      data_fields: [] as DataFields,
    },
    onSubmit: () => {
      createMapMutation.mutate(
        {
          document_id: formik.values.documentId,
          name: formik.values.name,
          layers: formik.values.layers,
          data_fields: formik.values.data_fields.map((f: DataField) => ({
            name: f.name,
            header: f.header,
            type: f.type,
            aggregations: f.aggregations,
          })),
        },
        {
          onSuccess: (data) => {
            void navigate(
              AppRoutes.getRoute(PageName.InitializeProcessing, {
                mapId: data.id,
              }),
            )
          },
        },
      )
    },
  })

  // Restore wizard state when upload data arrives (refresh on /new/:documentId)
  const formPopulated = React.useRef(false)
  React.useEffect(() => {
    if (!isRestoringUpload || formPopulated.current) return
    if (uploadRestoreQuery.data?.status !== "ready") return
    formPopulated.current = true
    const data = uploadRestoreQuery.data
    void formik.setFieldValue("documentId", data.document_id)
    void formik.setFieldValue("headers", data.headers)
    void formik.setFieldValue("suggestedLayers", data.suggested_layers)
    void formik.setFieldValue("previewRows", data.preview_rows)
    void formik.setFieldValue("rowCount", data.row_count)
    setActiveStepIdx(1)
    // formik is stable; exhaustive-deps would add it but it's safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadRestoreQuery.data, isRestoringUpload])

  const STEPS: Step[] = [
    {
      id: "data-source",
      title: "Data Source",
      description: "Upload your data file",
      component: (
        <ImportStep
          onComplete={(result: UploadResult) => {
            void formik.setFieldValue("documentId", result.documentId)
            void formik.setFieldValue("headers", result.headers)
            void formik.setFieldValue("suggestedLayers", result.suggestedLayers)
            void formik.setFieldValue("previewRows", result.previewRows)
            void formik.setFieldValue("rowCount", result.rowCount)
            void navigate(
              AppRoutes.getRoute(PageName.InitializeUpload, {
                documentId: result.documentId,
              }),
              { replace: true },
            )
            setActiveStepIdx(1)
          }}
        />
      ),
    },
    {
      id: "layer-setup",
      title: "Layer Setup",
      description: "Define geographic layers",
      component: (
        <LayerStep
          headers={formik.values.headers}
          suggestedLayers={formik.values.suggestedLayers}
          onBack={() => {
            setActiveStepIdx(0)
          }}
          onComplete={(layers) => {
            void formik.setFieldValue(
              "layers",
              layers
                .filter((l) => l.enabled)
                .map((l) => ({ name: l.name, header: l.idField })),
            )
            setActiveStepIdx(2)
          }}
        />
      ),
    },
    {
      id: "data",
      title: "Data Fields Setup",
      description: "Set up data fields",
      component: (
        <DataStep
          headers={formik.values.headers}
          layerHeaders={formik.values.layers.map((l) => l.header)}
          onBack={() => {
            setActiveStepIdx(1)
          }}
          onComplete={(dataFields) => {
            void formik.setFieldValue("data_fields", dataFields)
            setActiveStepIdx(3)
          }}
        />
      ),
    },
    {
      id: "review",
      title: "Review & Launch",
      description: "Confirm settings and create project",
      component: (
        <ReviewStep
          name={formik.values.name}
          headers={formik.values.headers}
          rowCount={formik.values.rowCount}
          previewRows={formik.values.previewRows}
          layerFields={formik.values.layers}
          dataFields={formik.values.data_fields}
          isSubmitting={createMapMutation.isPending || createMapMutation.isSuccess}
          onNameChange={(name) => void formik.setFieldValue("name", name)}
          onBack={() => {
            setActiveStepIdx(2)
          }}
          onComplete={() => {
            formik.handleSubmit()
          }}
        />
      ),
    },
  ]

  const activeStep = STEPS[activeStepIdx]

  // ── Restore loading / error states ────────────────────────────────────────

  if (isRestoringUpload && uploadRestoreQuery.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative size-10">
            <div className="absolute inset-0 rounded-full border-4 border-muted" />
            <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin" />
          </div>
          <p className="text-muted-foreground text-sm">Loading upload…</p>
        </div>
      </div>
    )
  }

  if (isRestoringUpload && uploadRestoreQuery.data?.status === "parsing") {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative size-10">
            <div className="absolute inset-0 rounded-full border-4 border-muted" />
            <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin" />
          </div>
          <p className="text-sm font-medium">Parsing spreadsheet…</p>
          <p className="text-muted-foreground text-xs">Almost ready</p>
        </div>
      </div>
    )
  }

  if (
    isRestoringUpload &&
    (uploadRestoreQuery.isError || uploadRestoreQuery.data?.status === "failed")
  ) {
    const reason =
      uploadRestoreQuery.data?.status === "failed"
        ? uploadRestoreQuery.data.error
        : "This upload could not be loaded."
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-6 text-center max-w-sm">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
            <span className="text-destructive text-xl font-bold">!</span>
          </div>
          <div className="space-y-1.5">
            <p className="font-semibold">Upload unavailable</p>
            <p className="text-muted-foreground text-sm">{reason}</p>
          </div>
          <a
            href={AppRoutes.getRoute(PageName.Initialize)}
            className="text-sm text-primary underline underline-offset-4"
          >
            Start a new import
          </a>
        </div>
      </div>
    )
  }

  // ── Main wizard / processing layout ───────────────────────────────────────

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden">
      <header className="border-border flex h-16 shrink-0 items-center gap-4 border-b px-4">
        {hasExistingMaps && (
          <button
            onClick={() => void navigate("/")}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back
          </button>
        )}
        <h1 className="text-lg font-semibold">New Map</h1>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <aside className="border-border shrink-0 border-r">
          <Sidebar collapsible="none">
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupLabel>Progress</SidebarGroupLabel>
                <SidebarGroupContent>
                <div className="space-y-1">
                  {STEPS.map((step, index) => {
                    const isActive = !isProcessing && index === activeStepIdx
                    const isCompleted = isProcessing || index < activeStepIdx
                    const isUpcoming = !isProcessing && index > activeStepIdx
                    return (
                      <div
                        key={step.id}
                        className={cn(
                          "flex items-start gap-3 rounded-lg p-3 transition-colors",
                          isActive && "bg-accent",
                          isCompleted && "text-muted-foreground opacity-60",
                        )}
                      >
                        <div
                          className={cn(
                            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold",
                            isCompleted &&
                              "border-primary bg-primary text-primary-foreground",
                            isActive && "border-primary text-primary",
                            isUpcoming &&
                              "border-muted-foreground/30 text-muted-foreground",
                          )}
                        >
                          {isCompleted ? (
                            <IconCheck className="h-4 w-4" />
                          ) : (
                            index + 1
                          )}
                        </div>
                        <div className="flex-1 space-y-0.5">
                          <div
                            className={cn(
                              "text-sm font-medium leading-tight",
                              isActive && "text-foreground",
                            )}
                          >
                            {step.title}
                          </div>
                          <div
                            className={cn(
                              "text-xs leading-tight",
                              isActive
                                ? "text-muted-foreground"
                                : "text-muted-foreground/70",
                            )}
                          >
                            {step.description}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  {/* Processing step — only visible after map is created */}
                  <div
                    className={cn(
                      "flex items-start gap-3 rounded-lg p-3 transition-colors",
                      isProcessing && !processingFailed && "bg-accent",
                      processingFailed && "text-destructive",
                    )}
                  >
                    <div
                      className={cn(
                        "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold",
                        isProcessing &&
                          !processingFailed &&
                          "border-primary text-primary",
                        !isProcessing &&
                          "border-muted-foreground/30 text-muted-foreground",
                        processingFailed &&
                          "border-destructive text-destructive",
                      )}
                    >
                      {STEPS.length + 1}
                    </div>
                    <div className="flex-1 space-y-0.5">
                      <div
                        className={cn(
                          "text-sm font-medium leading-tight",
                          isProcessing && "text-foreground",
                          !isProcessing && "text-muted-foreground/70",
                        )}
                      >
                        Processing
                      </div>
                      <div className="text-xs leading-tight text-muted-foreground/70">
                        Computing territories
                      </div>
                    </div>
                  </div>
                </div>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
        </aside>
        <main className="flex-1 overflow-hidden">
          <div className="h-full overflow-y-auto">
            {isProcessing ? (
          <div className="flex flex-col items-center justify-center gap-8 py-24 text-center">
            {processingFailed ? (
              <>
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                  <span className="text-destructive text-2xl font-bold">!</span>
                </div>
                <div className="space-y-2">
                  <p className="text-lg font-semibold">Import failed</p>
                  <p className="text-muted-foreground text-sm max-w-sm">
                    {mapQuery.data?.import_state.error ??
                      "An unexpected error occurred."}
                  </p>
                </div>
                <a
                  href={AppRoutes.getRoute(PageName.Initialize)}
                  className="text-sm text-primary underline underline-offset-4"
                >
                  Start a new import
                </a>
              </>
            ) : (
              <>
                <div className="relative size-16">
                  <div className="absolute inset-0 rounded-full border-4 border-muted" />
                  <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin" />
                </div>
                <div className="space-y-2">
                  <p className="text-lg font-semibold">Building your map…</p>
                  <p className="text-muted-foreground text-sm">
                    {processingStep}
                  </p>
                  <p className="text-muted-foreground/60 text-xs">
                    This may take a minute
                  </p>
                </div>
              </>
            )}
          </div>
            ) : (
              activeStep.component
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
