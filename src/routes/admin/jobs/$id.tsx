import { createFileRoute, useRouter, useRouteContext } from "@tanstack/react-router";
import { useEffect } from "react";
import { Button } from "@/components/ui";
import { getJobFn, retryJobFn, stopEnrichmentFn } from "@/lib/bee/admin.functions";
import { formatWhen } from "@/lib/bee/format";

export const Route = createFileRoute("/admin/jobs/$id")({
  loader: ({ params }) => getJobFn({ data: { id: params.id } }),
  component: JobDetail,
});

function JobDetail() {
  const { job, events, run } = Route.useLoaderData() as {
    job: Record<string, string | number | null>;
    events: Array<{ id: string; at: string; level: string; message: string }>;
    run: {
      id: string;
      status: string;
      attempted: number;
      enriched: number;
      certificates_found: number;
      registrations_found: number;
      domains_found: number;
      sectors_added: number;
      sources_added: number;
      reviews_created: number;
      errors: number;
      current_company: string | null;
      batch_size: number;
      stop_requested: number;
    } | null;
  };
  const ctx = useRouteContext({ from: "/admin" });
  const router = useRouter();
  const csrf = ctx.session?.csrf ?? "";
  const j = job;
  const live = run && (run.status === "queued" || run.status === "processing");

  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => {
      void router.invalidate();
    }, 2000);
    return () => clearInterval(t);
  }, [live, router]);

  return (
    <div>
      <h1 className="font-mono text-xl">{String(j.id)}</h1>
      <p className="text-sm">
        {String(j.type)} · {String(j.state)} · attempt {String(j.attempt)}
      </p>
      {j.error ? <p className="text-rust">{String(j.error)}</p> : null}

      {run ? (
        <dl className="mt-6 grid grid-cols-2 gap-px bg-rule md:grid-cols-4">
          <JobMetric label="Status" value={run.status} />
          <JobMetric label="Current company" value={run.current_company ?? "—"} />
          <JobMetric label="Companies attempted" value={String(run.attempted)} />
          <JobMetric label="Companies enriched" value={String(run.enriched)} />
          <JobMetric label="Certificates found" value={String(run.certificates_found)} />
          <JobMetric label="Registration numbers found" value={String(run.registrations_found)} />
          <JobMetric label="Domains found" value={String(run.domains_found)} />
          <JobMetric label="Sectors added" value={String(run.sectors_added)} />
          <JobMetric label="Monitoring sources added" value={String(run.sources_added)} />
          <JobMetric label="Review items created" value={String(run.reviews_created)} />
          <JobMetric label="Errors" value={String(run.errors)} />
          <JobMetric label="Batch size" value={String(run.batch_size)} />
        </dl>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {run && (run.status === "queued" || run.status === "processing") ? (
          <Button
            variant="ghost"
            onClick={async () => {
              await stopEnrichmentFn({ data: { csrf, runId: run.id } });
              await router.invalidate();
            }}
          >
            Stop after current company
          </Button>
        ) : null}
        <Button
          variant="ghost"
          onClick={async () => {
            await retryJobFn({ data: { csrf, jobId: String(j.id) } });
            await router.invalidate();
          }}
        >
          Retry (idempotent)
        </Button>
      </div>
      <ol className="mt-6 space-y-2 text-sm">
        {events.map((e) => (
          <li key={e.id}>
            <span className="font-mono text-xs text-muted">{formatWhen(e.at)}</span> {e.level}: {e.message}
          </li>
        ))}
      </ol>
    </div>
  );
}

function JobMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-cream px-3 py-3">
      <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
