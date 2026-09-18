import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public-shell";
import { EmptyState } from "@/components/ui";
import { DateCell, LifecycleBadge } from "@/components/meta";
import { getExpiringPage } from "@/lib/bee/public.functions";

export const Route = createFileRoute("/evidence/expired")({
  loader: () => getExpiringPage({ data: { mode: "expired" } }),
  component: ExpiredPage,
  head: () => ({ meta: [{ title: "Expired evidence — The BEE Record" }] }),
});

function ExpiredPage() {
  const { items } = Route.useLoaderData();
  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
        <h1 className="font-display text-4xl">Expired evidence</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Documents retained after their stated expiry. History is not deleted. Absence of a replacement is not itself a
          compliance finding.
        </p>
        {!items.length ? (
          <div className="mt-8">
            <EmptyState title="No expired published evidence is in the index." />
          </div>
        ) : (
          <ul className="mt-8 divide-y divide-rule border-y border-rule">
            {items.map((row) => (
              <li key={row.id} className="flex flex-wrap justify-between gap-2 py-3">
                <div>
                  <Link to="/evidence/$id" params={{ id: row.id }} className="font-medium hover:underline">
                    {row.title ?? row.id}
                  </Link>
                  <p className="text-sm text-muted">{row.entity_name ?? "Unlinked"}</p>
                </div>
                <div className="text-sm">
                  <LifecycleBadge state={row.lifecycle_state} />
                  <div className="mt-1 text-muted">
                    expired <DateCell value={row.expiry_date} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PublicShell>
  );
}
