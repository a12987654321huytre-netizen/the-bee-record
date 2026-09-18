import { createFileRoute, Link, useRouter, useRouteContext } from "@tanstack/react-router";
import { Button, EmptyState, Input, Select } from "@/components/ui";
import { createSourceFn, listSourcesFn } from "@/lib/bee/admin.functions";
import { relativeTime } from "@/lib/bee/format";

export const Route = createFileRoute("/admin/sources/")({
  validateSearch: (s: Record<string, unknown>): { q?: string; health?: string } => ({
    q: typeof s.q === "string" && s.q ? s.q : undefined,
    health: typeof s.health === "string" && s.health ? s.health : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => listSourcesFn({ data: deps }),
  component: Sources,
});

function Sources() {
  const { items } = Route.useLoaderData();
  const search = Route.useSearch();
  const ctx = useRouteContext({ from: "/admin" });
  const router = useRouter();
  const csrf = ctx.session?.csrf ?? "";
  return (
    <div>
      <h1 className="font-display text-3xl">Monitored sources</h1>
      <form className="mt-4 flex gap-2">
        <Input name="q" defaultValue={search.q} placeholder="URL or domain" className="max-w-xs" />
        <Select name="health" defaultValue={search.health} className="max-w-40">
          <option value="">Any</option>
          <option value="failed">Failed</option>
          <option value="stale">Stale</option>
          <option value="disabled">Disabled</option>
        </Select>
        <Button type="submit" variant="ghost">
          Filter
        </Button>
      </form>
      <form
        className="mt-6 grid gap-2 md:grid-cols-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const result = await createSourceFn({
            data: {
              csrf,
              url: String(f.get("url")),
              entityId: String(f.get("entityId") || "") || undefined,
              sourceType: String(f.get("sourceType") || "other"),
              frequency: String(f.get("frequency") || "weekly") as "daily" | "weekly" | "monthly" | "manual",
            },
          });
          if (result.ok) {
            await router.invalidate();
            await router.navigate({ to: "/admin/sources/$id", params: { id: result.id } });
          }
        }}
      >
        <Input name="url" placeholder="https://" required className="md:col-span-2" />
        <Select name="frequency" defaultValue="weekly">
          <option value="daily">daily</option>
          <option value="weekly">weekly</option>
          <option value="monthly">monthly</option>
          <option value="manual">manual</option>
        </Select>
        <Button type="submit">Add source</Button>
      </form>
      {!items.length ? (
        <div className="mt-6">
          <EmptyState title="No monitored sources have been configured." />
        </div>
      ) : (
        <table className="mt-6 w-full text-left text-sm">
          <thead className="border-y border-rule text-xs uppercase text-muted">
            <tr>
              <th className="py-2">URL</th>
              <th>Enabled</th>
              <th>Last check</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {(items as Array<{ id: string; url: string; enabled: number; last_checked_at: string | null; last_error: string | null; consecutive_error_count: number }>).map((s) => (
              <tr key={s.id} className="border-b border-rule">
                <td className="py-2">
                  <Link to="/admin/sources/$id" params={{ id: s.id }} className="break-all hover:underline">
                    {s.url}
                  </Link>
                </td>
                <td>{s.enabled ? "yes" : "no"}</td>
                <td>{s.last_checked_at ? relativeTime(s.last_checked_at) : "never"}</td>
                <td className="text-rust">{s.last_error}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
