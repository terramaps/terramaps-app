import { IconTrash } from "@tabler/icons-react"
import * as React from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  DataField,
  DataFieldAggregation,
  DataFields,
  HeadersData,
} from "@/features/initialize/initialize"
import { cn } from "@/lib/utils"

interface DataStepProps {
  headers: HeadersData
  layerHeaders: string[]
  onComplete: (dataFields: DataFields) => void
  onBack?: () => void
}

const AGGREGATION_OPTIONS: {
  value: DataFieldAggregation
  label: string
  description: string
}[] = [
  { value: "sum", label: "Sum", description: "Add all values together" },
  { value: "avg", label: "Average", description: "Calculate mean value" },
  { value: "min", label: "Min", description: "Smallest value" },
  { value: "max", label: "Max", description: "Largest value" },
]

export default function DataStep({
  headers,
  layerHeaders,
  onComplete,
  onBack,
}: DataStepProps) {
  const [fieldConfigs, setFieldConfigs] = React.useState<
    Map<string, DataField>
  >(() => {
    const map = new Map<string, DataField>()
    headers
      .filter((h) => !layerHeaders.includes(h))
      .forEach((header) => {
        map.set(header, {
          name: header,
          header,
          type: "text",
          aggregations: [],
        })
      })
    return map
  })

  const [selectedField, setSelectedField] = React.useState<string | null>(
    Array.from(fieldConfigs.keys())[0] ?? null,
  )

  const fieldKeys = Array.from(fieldConfigs.keys())

  const updateFieldName = (key: string, name: string) => {
    setFieldConfigs((prev) => {
      const next = new Map(prev)
      const field = next.get(key)
      if (field) next.set(key, { ...field, name })
      return next
    })
  }

  const updateFieldHeader = (key: string, header: string) => {
    setFieldConfigs((prev) => {
      const next = new Map(prev)
      const field = next.get(key)
      if (field) next.set(key, { ...field, header })
      return next
    })
  }

  const updateFieldType = (key: string, type: "text" | "number") => {
    setFieldConfigs((prev) => {
      const next = new Map(prev)
      const field = next.get(key)
      if (field) {
        next.set(key, {
          ...field,
          type,
          // Clear aggregations when switching to text
          aggregations: type === "number" ? field.aggregations : [],
        })
      }
      return next
    })
  }

  const removeField = (key: string) => {
    setFieldConfigs((prev) => {
      const next = new Map(prev)
      next.delete(key)
      return next
    })
    if (selectedField === key) {
      const remaining = Array.from(fieldConfigs.keys()).filter((k) => k !== key)
      setSelectedField(remaining[0] ?? null)
    }
  }

  const addField = (header: string) => {
    const key = `${header}-${Date.now().toString()}`
    setFieldConfigs((prev) => {
      const next = new Map(prev)
      next.set(key, { name: header, header, type: "text", aggregations: [] })
      return next
    })
    setSelectedField(key)
  }

  const toggleAggregation = (key: string, agg: DataFieldAggregation) => {
    setFieldConfigs((prev) => {
      const next = new Map(prev)
      const field = next.get(key)
      if (field && field.type === "number") {
        const aggregations = field.aggregations.includes(agg)
          ? field.aggregations.filter((a) => a !== agg)
          : [...field.aggregations, agg]
        next.set(key, { ...field, aggregations })
      }
      return next
    })
  }

  const handleComplete = () => {
    onComplete(Array.from(fieldConfigs.values()))
  }

  const selectedConfig = selectedField ? fieldConfigs.get(selectedField) : null

  return (
    <div className="flex h-full min-h-150 items-center justify-center p-6">
      <div className="flex h-full w-full max-w-6xl flex-col gap-6">
        <div>
          <h2 className="text-2xl font-semibold">Configure Data Fields</h2>
          <p className="text-muted-foreground mt-2">
            Set data types and aggregation methods for each field
          </p>
        </div>

        <div className="grid flex-1 grid-cols-[300px_1fr] gap-6 overflow-hidden min-h-0">
          {/* Field List */}
          <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
            <div className="shrink-0 border-b border-border p-4">
              <h3 className="font-semibold">Data Fields</h3>
              <p className="text-muted-foreground text-xs mt-1">
                {fieldKeys.length} fields configured
              </p>
            </div>
            <div className="flex-1 overflow-y-auto">
              <div className="flex flex-col p-2 space-y-1 gap-1">
                {fieldKeys.map((key) => {
                  const config = fieldConfigs.get(key)
                  const isSelected = selectedField === key
                  return (
                    <div
                      key={key}
                      className={`flex items-center p-3 gap-4 group relative rounded-md transition-colors ${
                        isSelected
                          ? "bg-accent border border-primary"
                          : "hover:bg-accent/50"
                      }`}
                    >
                      <button
                        onClick={() => {
                          setSelectedField(key)
                        }}
                        className="w-full text-left"
                      >
                        <div className="space-y-1.5">
                          <div className="font-medium text-sm truncate">
                            {config?.name ?? key}
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge
                              variant={
                                config?.type === "number"
                                  ? "default"
                                  : "secondary"
                              }
                              className="shrink-0"
                            >
                              {config?.type}
                            </Badge>
                            {config?.type === "number" &&
                              config.aggregations.length > 0 && (
                                <div className="text-muted-foreground text-xs">
                                  {config.aggregations.join(", ")}
                                </div>
                              )}
                          </div>
                        </div>
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeField(key)
                        }}
                        className={cn(
                          "invisible group-hover:visible text-muted-foreground hover:text-destructive",
                          isSelected && "visible",
                        )}
                      >
                        <IconTrash className="h-4 w-4" />
                      </Button>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="shrink-0 border-t border-border p-2">
              <Select
                value=""
                onValueChange={(value) => {
                  if (value) addField(value)
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="+ Add field" />
                </SelectTrigger>
                <SelectContent>
                  {headers.map((header) => (
                    <SelectItem key={header} value={header}>
                      {header}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Field Configuration */}
          <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
            {selectedConfig ? (
              <>
                <div className="shrink-0 border-b border-border p-4">
                  <h3 className="font-semibold text-lg">
                    {selectedConfig.name}
                  </h3>
                  <p className="text-muted-foreground text-sm mt-1">
                    Configure how this field should be processed
                  </p>
                </div>

                <div className="flex-1 overflow-y-auto">
                  <div className="p-6 space-y-6">
                    {/* Field Name */}
                    <div className="space-y-3">
                      <Label
                        htmlFor="field-name"
                        className="text-base font-semibold"
                      >
                        Field Name
                      </Label>
                      <Input
                        id="field-name"
                        value={selectedConfig.name}
                        onChange={(e) => {
                          if (selectedField)
                            updateFieldName(selectedField, e.target.value)
                        }}
                        placeholder="Enter field name"
                      />
                    </div>

                    {/* Column Header */}
                    <div className="space-y-3">
                      <Label className="text-base font-semibold">
                        Column Header
                      </Label>
                      <Select
                        value={selectedConfig.header}
                        onValueChange={(value) => {
                          if (selectedField)
                            updateFieldHeader(selectedField, value)
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select column header" />
                        </SelectTrigger>
                        <SelectContent>
                          {headers.map((header) => (
                            <SelectItem key={header} value={header}>
                              {header}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Data Type */}
                    <div className="space-y-3">
                      <Label className="text-base font-semibold">
                        Data Type
                      </Label>
                      <RadioGroup
                        value={selectedConfig.type}
                        onValueChange={(value: "text" | "number") => {
                          if (selectedField)
                            updateFieldType(selectedField, value)
                        }}
                      >
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="text" id="type-text" />
                          <Label htmlFor="type-text" className="font-normal">
                            Text
                          </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="number" id="type-number" />
                          <Label htmlFor="type-number" className="font-normal">
                            Number
                          </Label>
                        </div>
                      </RadioGroup>
                    </div>

                    {/* Aggregation Methods — only for numbers */}
                    {selectedConfig.type === "number" && (
                      <div className="space-y-3">
                        <div>
                          <Label className="text-base font-semibold">
                            Aggregation Methods
                          </Label>
                          <p className="text-muted-foreground text-sm mt-1">
                            How this field rolls up through the hierarchy
                          </p>
                        </div>

                        <div className="flex gap-3">
                          {AGGREGATION_OPTIONS.map((option) => {
                            const isChecked =
                              selectedConfig.aggregations.includes(option.value)
                            return (
                              <div
                                key={option.value}
                                className={`flex-1 rounded-lg border p-4 transition-colors ${
                                  isChecked
                                    ? "border-primary bg-accent"
                                    : "border-border hover:border-primary/50"
                                }`}
                              >
                                <div className="flex items-start gap-3">
                                  <Checkbox
                                    id={`agg-${selectedField ?? ""}-${option.value}`}
                                    checked={isChecked}
                                    onCheckedChange={() => {
                                      if (selectedField)
                                        toggleAggregation(
                                          selectedField,
                                          option.value,
                                        )
                                    }}
                                  />
                                  <label
                                    htmlFor={`agg-${selectedField ?? ""}-${option.value}`}
                                    className="flex-1 cursor-pointer"
                                  >
                                    <div className="font-medium">
                                      {option.label}
                                    </div>
                                    <div className="text-muted-foreground text-xs mt-0.5">
                                      {option.description}
                                    </div>
                                  </label>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-muted-foreground">
                Select a field to configure
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 flex items-center justify-between border-t pt-4">
          <Button onClick={onBack} variant="outline" size="lg">
            Back
          </Button>
          <div className="flex items-center gap-4">
            <p className="text-muted-foreground text-sm">
              {fieldKeys.length} data{" "}
              {fieldKeys.length === 1 ? "field" : "fields"} configured
            </p>
            <Button onClick={handleComplete} size="lg">
              Continue
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
