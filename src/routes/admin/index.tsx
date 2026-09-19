import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Button, EmptyState } from "@/components/ui";
import { getDashboard, runMaintenanceFn } from "@/lib/bee/admin.functions";
import { formatWhen, relativeTime } from "@/lib/bee/format";
import { useRouteContext } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/")({
  loader: () => getDashboard(),
  component: Dashboard,
  head: () => ({
    meta: [
      { title: "Admin — The BEE Record" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

function Dashboard() {
  const data = Route.useLoaderData();
  const ctx = useRouteContext({ from: "/admin" });
  const router = useRouter();
  const csrf = ctx.session?.csrf ?? "";
  const c = data.counts;

  async function run(task: "expiry" | "due_sources") {
    await runMaintenanceFn({ data: { csrf, task } });
    await router.invalidate();
  }

  return (
    <div>
      <h1 className="font-display text-3xl">Dashboard</h1>
      <p className="mt-1 text-sm text-muted">
        Live database counts. {data.aiConfigured ? "AI extraction is configured." : "AI extraction is not configured — deterministic parsing and manual claims still work."}
      </p>
      <dl className="mt-6 grid grid-cols-2 gap-px bg-rule md:grid-cols-4">
        <Metric label="Tracked companies" value={c.tracked} />
        <Metric label="Visible companies" value={c.visible} />
        <Metric label="Monitored sources" value={c.sources} />
        <Metric label="Evidence records" value={c.evidence} />
        <Metric label="Current evidence" value={c.current} />
        <Metric label="Historical / superseded" value={c.historical} />
        <Metric label="Expired" value={c.expired} />
        <Metric label="Expiring soon" value={c.expiring} />
        <Metric label="Validity unconfirmed" value={c.unknownValidity} />
        <Metric label="Verification agencies" value={c.verifiers} />
        <Metric label="Review required" value={c.review} />
        <Metric label="Unresolved matches" value={c.matches} />
        <Metric label="Submissions waiting" value={c.submissions} />
        <Metric label="Sources checked (7d)" value={data.period.sources_checked} />
        <Metric label="New evidence (7d)" value={data.period.new_evidence} />
        <Metric label="Extractions (7d)" value={data.period.extracted} />
        <Metric label="Extraction failures (7d)" value={data.period.extract_fail} />
        <Metric label="Auto-published (7d)" value={data.period.auto_pub} />
        <Metric label="Crawler failures (7d)" value={data.period.crawler_fail} />
      </dl>

      <h2 className="mt-10 font-display text-xl">Completeness</h2>
      <p className="mt-1 text-sm text-muted">Public companies missing identity or evidence depth. Use the companies research queues to work these.</p>
      <dl className="mt-4 grid grid-cols-2 gap-px bg-rule md:grid-cols-5">
        <Metric label="No registration" value={data.completeness.noRegistration} />
        <Metric label="No sector" value={data.completeness.noSector} />
        <Metric label="No website" value={data.completeness.noWebsite} />
        <Metric label="Procurement only" value={data.completeness.procurementOnly} />
        <Metric label="No monitored source" value={data.completeness.noMonitoredSource} />
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="ghost" onClick={() => run("expiry")}>
          Recalculate expiries
        </Button>
        <Button variant="ghost" onClick={() => run("due_sources")}>
          Run due source checks
        </Button>
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <List
          title="Pending review"
          empty="No evidence is awaiting review."
          to="/admin/review"
          items={data.pendingReview.map((r) => ({
            to: `/admin/review/${r.id}`,
            title: r.type,
            meta: r.reason,
            extra: relativeTime(r.generated_at),
          }))}
        />
        <List
          title="Newest evidence"
          empty="No evidence records yet."
          to="/admin/evidence"
          items={data.newest.map((r) => ({
            to: `/admin/evidence/${r.id}`,
            title: r.title ?? r.id,
            meta: r.review_state,
            extra: formatWhen(r.created_at),
          }))}
        />
        <List
          title="Source health"
          empty="No monitored sources have been configured."
          to="/admin/sources"
          items={data.staleSources.map((r) => ({
            to: `/admin/sources/${r.id}`,
            title: r.url,
            meta: r.last_error ?? "No recent error",
            extra: r.last_checked_at ? relativeTime(r.last_checked_at) : "never checked",
          }))}
        />
        <List
          title="Upcoming expiries"
          empty="No upcoming expiries."
          to="/admin/evidence"
          items={data.upcoming.map((r) => ({
            to: `/admin/evidence/${r.id}`,
            title: r.title ?? r.id,
            meta: r.expiry_date ?? "",
            extra: "",
          }))}
        />
      </div>
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

function List({
  title,
  empty,
  to,
  items,
}: {
  title: string;
  empty: string;
  to: string;
  items: Array<{ to: string; title: string; meta: string; extra: string }>;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="font-display text-xl">{title}</h2>
        <Link to={to} className="text-sm text-muted hover:text-ink">
          Open
        </Link>
      </div>
      {!items.length ? (
        <EmptyState title={empty} />
      ) : (
        <ul className="divide-y divide-rule border-y border-rule text-sm">
          {items.map((item) => (
            <li key={item.to} className="py-2">
              <Link to={item.to} className="hover:underline">
                {item.title}
              </Link>
              <p className="text-xs text-muted">
                {item.meta} {item.extra}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
