import { Outlet, createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router";
import { Layout } from "./components/Layout.tsx";
import { getAuth, isSuperadmin } from "./lib/auth.ts";
import { Admins } from "./pages/Admins.tsx";
import { Areas } from "./pages/Areas.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Flows } from "./pages/Flows.tsx";
import { Growth } from "./pages/Growth.tsx";
import { History } from "./pages/History.tsx";
import { Login } from "./pages/Login.tsx";
import { SchoolDetail } from "./pages/SchoolDetail.tsx";
import { Schools } from "./pages/Schools.tsx";
import { UserDetail } from "./pages/UserDetail.tsx";
import { Users } from "./pages/Users.tsx";

const rootRoute = createRootRoute({ component: () => <Outlet /> });

const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: Login });

// 認証ガード付きのレイアウトルート（pathless）。未ログインは /login へ。
const protectedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "protected",
  beforeLoad: () => {
    if (!getAuth()) throw redirect({ to: "/login" });
  },
  component: Layout,
});

const dashboardRoute = createRoute({ getParentRoute: () => protectedRoute, path: "/", component: Dashboard });
const schoolsRoute = createRoute({ getParentRoute: () => protectedRoute, path: "/schools", component: Schools });
const schoolDetailRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/schools/$id",
  component: () => <SchoolDetail id={schoolDetailRoute.useParams().id} />,
});
const growthRoute = createRoute({ getParentRoute: () => protectedRoute, path: "/growth", component: Growth });
const areasRoute = createRoute({ getParentRoute: () => protectedRoute, path: "/areas", component: Areas });
const usersRoute = createRoute({ getParentRoute: () => protectedRoute, path: "/users", component: Users });
const userDetailRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/users/$id",
  component: () => <UserDetail id={userDetailRoute.useParams().id} />,
});
const flowsRoute = createRoute({ getParentRoute: () => protectedRoute, path: "/flows", component: Flows });
const historyRoute = createRoute({ getParentRoute: () => protectedRoute, path: "/history", component: History });
const adminsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/admins",
  beforeLoad: () => {
    if (!isSuperadmin()) throw redirect({ to: "/" });
  },
  component: Admins,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  protectedRoute.addChildren([dashboardRoute, schoolsRoute, schoolDetailRoute, growthRoute, areasRoute, usersRoute, userDetailRoute, flowsRoute, historyRoute, adminsRoute]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
