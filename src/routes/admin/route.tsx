import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin-shell";
import { getAdminContext } from "@/lib/bee/admin.functions";

export const Route = createFileRoute("/admin")({
  beforeLoad: async ({ location }) => {
    const ctx = await getAdminContext();
    const path = location.pathname;
    const isGate = path === "/admin/login" || path === "/admin/bootstrap";
    if (ctx.needsBootstrap && path !== "/admin/bootstrap") {
      throw redirect({ to: "/admin/bootstrap" });
    }
    if (!ctx.needsBootstrap && path === "/admin/bootstrap") {
      throw redirect({ to: "/admin/login" });
    }
    if (!ctx.session && !isGate) {
      throw redirect({ to: "/admin/login" });
    }
    if (ctx.session && isGate) {
      throw redirect({ to: "/admin" });
    }
    return ctx;
  },
  component: AdminLayout,
});

function AdminLayout() {
  const ctx = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isGate = pathname === "/admin/login" || pathname === "/admin/bootstrap";
  if (isGate || !ctx.session) return <Outlet />;
  return (
    <AdminShell session={ctx.session}>
      <Outlet />
    </AdminShell>
  );
}
