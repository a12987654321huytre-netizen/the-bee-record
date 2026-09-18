import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public-shell";
import { EmptyState } from "@/components/ui";
import { LevelCell, Pagination } from "@/components/meta";
import { getSectorPage } from "@/lib/bee/public.functions";

export const Route = createFileRoute("/sectors/$slug")({
  validateSearch: (s: Record<string, unknown>): { page?: number } => ({
    page: s.page != null && s.page !== "" ? Number(s.page) || 1 : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ params, deps }) => getSectorPage({ data: { slug: params.slug, page: deps.page } }),
  component: SectorPage,
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.sector.name ?? "Sector"} — The BEE Record` }],
  }),
});

function SectorPage() {
  const { sector, directory } = Route.useLoaderData();
  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-forest">Sector</p>
        <h1 className="mt-2 font-display text-4xl">{sector.name}</h1>
        {sector.description ? <p className="mt-2 text-muted">{sector.description}</p> : null}
        {!directory.items.length ? (
          <div className="mt-8">
            <EmptyState title="No published companies are classified in this sector." />
          </div>
        ) : (
          <>
            <ul className="mt-8 divide-y divide-rule border-y border-rule">
              {directory.items.map((row) => (
                <li key={row.id} className="flex justify-between gap-3 py-3">
                  <Link to="/companies/$slug" params={{ slug: row.slug }} className="font-medium hover:underline">
                    {row.canonical_name}
                  </Link>
                  <LevelCell level={row.bee_level} />
                </li>
              ))}
            </ul>
            <Pagination
              page={directory.page}
              pageSize={directory.pageSize}
              total={directory.total}
              href={(p) => `/sectors/${sector.slug}?page=${p}`}
            />
          </>
        )}
      </div>
    </PublicShell>
  );
}
