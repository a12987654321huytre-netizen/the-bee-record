import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { logoutAdminFn } from "@/lib/bee/admin.functions";
import type { AdminSession } from "@/lib/bee/types";
import { Button } from "./ui";

const LINKS = [
  { to: "/admin", label: "Dashboard", exact: true },
  { to: "/admin/review", label: "Review" },
  { to: "/admin/companies", label: "Companies" },
  { to: "/admin/evidence", label: "Evidence" },
  { to: "/admin/sources", label: "Sources" },
  { to: "/admin/jobs", label: "Jobs" },
  { to: "/admin/enrichment", label: "Enrichment" },
  { to: "/admin/submissions", label: "Submissions" },
  { to: "/admin/verifiers", label: "Verifiers" },
  { to: "/admin/audit", label: "Audit" },
  { to: "/admin/settings", label: "Settings" },
] as const;

export function AdminShell({ session, children }: { session: AdminSession; children: React.ReactNode }) {
  const router = useRouter();
  const logout = useServerFn(logoutAdminFn);
  return (
    <div className="min-h-screen bg-cream">
      <header className="border-b border-rule bg-ink text-cream">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-rule">Operations</p>
            <Link to="/admin" className="font-display text-xl">
              BEE Record admin
            </Link>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-rule">
              <Link to="/admin/settings" hash="account" className="text-rule underline-offset-4 hover:text-cream hover:underline">
                {session.name}
              </Link>
              {" · "}
              {session.role}
            </span>
            <Link to="/" className="text-cream underline-offset-4 hover:underline">
              Public site
            </Link>
            <Button
              variant="ghost"
              className="min-h-9 border-rule-strong bg-transparent text-cream hover:bg-ink-2"
              onClick={async () => {
                await logout();
                await router.invalidate();
              }}
            >
              Log out
            </Button>
          </div>
        </div>
        <nav aria-label="Admin" className="mx-auto flex max-w-7xl flex-wrap gap-x-4 gap-y-2 px-4 pb-3 text-sm">
          {LINKS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: "exact" in item ? item.exact : false }}
              className="text-rule hover:text-cream"
              activeProps={{ className: "text-cream underline underline-offset-4" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <div className="mx-auto max-w-7xl px-4 py-6">{children}</div>
    </div>
  );
}
