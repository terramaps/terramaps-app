import { useEffect } from "react"
import { Outlet, Route, Routes, useNavigate } from "react-router-dom"

import { AppProviders } from "./providers"
import { AuthProvider } from "./providers/me-provider"
import { useMaps } from "./providers/me-provider/context"
import { AppLoadingScreen } from "./providers/me-provider/loading-screen"
import { AppRoutes, PageName } from "./routes"

const ACTIVE_MAP_KEY = "terramaps_active_map_id"

function RootRedirect() {
  const maps = useMaps()
  const navigate = useNavigate()

  useEffect(() => {
    const stored = localStorage.getItem(ACTIVE_MAP_KEY)
    const target = maps.find((m) => m.id === stored) ?? maps[0]
    if (target) {
      localStorage.setItem(ACTIVE_MAP_KEY, target.id)
      void navigate(AppRoutes.getRoute(PageName.Home, { mapId: target.id }), {
        replace: true,
      })
    }
  }, [maps, navigate])

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
