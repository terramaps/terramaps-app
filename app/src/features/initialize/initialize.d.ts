export type LayerField = {
  name: string
  header: string
  parentHeader?: string
}
export type LayerFields = LayerField[]
export type DataFieldAggregation = "sum" | "avg" | "min" | "max"
export type DataField = {
  name: string
  header: string
  type: "text" | "number"
  aggregations: DataFieldAggregation[]
}
export type DataFields = DataField[]
export type HeadersData = string[]

export type UploadResult = {
  documentId: string
  headers: string[]
  suggestedLayers: string[]
  previewRows: (string | number | null)[][]
  rowCount: number
  warnings: string[]
}
