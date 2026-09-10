import { Outlet, createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { Layout } from "./components/Layout.tsx";
import { getAuth } from "./lib/auth.ts";
import { Absences } from "./pages/Absences.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Login } from "./pages/Login.tsx";

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: Login });

const protectedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "protected",
  beforeLoad: () => {
    if (!getAuth()) throw redirect({ to: "/login" });
  },
  component: Layout,
});

const dashboardRoute = createRoute({ getParentRoute: () => protectedRoute, path: "/", component: Dashboard });
const absencesRoute = createRoute({ getParentRoute: () => protectedRoute, path: "/absences", component: Absences });

const routeTree = rootRoute.addChildren([loginRoute, protectedRoute.addChildren([dashboardRoute, absencesRoute])]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
