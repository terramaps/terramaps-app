export type LayerField = {
  name: string
  header: string
  parentHeader?: string
}
export type LayerFields = LayerField[]
export type DataFieldAggregation = "sum" | "avg"
export type DataField = {
  name: string
  header: string
  type: "text" | "number"
  aggregations: DataFieldAggregation[]
}
export type DataFields = DataField[]
export type HeadersData = string[]
export type ValuesData = (string | number | null)[][]
export type CellData = string | number | null
