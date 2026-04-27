import type { ReactNode } from "react"

import { ComponentExample } from "@/components/component-example"
import LoginPage from "@/features/auth/login.page"
import RegisterPage from "@/features/auth/register.page"
import HomePage from "@/features/home/page"
import InitializePage from "@/features/initialize/page"
import SettingsPage from "@/features/settings/page"

import { VersionsPage } from "./common/versions.page"

const PageName = {
  Versions: "VersionsPage",
  Initialize: "InitializePage",
  InitializeUpload: "InitializeUploadPage",
  InitializeProcessing: "InitializeProcessingPage",
  Example: "ExamplePage",
  Home: "HomePage",
  Login: "LoginPage",
  Register: "RegisterPage",
  Settings: "SettingsPage",
} as const

type PageName = (typeof PageName)[keyof typeof PageName]

type Route = {
  route: string
  component: ReactNode
  protected?: true
}

/* Here we can Define parameter types for each route in the format of
   { [PageName]: { path: { [paramName]: any }, query: { [paramName]: any} } }
*/
export type RouteParamsType = {
  [PageName.Versions]: {
    query: {
      hello?: "world"
      // this actually prevents a TS error in use-query-param.ts
      // allowing for checking if a query value is non null
      preventTsError: ""
    }
  }
  [PageName.Home]: {
    path: {
      mapId: string
    }
  }
  [PageName.InitializeUpload]: {
    path: {
      documentId: string
    }
  }
  [PageName.InitializeProcessing]: {
    path: {
      mapId: string
    }
  }
}

export type ExtractPathParams<T extends PageName> =
  T extends keyof RouteParamsType
    ? RouteParamsType[T] extends { path: Record<string, string> }
      ? RouteParamsType[T]["path"]
      : undefined
    : undefined

export type ExtractQueryParams<T extends PageName> =
  T extends keyof RouteParamsType
    ? RouteParamsType[T] extends { query: Record<string, string | number> }
      ? RouteParamsType[T]["query"]
      : undefined
    : undefined

const Routes: Record<PageName, Route> = {
  [PageName.Home]: {
    route: "/maps/:mapId",
    component: <HomePage />,
    protected: true,
  },
  [PageName.Initialize]: {
    route: "/new",
    component: <InitializePage />,
    protected: true,
  },
  [PageName.InitializeUpload]: {
    route: "/new/:documentId",
    component: <InitializePage />,
    protected: true,
  },
  [PageName.InitializeProcessing]: {
    route: "/new/map/:mapId",
    component: <InitializePage />,
    protected: true,
  },
  [PageName.Example]: {
    route: "/example",
    component: <ComponentExample />,
    protected: true,
  },
  [PageName.Versions]: {
    route: "/versions",
    component: <VersionsPage />,
    protected: true,
  },
  [PageName.Login]: {
    route: "/login",
    component: <LoginPage />,
  },
  [PageName.Register]: {
    route: "/register",
    component: <RegisterPage />,
  },
  [PageName.Settings]: {
    route: "/settings",
    component: <SettingsPage />,
    protected: true,
  },
}

class RouteClass<T extends PageName> {
  private routesObj: Record<T, Route>

  constructor(routesObj: Record<T, Route>) {
    this.routesObj = routesObj
  }

  getRoute<K extends T>(
    route: K,
    pathParams?: ExtractPathParams<K>,
    queryParams?: ExtractQueryParams<K>,
  ): string {
    let path = this.routesObj[route].route
    if (!path) {
      throw new Error(`Route '${route}' not found.`)
    }

    if (pathParams) {
      for (const key in pathParams) {
        path = path.replace(
          `:${key}`,
          (pathParams as Record<string, string>)[key],
        )
      }
    }

    if (queryParams) {
      const queryString = Object.entries(
        queryParams as {
          [key: string]: string | number | undefined
        },
      )
        .filter(([_, value]) => value !== undefined)
        .map(
          ([key, value]) =>
            `${encodeURIComponent(key)}=${encodeURIComponent(
              (value as string | number).toString(),
            )}`,
        )
        .join("&")

      if (queryString) {
        path += `?${queryString}`
      }
    }
    return path
  }

  getUnproctedRoutes(): ({
    name: string
  } & Route)[] {
    return Object.entries(
      this.routesObj as {
        [key: string]: Route
      },
    )
      .filter(([_, route]) => !route.protected)
      .map(([name, { route, component }]) => ({
        name,
        route,
        component,
      }))
  }

  getProtectedRoutes(): ({
    name: string
  } & Route)[] {
    return Object.entries(
      this.routesObj as {
        [key: string]: Route
      },
    )
      .filter(([_, route]) => route.protected)
      .map(([name, { route, component }]) => ({
        name,
        route,
        component,
      }))
  }
}

const AppRoutes = new RouteClass(Routes)

export { AppRoutes, PageName }
