import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public-shell";
import { EmptyState } from "@/components/ui";
import { DateCell, LifecycleBadge } from "@/components/meta";
import { getExpiringPage } from "@/lib/bee/public.functions";

export const Route = createFileRoute("/evidence/expiring")({
  loader: () => getExpiringPage({ data: { mode: "expiring" } }),
  component: ExpiringPage,
  head: () => ({ meta: [{ title: "Expiring evidence — The BEE Record" }] }),
});

function ExpiringPage() {
  const { items } = Route.useLoaderData();
  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
        <h1 className="font-display text-4xl">Expiring evidence</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Indexed documents approaching their stated expiry. This is not a finding that a company is non-compliant.
        </p>
        <p className="mt-3 text-sm">
          <Link to="/evidence/expired" className="underline underline-offset-4">
            Recently expired
          </Link>
        </p>
        {!items.length ? (
          <div className="mt-8">
            <EmptyState title="No indexed evidence is currently marked as expiring soon." />
          </div>
        ) : (
          <ul className="mt-8 divide-y divide-rule border-y border-rule">
            {items.map((row) => (
              <li key={row.id} className="flex flex-wrap justify-between gap-2 py-3">
                <div>
                  <Link to="/evidence/$id" params={{ id: row.id }} className="font-medium hover:underline">
                    {row.title ?? row.id}
                  </Link>
                  <p className="text-sm text-muted">
                    {row.entity_slug ? (
                      <Link to="/companies/$slug" params={{ slug: row.entity_slug }} className="hover:underline">
                        {row.entity_name}
                      </Link>
                    ) : (
                      "Unlinked"
                    )}
                  </p>
                </div>
                <div className="text-sm">
                  <LifecycleBadge state={row.lifecycle_state} />
                  <div className="mt-1 text-muted">
                    expires <DateCell value={row.expiry_date} />
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
