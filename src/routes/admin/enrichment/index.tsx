import { createFileRoute, Link, useRouter, useRouteContext } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Select } from "@/components/ui";
import { getEnrichmentAdmin, runEnrichmentPassFn } from "@/lib/bee/admin.functions";
import { formatWhen } from "@/lib/bee/format";

export const Route = createFileRoute("/admin/enrichment/")({
  loader: () => getEnrichmentAdmin(),
  component: EnrichmentAdmin,
  head: () => ({
    meta: [
      { title: "Enrichment — The BEE Record" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

function EnrichmentAdmin() {
  const data = Route.useLoaderData();
  const ctx = useRouteContext({ from: "/admin" });
  const router = useRouter();
  const csrf = ctx.session?.csrf ?? "";
  const [batch, setBatch] = useState<10 | 25 | 50 | 100>(25);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = data.counts;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const result = await runEnrichmentPassFn({ data: { csrf, batchSize: batch } });
      await router.navigate({ to: "/admin/jobs/$id", params: { id: result.jobId } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enrichment failed to start.");
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="font-display text-3xl">Enrichment</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Fill identity and certificate gaps for companies already in the corpus. Existing published evidence is never
        overwritten. Conflicts go to review. Procurement disclosures are not treated as certificates.
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-px bg-rule md:grid-cols-4">
        <Metric label="Eligible for enrichment" value={c.eligible} />
        <Metric label="High priority" value={c.highPriority} />
        <Metric label="Procurement-only companies" value={c.procurementOnly} />
        <Metric label="Missing registration number" value={c.missingRegistration} />
        <Metric label="Missing sector" value={c.missingSector} />
        <Metric label="Missing official domain" value={c.missingDomain} />
        <Metric label="No certificate" value={c.noCertificate} />
        <Metric label="Expired certificate only" value={c.expiredCertificateOnly} />
        <Metric label="No monitored source" value={c.noMonitoredSource} />
      </dl>

      <div className="mt-8 border border-rule bg-cream p-5">
        <h2 className="font-display text-xl">Run enrichment pass</h2>
        <p className="mt-1 text-sm text-muted">
          Processes the highest-priority eligible companies first: registration number, official domain, sector (only
          where already evidenced), current certificate discovery via monitored sources, verifier linking, and official
          monitoring-source creation.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs uppercase tracking-wide text-muted">Batch size</span>
            <Select
              value={String(batch)}
              onChange={(e) => setBatch(Number(e.target.value) as 10 | 25 | 50 | 100)}
              className="w-28"
              aria-label="Batch size"
            >
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </Select>
          </label>
          <Button onClick={() => void run()} disabled={busy}>
            {busy ? "Starting…" : "Run enrichment pass"}
          </Button>
        </div>
        {error ? <p className="mt-2 text-sm text-rust">{error}</p> : null}
      </div>

      <h2 className="mt-10 font-display text-xl">Queue (next 25)</h2>
      <p className="mt-1 text-sm text-muted">Highest-priority eligible companies. Open a company to enrich it alone.</p>
      <table className="mt-3 w-full text-left text-sm">
        <thead className="border-y border-rule text-xs uppercase text-muted">
          <tr>
            <th className="py-2">Company</th>
            <th>Evidence</th>
            <th>Procurement</th>
            <th>Year</th>
          </tr>
        </thead>
        <tbody>
          {data.queue.map((row) => (
            <tr key={row.id} className="border-b border-rule">
              <td className="py-2">
                <Link to="/admin/companies/$id" params={{ id: row.id }} className="hover:underline">
                  {row.canonical_name}
                </Link>
              </td>
              <td>{row.evidence_n}</td>
              <td>{row.procurement_n}</td>
              <td>{row.latest_year ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="mt-10 font-display text-xl">Enrichment history</h2>
      {!data.history.length ? (
        <p className="mt-2 text-sm text-muted">No enrichment passes have been run from admin yet.</p>
      ) : (
        <table className="mt-3 w-full text-left text-sm">
          <thead className="border-y border-rule text-xs uppercase text-muted">
            <tr>
              <th className="py-2">Date</th>
              <th>Batch</th>
              <th>Attempted</th>
              <th>Enriched</th>
              <th>Certificates</th>
              <th>Reg. nos</th>
              <th>Domains</th>
              <th>Sectors</th>
              <th>Reviews</th>
              <th>Errors</th>
            </tr>
          </thead>
          <tbody>
            {data.history.map((row) => (
              <tr key={row.id} className="border-b border-rule">
                <td className="py-2">
                  {row.job_id ? (
                    <Link to="/admin/jobs/$id" params={{ id: row.job_id }} className="hover:underline">
                      {formatWhen(row.created_at)}
                    </Link>
                  ) : (
                    formatWhen(row.created_at)
                  )}
                </td>
                <td>{row.batch_size}</td>
                <td>{row.attempted}</td>
                <td>{row.enriched}</td>
                <td>{row.certificates_found}</td>
                <td>{row.registrations_found}</td>
                <td>{row.domains_found}</td>
                <td>{row.sectors_added}</td>
                <td>{row.reviews_created}</td>
                <td>{row.errors}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-cream px-3 py-3">
      <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="font-display text-2xl tabular-nums">{value}</dd>
    </div>
  );
}
