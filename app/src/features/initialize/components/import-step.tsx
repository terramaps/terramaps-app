import { IconCloudUpload, IconX } from "@tabler/icons-react"
import { useQuery } from "@tanstack/react-query"
import * as React from "react"
import * as XLSX from "xlsx"

import XLSXIcon from "@/assets/xlsx-icon.svg?react"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { UploadResult } from "@/features/initialize/initialize"
import { cn } from "@/lib/utils"
import { useUploadSpreadsheetMutation } from "@/queries/mutations"
import { queries } from "@/queries/queries"

const MAX_FILE_SIZE_MB = 50
const PREVIEW_ROWS = 5

type Phase = "idle" | "file-selected" | "uploading" | "parsing" | "error"

type ImportSelection = {
  file: File
  workbook: XLSX.WorkBook
  sheet: [XLSX.WorkSheet, string] | null
}

export default function ImportStep({
  onComplete,
}: {
  onComplete: (result: UploadResult) => void
}) {
  const [phase, setPhase] = React.useState<Phase>("idle")
  const [selection, setSelection] = React.useState<ImportSelection | null>(null)
  const [documentId, setDocumentId] = React.useState<string | null>(null)
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const uploadMutation = useUploadSpreadsheetMutation()

  const uploadStatusQuery = useQuery({
    ...queries.getUpload(documentId ?? ""),
    enabled: documentId != null && phase === "parsing",
  })

  React.useEffect(() => {
    if (!uploadStatusQuery.data) return
    if (uploadStatusQuery.data.status === "ready") {
      const data = uploadStatusQuery.data
      onComplete({
        documentId: data.document_id,
        headers: data.headers,
        suggestedLayers: data.suggested_layers,
        previewRows: data.preview_rows,
        rowCount: data.row_count,
        warnings: data.warnings,
      })
    } else if (uploadStatusQuery.data.status === "failed") {
      setPhase("error")
      setErrorMessage(
        uploadStatusQuery.data.error || "Failed to parse spreadsheet",
      )
    }
  }, [uploadStatusQuery.data, onComplete])

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      // handled via CSS
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.files.length) {
      void handleFile(e.dataTransfer.files[0])
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault()
    if (e.target.files?.length) {
      void handleFile(e.target.files[0])
    }
  }

  const handleFile = async (file: File) => {
    const fileExtension = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`
    const validExtensions = [".xlsx", ".ztt"]
    if (!validExtensions.includes(fileExtension)) return
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) return

    const arrayBuffer = await file.arrayBuffer()
    // Read only the first 10 rows — enough for sheet names and preview
    const workbook = XLSX.read(arrayBuffer, { type: "buffer", sheetRows: 10 })

    let sheet: [XLSX.WorkSheet, string] | null = null
    if (workbook.SheetNames.length === 1) {
      sheet = [workbook.Sheets[workbook.SheetNames[0]], workbook.SheetNames[0]]
    }

    setSelection({ file, workbook, sheet })
    setPhase("file-selected")
  }

  const handleSheetSelect = (sheetName: string) => {
    setSelection((prev) => {
      if (!prev) return prev
      return { ...prev, sheet: [prev.workbook.Sheets[sheetName], sheetName] }
    })
  }

  const handleRemoveFile = () => {
    setSelection(null)
    setDocumentId(null)
    setErrorMessage(null)
    setPhase("idle")
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleUpload = () => {
    if (!selection?.sheet) return
    const tabIndex = selection.workbook.SheetNames.indexOf(selection.sheet[1])
    setPhase("uploading")
    uploadMutation.mutate(
      { file: selection.file, tabIndex },
      {
        onSuccess: (data) => {
          setDocumentId(data.document_id)
          setPhase("parsing")
        },
        onError: () => {
          setPhase("error")
          setErrorMessage("Failed to upload file. Please try again.")
        },
      },
    )
  }

  // ── Async states ───────────────────────────────────────────────────────────

  if (phase === "uploading" || phase === "parsing") {
    return (
      <div className="flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-8 py-24 text-center">
          <div className="relative size-16">
            <div className="absolute inset-0 rounded-full border-4 border-muted" />
            <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin" />
          </div>
          <div className="space-y-2">
            <p className="text-lg font-semibold">
              {phase === "uploading"
                ? "Uploading file…"
                : "Parsing spreadsheet…"}
            </p>
            <p className="text-muted-foreground text-sm">
              {phase === "uploading"
                ? "Sending your file to the server"
                : "Detecting columns and preparing preview"}
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (phase === "error") {
    return (
      <div className="flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-8 py-24 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <span className="text-destructive text-2xl font-bold">!</span>
          </div>
          <div className="space-y-2">
            <p className="text-lg font-semibold">Upload failed</p>
            <p className="text-muted-foreground text-sm max-w-sm">
              {errorMessage}
            </p>
          </div>
          <Button onClick={handleRemoveFile} variant="outline">
            Try again
          </Button>
        </div>
      </div>
    )
  }

  // ── File selection + sheet picker + preview ────────────────────────────────

  return (
    <div className="flex items-center justify-center p-6">
      <div className="w-full max-w-2xl flex flex-col gap-6">
        {!selection && (
          <div
            className={cn(
              "border-border hover:border-primary/50 relative rounded-lg border-2 border-dashed p-12 text-center transition-colors",
            )}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleChange}
              accept=".xlsx,.ztt"
            />
            <div className="mx-auto flex flex-col items-center">
              <IconCloudUpload className="text-muted-foreground mb-4 h-16 w-16" />
              <h3 className="mb-2 text-lg font-semibold">
                Upload Territory Data
              </h3>
              <p className="text-muted-foreground mb-4 text-sm">
                Drag and drop your file here, or click to browse
              </p>
              <Button onClick={() => fileInputRef.current?.click()}>
                Select File
              </Button>
              <p className="text-muted-foreground mt-4 text-xs">
                Supported formats: .xlsx, .ztt · Max size: {MAX_FILE_SIZE_MB}MB
              </p>
            </div>
          </div>
        )}

        {selection && (
          <div className="rounded-lg border border-border bg-card p-8">
            <div className="flex items-start gap-4">
              <XLSXIcon className="flex h-12 w-12 shrink-0" />
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold">{selection.file.name}</h4>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleRemoveFile}
                  >
                    <IconX className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-muted-foreground text-sm">
                  {(selection.file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            </div>
          </div>
        )}

        {selection && selection.workbook.SheetNames.length > 1 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">
              Select Sheet
            </h3>
            <div className="flex flex-wrap gap-2">
              {selection.workbook.SheetNames.map((sheetName) => (
                <button
                  key={sheetName}
                  onClick={() => {
                    handleSheetSelect(sheetName)
                  }}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm transition-colors hover:border-primary/50",
                    sheetName === selection.sheet?.[1]
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background",
                  )}
                >
                  <span className="font-medium">{sheetName}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {selection?.sheet && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">
              Preview — {selection.sheet[1]}
            </h3>
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {(() => {
                      const data = XLSX.utils.sheet_to_json<unknown[]>(
                        selection.sheet[0],
                        {
                          header: 1,
                          defval: "",
                        },
                      )
                      return data[0]?.map((cell, i) => (
                        <TableHead key={i}>{String(cell)}</TableHead>
                      ))
                    })()}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(() => {
                    const data = XLSX.utils.sheet_to_json<unknown[]>(
                      selection.sheet[0],
                      {
                        header: 1,
                        defval: "",
                      },
                    )
                    return data.slice(1, PREVIEW_ROWS + 1).map((row, i) => (
                      <TableRow key={i}>
                        {row.map((cell, j) => (
                          <TableCell key={j}>{String(cell)}</TableCell>
                        ))}
                      </TableRow>
                    ))
                  })()}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={handleUpload}
                size="lg"
                disabled={!selection.sheet}
              >
                Continue
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
