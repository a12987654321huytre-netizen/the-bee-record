import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public-shell";
import { Button, EmptyState, Input } from "@/components/ui";
import { CompanySummary, Pagination, latestFromDirectoryRow } from "@/components/meta";
import { searchPublic } from "@/lib/bee/public.functions";
import { formatEvidenceDate } from "@/lib/bee/format";

type Search = { q?: string; page?: number };

export const Route = createFileRoute("/search")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    q: typeof s.q === "string" && s.q ? s.q : undefined,
    page: s.page != null && s.page !== "" ? Number(s.page) || 1 : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => searchPublic({ data: { q: deps.q, page: deps.page } }),
  component: SearchPage,
  head: () => ({ meta: [{ title: "Search — The BEE Record" }] }),
});

function SearchPage() {
  const search = Route.useSearch();
  const data = Route.useLoaderData();
  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
        <h1 className="font-display text-4xl">Search</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Matches canonical names, trading names, aliases and registration numbers. Similar names are listed separately —
          search never merges entities.
        </p>
        <form className="mt-6 flex max-w-2xl flex-col gap-2 sm:flex-row">
          <input type="hidden" name="page" value="1" />
          <label className="sr-only" htmlFor="q">
            Query
          </label>
          <Input id="q" name="q" defaultValue={search.q} placeholder="Name or registration number" />
          <Button type="submit">Search</Button>
        </form>

        {!data.q ? (
          <p className="mt-8 text-muted">Enter a query to search the published index.</p>
        ) : !data.directory.total && !data.agencies.length ? (
          <div className="mt-8">
            <EmptyState title={`No published records match “${data.q}”.`} body="Unknown is left unknown. Try an alias or a registration number." />
          </div>
        ) : (
          <div className="mt-8 grid gap-10 md:grid-cols-3">
            <section className="md:col-span-2">
              <h2 className="font-display text-2xl">Companies</h2>
              <ul className="mt-3 divide-y divide-rule border-t border-rule">
                {data.directory.items.map((row) => {
                  const latest = latestFromDirectoryRow(row);
                  const expiryLabel =
                    latest.kind === "current_certificate" || latest.kind === "expiring_soon"
                      ? latest.expiry
                        ? formatEvidenceDate(latest.expiry, "day")
                        : null
                      : null;
                  return (
                    <li key={row.id} className="flex flex-wrap justify-between gap-2 py-3">
                      <div>
                        <Link to="/companies/$slug" params={{ slug: row.slug }} className="font-medium hover:underline">
                          {row.canonical_name}
                        </Link>
                        <p className="text-sm text-muted">{row.registration_number ?? "Registration number not found in published evidence"}</p>
                      </div>
                      <CompanySummary
                        latestKind={latest.kind}
                        latestLevel={latest.level}
                        latestSource={latest.source}
                        latestDateLabel={latest.date.stated ? latest.date.label : null}
                        expiryDateLabel={expiryLabel}
                      />
                    </li>
                  );
                })}
              </ul>
              <Pagination
                page={data.directory.page}
                pageSize={data.directory.pageSize}
                total={data.directory.total}
                href={(p) => `/search?q=${encodeURIComponent(data.q)}&page=${p}`}
              />
            </section>
            <section>
              <h2 className="font-display text-2xl">Verifiers</h2>
              {data.agencies.length ? (
                <ul className="mt-3 divide-y divide-rule border-t border-rule">
                  {data.agencies.map((a) => (
                    <li key={a.id} className="py-3">
                      <Link to="/verifiers/$slug" params={{ slug: a.slug }} className="hover:underline">
                        {a.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-muted">No matching verification agencies.</p>
              )}
            </section>
          </div>
        )}
      </div>
    </PublicShell>
  );
}
