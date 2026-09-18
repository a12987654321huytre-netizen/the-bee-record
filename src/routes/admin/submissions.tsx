import { createFileRoute, useRouter, useRouteContext } from "@tanstack/react-router";
import { Button, EmptyState } from "@/components/ui";
import { listSubmissionsFn, resolveSubmissionFn } from "@/lib/bee/admin.functions";
import { formatWhen } from "@/lib/bee/format";

export const Route = createFileRoute("/admin/submissions")({
  loader: () => listSubmissionsFn(),
  component: Submissions,
});

function Submissions() {
  const { items } = Route.useLoaderData();
  const ctx = useRouteContext({ from: "/admin" });
  const router = useRouter();
  const csrf = ctx.session?.csrf ?? "";
  return (
    <div>
      <h1 className="font-display text-3xl">Submissions</h1>
      {!items.length ? (
        <div className="mt-6">
          <EmptyState title="No community submissions." />
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-rule border-y border-rule">
          {(items as Array<{ id: string; type: string; company_text: string | null; url: string | null; message: string | null; status: string; created_at: string; submitter_email: string | null }>).map((s) => (
            <li key={s.id} className="py-3 text-sm">
              <p className="font-medium">
                {s.type} · {s.status}
              </p>
              <p>{s.company_text}</p>
              {s.url ? (
                <a href={s.url} className="break-all underline" rel="noreferrer">
                  {s.url}
                </a>
              ) : null}
              <p className="text-muted">{s.message}</p>
              <p className="text-xs text-muted">
                {formatWhen(s.created_at)}
                {s.submitter_email ? ` · contact on file (not public)` : ""}
              </p>
              {s.status === "pending" ? (
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      await resolveSubmissionFn({ data: { csrf, id: s.id, status: "accepted", ingest: Boolean(s.url) } });
                      await router.invalidate();
                    }}
                  >
                    Accept{s.url ? " and ingest" : ""}
                  </Button>
                  <Button
                    variant="danger"
                    onClick={async () => {
                      await resolveSubmissionFn({ data: { csrf, id: s.id, status: "rejected" } });
                      await router.invalidate();
                    }}
                  >
                    Reject
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
