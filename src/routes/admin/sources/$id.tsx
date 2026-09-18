import { createFileRoute, Link, useRouter, useRouteContext } from "@tanstack/react-router";
import { Button } from "@/components/ui";
import { crawlNowFn, getSourceFn, toggleSourceFn } from "@/lib/bee/admin.functions";
import { formatWhen } from "@/lib/bee/format";

export const Route = createFileRoute("/admin/sources/$id")({
  loader: ({ params }) => getSourceFn({ data: { id: params.id } }),
  component: SourceDetail,
});

function SourceDetail() {
  const { source, checks, jobs } = Route.useLoaderData();
  const ctx = useRouteContext({ from: "/admin" });
  const router = useRouter();
  const csrf = ctx.session?.csrf ?? "";
  const s = source as Record<string, string | number | null>;
  return (
    <div>
      <h1 className="break-all font-display text-2xl">{String(s.url)}</h1>
      <p className="text-sm text-muted">
        {String(s.source_type)} · {String(s.crawl_frequency)} · consecutive errors {String(s.consecutive_error_count)}
      </p>
      <div className="mt-4 flex gap-2">
        <Button
          onClick={async () => {
            await crawlNowFn({ data: { csrf, sourceId: String(s.id) } });
            await router.invalidate();
          }}
        >
          Crawl now
        </Button>
        <Button
          variant="ghost"
          onClick={async () => {
            await toggleSourceFn({ data: { csrf, sourceId: String(s.id), enabled: !s.enabled } });
            await router.invalidate();
          }}
        >
          {s.enabled ? "Disable" : "Enable"}
        </Button>
      </div>
      <h2 className="mt-8 font-display text-xl">Check history</h2>
      <ul className="text-sm">
        {(checks as Array<{ id: string; started_at: string; http_status: number | null; failure_reason: string | null; changed: number | null; documents_discovered: number }>).map((c) => (
          <li key={c.id} className="border-t border-rule py-2">
            {formatWhen(c.started_at)} · HTTP {c.http_status ?? "—"} · docs {c.documents_discovered} · {c.failure_reason ?? (c.changed ? "changed" : "unchanged")}
          </li>
        ))}
      </ul>
      <h2 className="mt-8 font-display text-xl">Jobs</h2>
      <ul className="text-sm">
        {(jobs as Array<{ id: string; state: string; created_at: string }>).map((j) => (
          <li key={j.id}>
            <Link to="/admin/jobs/$id" params={{ id: j.id }} className="underline">
              {j.id}
            </Link>{" "}
            {j.state}
          </li>
        ))}
      </ul>
    </div>
  );
}
