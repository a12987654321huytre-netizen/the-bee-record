import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public-shell";
import { EmptyState } from "@/components/ui";
import { Pagination } from "@/components/meta";
import { formatWhen } from "@/lib/bee/format";
import { getUpdatesPage } from "@/lib/bee/public.functions";

export const Route = createFileRoute("/updates")({
  validateSearch: (s: Record<string, unknown>): { page?: number } => ({
    page: s.page != null && s.page !== "" ? Number(s.page) || 1 : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getUpdatesPage({ data: { page: deps.page } }),
  component: Updates,
  head: () => ({ meta: [{ title: "Updates — The BEE Record" }] }),
});

function Updates() {
  const { items, total, page, pageSize } = Route.useLoaderData();
  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
        <h1 className="font-display text-4xl">Recently published</h1>
        <p className="mt-2 text-muted">Actual publication events from reviewed or auto-published evidence. Nothing is fabricated.</p>
        {!items.length ? (
          <div className="mt-8">
            <EmptyState title="No publication events yet." />
          </div>
        ) : (
          <ol className="mt-8 divide-y divide-rule border-y border-rule">
            {items.map((ev) => (
              <li key={ev.id} className="py-4">
                <p className="text-xs uppercase tracking-wide text-muted">{formatWhen(ev.published_at)}</p>
                <p className="mt-1">
                  <Link to="/companies/$slug" params={{ slug: ev.entity_slug }} className="font-medium hover:underline">
                    {ev.entity_name}
                  </Link>
                </p>
                <p className="text-sm text-muted">{ev.summary}</p>
                <p className="mt-1 text-sm">
                  <Link to="/evidence/$id" params={{ id: ev.evidence_id }} className="underline underline-offset-4">
                    New evidence
                  </Link>
                  {ev.previous_evidence_id ? (
                    <>
                      {" · "}
                      <Link to="/evidence/$id" params={{ id: ev.previous_evidence_id }} className="underline underline-offset-4">
                        Previous evidence
                      </Link>
                    </>
                  ) : null}
                </p>
              </li>
            ))}
          </ol>
        )}
        <Pagination page={page} pageSize={pageSize} total={total} href={(p) => `/updates?page=${p}`} />
      </div>
    </PublicShell>
  );
}
