import { IconArrowDown, IconTrash } from "@tabler/icons-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface LayerConfig {
  level: number
  name: string
  idField: string
  enabled: boolean
}

interface LayerStepProps {
  headers: string[]
  suggestedLayers: string[]
  onComplete: (layers: LayerConfig[]) => void
  onBack?: () => void
}

export default function LayerStep({
  headers,
  suggestedLayers,
  onComplete,
  onBack,
}: LayerStepProps) {
  const [layers, setLayers] = React.useState<LayerConfig[]>(() => {
    const defaults =
      suggestedLayers.length > 0 ? suggestedLayers : headers.slice(0, 4)
    return defaults.map((header, index) => ({
      level: index,
      name: header,
      idField: header,
      enabled: true,
    }))
  })

  const updateLayer = (
    level: number,
    field: keyof LayerConfig,
    value: string | boolean,
  ) => {
    setLayers((prev) =>
      prev.map((layer) =>
        layer.level === level ? { ...layer, [field]: value } : layer,
      ),
    )
  }

  const removeLayer = (level: number) => {
    setLayers((prev) => prev.filter((layer) => layer.level !== level))
  }

  const addLayer = () => {
    const newLevel =
      layers.length > 0 ? Math.max(...layers.map((l) => l.level)) + 1 : 0
    setLayers((prev) => [
      ...prev,
      {
        level: newLevel,
        name: headers[0],
        idField: headers[0] || "",
        enabled: true,
      },
    ])
  }

  const handleComplete = () => {
    const enabledLayers = layers.filter((l) => l.enabled)
    if (enabledLayers.length === 0) {
      return
    }
    onComplete(enabledLayers)
  }

  return (
    <div className="flex items-start justify-center p-6">
      <div className="w-full max-w-3xl flex flex-col gap-6">
        <div>
          <h2 className="text-2xl font-semibold">Configure Layer Hierarchy</h2>
          <p className="text-muted-foreground mt-2">
            Define your data layers from most granular to most aggregated. Each
            layer rolls up into the next.
          </p>
        </div>

        <div className="space-y-3">
          {layers.map((layer, index) => (
            <React.Fragment key={layer.level}>
              <div className="rounded-lg border border-border bg-card">
                <div className="border-b border-border bg-muted/50 px-4 py-2">
                  <div className="flex items-center gap-2">
                    <span className="bg-primary text-primary-foreground rounded-md px-2 py-0.5 text-xs font-semibold">
                      {String(index + 1)}
                    </span>
                    <span className="text-sm font-medium">
                      Layer {String(index + 1)}
                      {index === 0 && " (Most Granular)"}
                      {index === layers.length - 1 &&
                        index > 0 &&
                        " (Most Aggregated)"}
                    </span>
                  </div>
                </div>
                <div className="flex gap-4 items-center p-4">
                  <div className="flex-1 space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor={`layer-name-${String(layer.level)}`}>
                          Layer Name
                        </Label>
                        <Input
                          id={`layer-name-${String(layer.level)}`}
                          value={layer.name}
                          onChange={(e) => {
                            updateLayer(layer.level, "name", e.target.value)
                          }}
                          placeholder="e.g., Territories, Regions"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor={`id-field-${String(layer.level)}`}>
                          Data Column
                        </Label>
                        <Select
                          value={layer.idField}
                          onValueChange={(value) => {
                            updateLayer(layer.level, "idField", value)
                          }}
                        >
                          <SelectTrigger
                            id={`id-field-${String(layer.level)}`}
                            className="w-full"
                          >
                            <SelectValue placeholder="Select column" />
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
                  </div>

                  {layers.length > 1 && (
                    <div className="space-y-2">
                      <Label className="invisible">a</Label> {/* Spacer */}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          removeLayer(layer.level)
                        }}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <IconTrash className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {index < layers.length - 1 && (
                <div className="flex justify-center">
                  <div className="flex flex-col items-center gap-1">
                    <IconArrowDown className="text-muted-foreground h-5 w-5" />
                    <span className="text-muted-foreground text-xs">
                      rolls up to
                    </span>
                  </div>
                </div>
              )}
            </React.Fragment>
          ))}
        </div>

        <Button
          variant="outline"
          onClick={addLayer}
          className="w-full"
          disabled={layers.length >= headers.length}
        >
          Add Layer
        </Button>

        <div className="flex items-center justify-between pt-4 border-t">
          <Button onClick={onBack} variant="outline" size="lg">
            Back
          </Button>
          <div className="flex items-center gap-4">
            <p className="text-muted-foreground text-sm">
              {layers.length} {layers.length === 1 ? "layer" : "layers"}{" "}
              configured
            </p>
            <Button
              onClick={handleComplete}
              size="lg"
              disabled={layers.length === 0}
            >
              Continue
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
