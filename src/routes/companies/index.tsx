import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public-shell";
import { Button, EmptyState, Input, Select } from "@/components/ui";
import { DateCell, LevelCell, LifecycleBadge, Pagination } from "@/components/meta";
import { getCompanyDirectory } from "@/lib/bee/public.functions";
import { companyInterpretation } from "@/lib/bee/disclosure";
import { isModernProcurementEvidence } from "@/lib/bee/recency";

type Search = {
  q?: string;
  level?: string;
  sector?: string;
  agency?: string;
  lifecycle?: string;
  page?: number;
};

export const Route = createFileRoute("/companies/")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    q: typeof s.q === "string" ? s.q : undefined,
    level: typeof s.level === "string" ? s.level : undefined,
    sector: typeof s.sector === "string" ? s.sector : undefined,
    agency: typeof s.agency === "string" ? s.agency : undefined,
    lifecycle: typeof s.lifecycle === "string" ? s.lifecycle : undefined,
    page: s.page != null && s.page !== "" ? Number(s.page) || 1 : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getCompanyDirectory({ data: deps }),
  component: Directory,
  head: () => ({ meta: [{ title: "Companies — The BEE Record" }] }),
});

function rowState(row: {
  lifecycle_state: string | null;
  current_evidence_type?: string | null;
  has_disclosure?: boolean | number | string | null;
  disclosure_date?: string | null;
  disclosure_url?: string | null;
  disclosure_title?: string | null;
}) {
  const hasDisclosure = Boolean(row.has_disclosure);
  return companyInterpretation({
    currentLifecycle: row.lifecycle_state,
    currentEvidenceType: row.current_evidence_type ?? null,
    hasDisclosure,
    disclosureModern: hasDisclosure
      ? isModernProcurementEvidence({
          issueDate: row.disclosure_date,
          sourceUrl: row.disclosure_url,
          title: row.disclosure_title,
        })
      : null,
  });
}

function Directory() {
  const search = Route.useSearch();
  const data = Route.useLoaderData();
  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
        <h1 className="font-display text-4xl">Companies</h1>
        <p className="mt-2 text-muted">
          Published legal entities with checkable B-BBEE evidence. Certificate columns show a current verification
          certificate only. Official procurement disclosures are labelled separately and are not current certificates.
        </p>
        <form className="mt-6 grid gap-3 md:grid-cols-6">
          <Input name="q" defaultValue={search.q} placeholder="Name or registration" className="md:col-span-2" aria-label="Search companies" />
          <Select name="level" defaultValue={search.level ?? ""} aria-label="B-BBEE level">
            <option value="">Any current certificate level</option>
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
          <Select name="lifecycle" defaultValue={search.lifecycle ?? ""} aria-label="Evidence state">
            <option value="">Any certificate state</option>
            <option value="current">Current certificate</option>
            <option value="expiring_soon">Expiring soon</option>
            <option value="unknown_validity">Validity unconfirmed</option>
            <option value="expired">Expired certificate</option>
          </Select>
          <Button type="submit">Filter</Button>
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
                    <th className="py-2 pr-3 font-medium">Current certificate</th>
                    <th className="py-2 pr-3 font-medium">Expires</th>
                    <th className="py-2 pr-3 font-medium">State</th>
                    <th className="py-2 font-medium">Verifier</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => {
                    const state = rowState(row);
                    const currentCert = state === "current_certificate" || state === "expiring_soon";
                    return (
                      <tr key={row.id} className="border-b border-rule">
                        <td className="py-3 pr-3">
                          <Link to="/companies/$slug" params={{ slug: row.slug }} className="font-medium hover:underline">
                            {row.canonical_name}
                          </Link>
                          <div className="text-xs text-muted">{row.registration_number ?? "Reg. unknown"}</div>
                        </td>
                        <td className="py-3 pr-3">
                          {currentCert ? <LevelCell level={row.bee_level} /> : <span className="text-muted">Not found</span>}
                        </td>
                        <td className="py-3 pr-3">
                          {currentCert ? <DateCell value={row.expiry_date} /> : <span className="text-muted">—</span>}
                        </td>
                        <td className="py-3 pr-3">
                          <LifecycleBadge state={state} />
                        </td>
                        <td className="py-3 text-muted">
                          {currentCert ? (row.agency_name ?? "Not found in published evidence") : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul className="mt-6 divide-y divide-rule border-y border-rule md:hidden">
              {data.items.map((row) => {
                const state = rowState(row);
                const currentCert = state === "current_certificate" || state === "expiring_soon";
                return (
                  <li key={row.id} className="py-3">
                    <Link to="/companies/$slug" params={{ slug: row.slug }} className="font-medium hover:underline">
                      {row.canonical_name}
                    </Link>
                    <p className="mt-1 flex flex-wrap gap-2 text-sm text-muted">
                      {currentCert ? <LevelCell level={row.bee_level} /> : <span>No current certificate</span>}
                      <LifecycleBadge state={state} />
                      {currentCert ? <DateCell value={row.expiry_date} /> : null}
                    </p>
                  </li>
                );
              })}
            </ul>
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              href={(p) => {
                const sp = new URLSearchParams();
                if (search.q) sp.set("q", search.q);
                if (search.level) sp.set("level", search.level);
                if (search.sector) sp.set("sector", search.sector);
                if (search.lifecycle) sp.set("lifecycle", search.lifecycle);
                sp.set("page", String(p));
                return `/companies?${sp.toString()}`;
              }}
            />
          </>
        )}
      </div>
    </PublicShell>
  );
}