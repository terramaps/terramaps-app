import { IconArrowRight, IconFileSpreadsheet } from "@tabler/icons-react"
import { useState } from "react"

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
import type { components } from "@/lib/api/v1"

type Layer = components["schemas"]["Layer"]

interface ExportZttDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mapId: string
  mapName: string
  layers: Layer[]
}

export function ExportZttDialog({
  open,
  onOpenChange,
  mapId,
  mapName,
  layers,
}: ExportZttDialogProps) {
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sortedLayers = [...layers].sort((a, b) => a.order - b.order)

  const handleExport = async () => {
    setIsExporting(true)
    setError(null)
    try {
      const baseUrl = config.get("api_base_url")
      const response = await fetch(`${baseUrl}/maps/${mapId}/export/ztt`, {
        credentials: "include",
      })
      if (!response.ok) {
        throw new Error(`Export failed (${response.status})`)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `${mapName.replace(/\s+/g, "_").toLowerCase()}_ztt.xlsx`
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(url)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <IconFileSpreadsheet className="h-4 w-4" />
            </div>
            <DialogTitle>Export to ZTT</DialogTitle>
          </div>
          <DialogDescription>
            Downloads an Excel spreadsheet with every zip code, their territory
            hierarchy, and any data fields — one row per zip code.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/30 p-3.5">
          <p className="text-muted-foreground mb-2.5 text-[11px] font-semibold uppercase tracking-wider">
            Column layout
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {sortedLayers.map((layer, i) => (
              <div key={layer.id} className="flex items-center gap-1.5">
                <span className="bg-background rounded border px-2 py-0.5 font-mono text-xs font-medium">
                  {layer.name}
                </span>
                {i < sortedLayers.length - 1 && (
                  <IconArrowRight className="text-muted-foreground h-3 w-3 shrink-0" />
                )}
              </div>
            ))}
          </div>
          <p className="text-muted-foreground mt-2.5 text-xs leading-relaxed">
            Parent columns repeat for every zip code in that territory — making
            it easy to filter by any level in Excel or your CRM.
          </p>
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false)
            }}
            disabled={isExporting}
          >
            Cancel
          </Button>
          <Button onClick={() => void handleExport()} disabled={isExporting}>
            {isExporting ? "Exporting…" : "Download Excel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
