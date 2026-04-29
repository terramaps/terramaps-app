import { IconCheck, IconLoader2, IconPresentation } from "@tabler/icons-react"
import type { Map as MaplibreMap } from "maplibre-gl"
import { type RefObject, useState } from "react"
import type { MapRef } from "react-map-gl/maplibre"
import { useSearchParams } from "react-router-dom"

import config from "@/app/config"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import type { BaseMapName, LayerViewOptions } from "./map/config"
import { updateLayers } from "./map/utils"

interface ExportPptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mapId: string
  mapName: string
  mapRef: RefObject<MapRef | null>
  layers: LayerViewOptions
  baseMap: BaseMapName
}

type State = "idle" | "running" | "done" | "error"

interface SlideProgress {
  order: number
  title: string
  uploaded: number
  total: number
}

function navigateAndWait(
  map: MaplibreMap,
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number,
): Promise<void> {
  return new Promise((resolve) => {
    map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
      padding: 60,
      duration: 800,
      maxZoom: 12,
    })
    // After a frame, check whether the map is still moving before waiting for idle.
    // If it's already settled (same bbox), resolve immediately.
    requestAnimationFrame(() => {
      if (map.isMoving() || map.isZooming() || !map.loaded()) {
        map.once("idle", resolve)
      } else {
        resolve()
      }
    })
  })
}

function captureCanvas(map: MaplibreMap): Promise<Blob> {
  return new Promise((resolve, reject) => {
    map.getCanvas().toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Canvas capture failed")),
      "image/png",
    )
  })
}

export function ExportPptDialog({
  open,
  onOpenChange,
  mapId,
  mapRef,
  layers,
  baseMap,
}: ExportPptDialogProps) {
  const [state, setState] = useState<State>("idle")
  const [slide, setSlide] = useState<SlideProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, setSearchParams] = useSearchParams()

  const clearExportParam = () => {
    setSearchParams((prev) => {
      prev.delete("exportId")
      return prev
    })
  }

  const reset = () => {
    setState("idle")
    setSlide(null)
    setError(null)
    clearExportParam()
  }

  const handleExport = async () => {
    setState("running")
    setError(null)
    setSlide(null)

    try {
      const base = config.get("api_base_url")

      const createRes = await fetch(`${base}/maps/${mapId}/exports/ppt`, {
        method: "POST",
        credentials: "include",
      })
      if (!createRes.ok) {
        throw new Error(`Failed to start export (${createRes.status})`)
      }
      const { id: exportId, total_slides: totalSlides } =
        (await createRes.json()) as { id: string; total_slides: number }

      // Persist exportId in the URL so it survives a refresh
      setSearchParams((prev) => {
        prev.set("exportId", exportId)
        return prev
      })

      while (true) {
        const nextRes = await fetch(
          `${base}/maps/${mapId}/exports/ppt/${exportId}/next`,
          { credentials: "include" },
        )
        if (!nextRes.ok) {
          throw new Error(`Failed to get next slide (${nextRes.status})`)
        }
        const next = (await nextRes.json()) as {
          done: boolean
          slide_id: number
          order: number
          title: string
          layer_id: number
          parent_node_id: number | null
          uploaded_slides: number
          total_slides: number
          bbox_min_lng: number
          bbox_min_lat: number
          bbox_max_lng: number
          bbox_max_lat: number
        }

        if (next.done) break

        setSlide({
          order: next.order,
          title: next.title,
          uploaded: next.uploaded_slides,
          total: totalSlides,
        })

        // Navigate map to this slide's bbox and wait for tiles to load
        const map = mapRef.current?.getMap()
        if (map) {
          // Show only the slide's layer (fill + outline + label), hide all others
          updateLayers(
            map,
            baseMap,
            layers.map((l) => ({
              ...l,
              showFill: l.id === next.layer_id,
              showOutline: l.id === next.layer_id,
              showLabel: l.id === next.layer_id,
            })),
          )

          // For node slides, dim siblings that aren't children of this parent
          if (next.parent_node_id !== null) {
            const fillId = `layer-${next.layer_id.toString()}-fill`
            if (map.getLayer(fillId)) {
              map.setPaintProperty(fillId, "fill-color", [
                "case",
                ["==", ["get", "parent_node_id"], next.parent_node_id],
                ["coalesce", ["get", "color"], "#888888"],
                "#e5e7eb",
              ])
            }
          }

          await navigateAndWait(
            map,
            next.bbox_min_lng,
            next.bbox_min_lat,
            next.bbox_max_lng,
            next.bbox_max_lat,
          )
        }

        // Capture the actual map canvas
        const blob = map
          ? await captureCanvas(map)
          : await fallbackBlob()

        const formData = new FormData()
        formData.append("image", blob, "screenshot.png")

        const uploadRes = await fetch(
          `${base}/maps/${mapId}/exports/ppt/${exportId}/slides/${next.slide_id}`,
          { method: "POST", credentials: "include", body: formData },
        )
        if (!uploadRes.ok) {
          throw new Error(
            `Failed to upload slide ${next.order + 1} (${uploadRes.status})`,
          )
        }
      }

      setState("done")
      setSlide((prev) => (prev ? { ...prev, uploaded: totalSlides } : null))
      clearExportParam()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
      setState("error")
      clearExportParam()
    }
  }

  const progressPct =
    slide && slide.total > 0 ? (slide.uploaded / slide.total) * 100 : 0

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <IconPresentation className="h-4 w-4" />
            </div>
            <DialogTitle>Territory Report</DialogTitle>
          </div>
          <DialogDescription>
            Captures a map screenshot for each territory group and assembles a
            PowerPoint slide deck — one slide per layer and per territory.
          </DialogDescription>
        </DialogHeader>

        {state === "idle" && (
          <div className="rounded-lg border bg-muted/30 p-3.5 text-sm text-muted-foreground leading-relaxed">
            The export steps through every layer and territory, flying the map
            to the correct bounds and capturing a screenshot before moving on.
            Large maps may take a minute or two.
          </div>
        )}

        {(state === "running" || state === "done") && slide && (
          <div className="space-y-3">
            <Progress
              value={state === "done" ? 100 : progressPct}
              className="h-2"
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {state === "done" ? slide.total : slide.uploaded} of{" "}
                {slide.total} slides
              </span>
              {state === "running" && (
                <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              {state === "done" && (
                <IconCheck className="h-3.5 w-3.5 text-green-500" />
              )}
            </div>
            <div className="rounded-lg border bg-muted/30 px-3.5 py-3">
              <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {state === "done" ? "Last slide" : "Capturing"}
              </p>
              <p className="text-sm font-medium leading-snug">{slide.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Slide {slide.order + 1} of {slide.total}
              </p>
            </div>
          </div>
        )}

        {state === "done" && (
          <p className="text-sm text-muted-foreground">
            All slides captured.{" "}
            <span className="text-muted-foreground/60">
              (PPT generation coming soon)
            </span>
          </p>
        )}

        {state === "error" && error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        <DialogFooter>
          {state === "idle" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleExport()}>Start Export</Button>
            </>
          )}
          {state === "running" && (
            <Button variant="outline" disabled>
              <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
              Running…
            </Button>
          )}
          {(state === "done" || state === "error") && (
            <>
              {state === "error" && (
                <Button variant="outline" onClick={reset}>
                  Try Again
                </Button>
              )}
              <Button
                onClick={() => {
                  reset()
                  onOpenChange(false)
                }}
              >
                {state === "done" ? "Done" : "Close"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// 1x1 grey PNG fallback if the map ref isn't available
function fallbackBlob(): Promise<Blob> {
  const canvas = document.createElement("canvas")
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "#94a3b8"
  ctx.fillRect(0, 0, 1, 1)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("canvas.toBlob failed")),
      "image/png",
    )
  })
}
