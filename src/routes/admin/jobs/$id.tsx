import { createFileRoute, useRouter, useRouteContext } from "@tanstack/react-router";
import { Button } from "@/components/ui";
import { getJobFn, retryJobFn } from "@/lib/bee/admin.functions";
import { formatWhen } from "@/lib/bee/format";

export const Route = createFileRoute("/admin/jobs/$id")({
  loader: ({ params }) => getJobFn({ data: { id: params.id } }),
  component: JobDetail,
});

function JobDetail() {
  const { job, events } = Route.useLoaderData();
  const ctx = useRouteContext({ from: "/admin" });
  const router = useRouter();
  const csrf = ctx.session?.csrf ?? "";
  const j = job as Record<string, string | number | null>;
  return (
    <div>
      <h1 className="font-mono text-xl">{String(j.id)}</h1>
      <p className="text-sm">
        {String(j.type)} · {String(j.state)} · attempt {String(j.attempt)}
      </p>
      {j.error ? <p className="text-rust">{String(j.error)}</p> : null}
      <Button
        className="mt-4"
        variant="ghost"
        onClick={async () => {
          await retryJobFn({ data: { csrf, jobId: String(j.id) } });
          await router.invalidate();
        }}
      >
        Retry (idempotent)
      </Button>
      <ol className="mt-6 space-y-2 text-sm">
        {(events as Array<{ id: string; at: string; level: string; message: string }>).map((e) => (
          <li key={e.id}>
            <span className="font-mono text-xs text-muted">{formatWhen(e.at)}</span> {e.level}: {e.message}
          </li>
        ))}
      </ol>
    </div>
  );
}
