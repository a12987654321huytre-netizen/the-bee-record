import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, Input } from "@/components/ui";
import { listAuditFn } from "@/lib/bee/admin.functions";
import { formatWhen } from "@/lib/bee/format";

export const Route = createFileRoute("/admin/audit")({
  validateSearch: (s: Record<string, unknown>): { q?: string } => ({
    q: typeof s.q === "string" && s.q ? s.q : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => listAuditFn({ data: { q: deps.q || undefined } }),
  component: Audit,
});

function Audit() {
  const { items } = Route.useLoaderData();
  const search = Route.useSearch();
  return (
    <div>
      <h1 className="font-display text-3xl">Audit log</h1>
      <form className="mt-4">
        <Input name="q" defaultValue={search.q} placeholder="Action, target…" className="max-w-sm" />
      </form>
      {!items.length ? (
        <div className="mt-6">
          <EmptyState title="No audit events yet." />
        </div>
      ) : (
        <ol className="mt-6 divide-y divide-rule border-y border-rule text-sm">
          {(items as Array<{ id: string; at: string; actor_type: string; actor_id: string | null; action: string; target_type: string; target_id: string | null; reason: string | null }>).map((e) => (
            <li key={e.id} className="py-2">
              <p className="font-mono text-xs text-muted">{formatWhen(e.at)}</p>
              <p>
                {e.action} · {e.target_type} {e.target_id}
              </p>
              <p className="text-muted">
                {e.actor_type} {e.actor_id} {e.reason ? `· ${e.reason}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
