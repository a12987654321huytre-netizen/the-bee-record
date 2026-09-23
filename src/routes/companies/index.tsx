import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public-shell";
import { Button, EmptyState, Input, Select } from "@/components/ui";
import { LevelCell, Pagination, latestFromDirectoryRow } from "@/components/meta";
import { getCompanyDirectory } from "@/lib/bee/public.functions";

type Search = {
  q?: string;
  level?: string;
  sector?: string;
  agency?: string;
  lifecycle?: string;
  evidenceType?: string;
  year?: string;
  page?: number;
};

export const Route = createFileRoute("/companies/")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    q: typeof s.q === "string" ? s.q : undefined,
    level: typeof s.level === "string" ? s.level : undefined,
    sector: typeof s.sector === "string" ? s.sector : undefined,
    agency: typeof s.agency === "string" ? s.agency : undefined,
    lifecycle: typeof s.lifecycle === "string" ? s.lifecycle : undefined,
    evidenceType: typeof s.evidenceType === "string" ? s.evidenceType : undefined,
    year: typeof s.year === "string" ? s.year : undefined,
    page: s.page != null && s.page !== "" ? Number(s.page) || 1 : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getCompanyDirectory({ data: deps }),
  component: Directory,
  head: () => ({ meta: [{ title: "Companies — The BEE Record" }] }),
});

function Directory() {
  const search = Route.useSearch();
  const data = Route.useLoaderData();
  const thisYear = new Date().getUTCFullYear();
  const years = [thisYear, thisYear - 1, thisYear - 2];

  function hrefFor(page: number) {
    const sp = new URLSearchParams();
    if (search.q) sp.set("q", search.q);
    if (search.level) sp.set("level", search.level);
    if (search.sector) sp.set("sector", search.sector);
    if (search.agency) sp.set("agency", search.agency);
    if (search.lifecycle) sp.set("lifecycle", search.lifecycle);
    if (search.evidenceType) sp.set("evidenceType", search.evidenceType);
    if (search.year) sp.set("year", search.year);
    sp.set("page", String(page));
    return `/companies?${sp.toString()}`;
  }

  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
        <h1 className="font-display text-4xl">Companies</h1>
        <p className="mt-2 text-muted">
          Published legal entities with checkable B-BBEE evidence. Each row describes the latest public record we hold —
          a current certificate where one exists, otherwise a dated official disclosure. A reported level is what that
          evidence recorded, not a claim of current verified status.
        </p>
        <form className="mt-6 grid gap-3 md:grid-cols-6">
          <Input name="q" defaultValue={search.q} placeholder="Name or registration" className="md:col-span-2" aria-label="Search companies" />
          <Select name="evidenceType" defaultValue={search.evidenceType ?? ""} aria-label="Evidence type">
            <option value="">All evidence</option>
            <option value="recent_evidence">Recent evidence (2024–2026)</option>
            <option value="current_certificate">Current certificate</option>
            <option value="historical_evidence">Historical evidence only</option>
            <option value="date_not_stated">Date not stated</option>
            <option value="official_procurement_disclosure">Official procurement disclosure</option>
          </Select>
          <Select name="level" defaultValue={search.level ?? ""} aria-label="Reported B-BBEE level">
            <option value="">Any reported level</option>
            {["1", "2", "3", "4", "5", "6", "7", "8", "non-compliant"].map((l) => (
              <option key={l} value={l}>
                {l === "non-compliant" ? "Non-compliant" : `Level ${l}`}
              </option>
            ))}
          </Select>
          <Select name="sector" defaultValue={search.sector ?? ""} aria-label="Sector">
            <option value="">Any sector</option>
            {data.sectors.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}
              </option>
            ))}
          </Select>
          <Select name="agency" defaultValue={search.agency ?? ""} aria-label="Verifier">
            <option value="">Any verifier</option>
            {data.agencies.map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.name}
              </option>
            ))}
          </Select>
          <Button type="submit">Filter</Button>
          <Select name="lifecycle" defaultValue={search.lifecycle ?? ""} aria-label="Certificate state">
            <option value="">Any certificate state</option>
            <option value="current">Current certificate</option>
            <option value="expiring_soon">Expiring soon</option>
            <option value="unknown_validity">Validity unconfirmed</option>
            <option value="expired">Expired certificate</option>
          </Select>
          <Select name="year" defaultValue={search.year ?? ""} aria-label="Evidence year">
            <option value="">Any evidence year</option>
            {years.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </Select>
        </form>

        {!data.items.length ? (
          <div className="mt-8">
            <EmptyState title="No companies have been published yet." body="Nothing is invented to fill this directory." />
          </div>
        ) : (
          <>
            <p className="mt-6 text-sm text-muted">{data.total} published {data.total === 1 ? "company" : "companies"}.</p>
            <div className="mt-4 hidden overflow-x-auto md:block">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-y border-rule text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Company</th>
                    <th className="py-2 pr-3 font-medium">Latest public evidence</th>
                    <th className="py-2 pr-3 font-medium">Reported B-BBEE level</th>
                    <th className="py-2 pr-3 font-medium">Evidence date</th>
                    <th className="py-2 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => {
                    const latest = latestFromDirectoryRow(row);
                    return (
                      <tr key={row.id} className="border-b border-rule">
                        <td className="py-3 pr-3">
                          <Link to="/companies/$slug" params={{ slug: row.slug }} className="font-medium hover:underline">
                            {row.canonical_name}
                          </Link>
                          <div className="text-xs text-muted">{row.registration_number ?? "Reg. unknown"}</div>
                        </td>
                        <td className="py-3 pr-3">{latest.label}</td>
                        <td className="py-3 pr-3">
                          <LevelCell level={latest.level} />
                        </td>
                        <td className="py-3 pr-3">
                          {latest.date.stated ? (
                            <span className="tabular-nums">{latest.date.label}</span>
                          ) : (
                            <span className="text-muted">Not stated in source</span>
                          )}
                        </td>
                        <td className="py-3">
                          {latest.sourceUrl ? (
                            <a href={latest.sourceUrl} className="underline underline-offset-4" rel="noreferrer">
                              {latest.source}
                            </a>
                          ) : (
                            latest.source
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul className="mt-6 divide-y divide-rule border-y border-rule md:hidden">
              {data.items.map((row) => {
                const latest = latestFromDirectoryRow(row);
                return (
                  <li key={row.id} className="py-3">
                    <Link to="/companies/$slug" params={{ slug: row.slug }} className="font-medium hover:underline">
                      {row.canonical_name}
                    </Link>
                    <p className="mt-1 text-sm">
                      <LevelCell level={latest.level} />
                    </p>
                    <p className="text-sm text-muted">{latest.label}</p>
                    <p className="text-sm text-muted">{latest.source}</p>
                    <p className="text-sm text-muted">
                      {latest.date.stated ? latest.date.label : "Not stated in source"}
                    </p>
                  </li>
                );
              })}
            </ul>
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              href={hrefFor}
            />
          </>
        )}
      </div>
    </PublicShell>
  );
}
