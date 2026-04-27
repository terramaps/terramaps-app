import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type {
  DataFields,
  HeadersData,
  LayerFields,
} from "@/features/initialize/initialize"

interface ReviewStepProps {
  name: string
  headers: HeadersData
  rowCount: number
  previewRows: (string | number | null)[][]
  layerFields: LayerFields
  dataFields: DataFields
  isSubmitting?: boolean
  onNameChange?: (name: string) => void
  onComplete?: () => void
  onBack?: () => void
}

export default function ReviewStep({
  name,
  headers,
  rowCount,
  previewRows,
  layerFields,
  dataFields,
  isSubmitting = false,
  onNameChange,
  onComplete,
  onBack,
}: ReviewStepProps) {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex h-full w-full max-w-6xl flex-col gap-6">
        <div>
          <h2 className="text-2xl font-semibold">Review & Launch</h2>
          <p className="text-muted-foreground mt-2">
            Review your configuration and name your project
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="space-y-6">
            {/* Project Name */}
            <div className="rounded-lg border border-border bg-card p-6">
              <h3 className="text-lg font-semibold mb-4">Project Name</h3>
              <div className="space-y-3">
                <Label htmlFor="project-name">Name</Label>
                <Input
                  id="project-name"
                  value={name}
                  onChange={(e) => onNameChange?.(e.target.value)}
                  placeholder="Enter project name"
                  className="max-w-md"
                />
              </div>
            </div>

            {/* Data Summary */}
            <div className="rounded-lg border border-border bg-card p-6">
              <h3 className="text-lg font-semibold mb-4">Data Summary</h3>
              <div className="grid grid-cols-2 gap-4 max-w-md mb-4">
                <div>
                  <div className="text-sm text-muted-foreground">
                    Total Rows
                  </div>
                  <div className="text-2xl font-semibold">
                    {rowCount.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">
                    Total Columns
                  </div>
                  <div className="text-2xl font-semibold">{headers.length}</div>
                </div>
              </div>

              {/* Data Preview Collapsible */}
              <Collapsible open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
                <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border border-border p-3 hover:bg-accent transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Data Preview</span>
                    <span className="text-xs text-muted-foreground">
                      (First 5 rows)
                    </span>
                  </div>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`transition-transform ${
                      isPreviewOpen ? "rotate-180" : ""
                    }`}
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-3">
                  <div className="rounded-md border overflow-hidden">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {headers.map((header) => (
                              <TableHead key={header}>{header}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {previewRows.slice(0, 5).map((row, rowIndex) => (
                            <TableRow key={rowIndex}>
                              {row.map((cell, cellIndex) => (
                                <TableCell key={cellIndex}>
                                  {cell === null ? "—" : String(cell)}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>

            {/* Layer Configuration */}
            <div className="rounded-lg border border-border bg-card p-6">
              <h3 className="text-lg font-semibold mb-4">
                Layer Configuration
              </h3>
              <div className="space-y-3">
                {layerFields.map((layer, index) => (
                  <div
                    key={layer.header}
                    className="flex items-center gap-4 rounded-md border border-border p-4"
                  >
                    <Badge variant="outline" className="shrink-0">
                      Layer {index + 1}
                    </Badge>
                    <div className="flex-1">
                      <div className="font-medium">{layer.name}</div>
                      <div className="text-sm text-muted-foreground">
                        Column: {layer.header}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Data Fields Configuration */}
            <div className="rounded-lg border border-border bg-card p-6">
              <h3 className="text-lg font-semibold mb-4">
                Data Fields Configuration
              </h3>
              <div className="space-y-3">
                {dataFields.map((field) => (
                  <div
                    key={field.header}
                    className="flex items-center gap-4 rounded-md border border-border p-4"
                  >
                    <Badge
                      variant={
                        field.type === "number" ? "default" : "secondary"
                      }
                      className="shrink-0"
                    >
                      {field.type}
                    </Badge>
                    <div className="flex-1">
                      <div className="font-medium">{field.name}</div>
                      <div className="text-sm text-muted-foreground">
                        Column: {field.header}
                        {field.type === "number" &&
                          field.aggregations.length > 0 && (
                            <span>
                              {" · Aggregations: "}
                              {field.aggregations.join(", ")}
                            </span>
                          )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="shrink-0 flex items-center justify-between border-t pt-4">
          <Button onClick={onBack} variant="outline" size="lg">
            Back
          </Button>
          <Button
            onClick={onComplete}
            size="lg"
            disabled={!name.trim() || isSubmitting}
          >
            Create Project
          </Button>
        </div>
      </div>
    </div>
  )
}
