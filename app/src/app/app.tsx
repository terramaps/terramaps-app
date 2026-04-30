import { useEffect } from "react"
import { Outlet, Route, Routes, useNavigate } from "react-router-dom"

import { activeMapStorageKey } from "@/lib/active-map-storage"

import { AppProviders } from "./providers"
import { AuthProvider } from "./providers/me-provider"
import { useMaps, useMe } from "./providers/me-provider/context"
import { AppLoadingScreen } from "./providers/me-provider/loading-screen"
import { AppRoutes, PageName } from "./routes"

function RootRedirect() {
  const me = useMe()
  const maps = useMaps()
  const navigate = useNavigate()

  useEffect(() => {
    const stored = localStorage.getItem(activeMapStorageKey(me.id))
    const target = maps.find((m) => m.id === stored) ?? maps[0]
    if (target) {
      void navigate(AppRoutes.getRoute(PageName.Home, { mapId: target.id }), {
        replace: true,
      })
    }
  }, [maps, me.id, navigate])

  return <AppLoadingScreen />
}

function App() {
  return (
    <AppProviders>
      <Routes>
        {AppRoutes.getUnproctedRoutes().map((route) => (
          <Route
            key={route.name}
            path={route.route}
            element={route.component}
          />
        ))}
        <Route
          path="/"
          element={
            <AuthProvider>
              <Outlet />
            </AuthProvider>
          }
        >
          <Route index element={<RootRedirect />} />
          {AppRoutes.getProtectedRoutes().map((route) => (
            <Route
              key={route.name}
              path={route.route}
              element={route.component}
            />
          ))}
        </Route>
      </Routes>
    </AppProviders>
  )
}

export default App
