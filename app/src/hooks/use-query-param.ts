import { useSearchParams } from "react-router-dom"

import type {
  ExtractQueryParams,
  PageName,
  RouteParamsType,
} from "@/app/routes"

export function useQueryParams<T extends PageName & keyof RouteParamsType>(): [
  Partial<ExtractQueryParams<T>>,
  (newValue: ExtractQueryParams<T> | null) => void,
] {
  const [searchParams, setSearchParams] = useSearchParams()
  const searchParamsObject = Object.fromEntries(searchParams) as Partial<
    ExtractQueryParams<T>
  >
  const setValue = (newValue: ExtractQueryParams<T> | null) => {
    for (const [param, value] of Object.entries(newValue ?? {})) {
      if (value) {
        searchParams.set(param, value as string)
      } else {
        searchParams.delete(param)
      }
    }
    setSearchParams(searchParams)
  }
  return [searchParamsObject, setValue]
}
