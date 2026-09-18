import { createFileRoute, Link } from "@tanstack/react-router";
import { EmptyState, Select } from "@/components/ui";
import { listReviewQueue } from "@/lib/bee/admin.functions";
import { relativeTime } from "@/lib/bee/format";
import { REVIEW_TYPES } from "@/lib/bee/constants";

export const Route = createFileRoute("/admin/review/")({
  validateSearch: (s: Record<string, unknown>): { status?: string; type?: string } => ({
    status: typeof s.status === "string" && s.status ? s.status : undefined,
    type: typeof s.type === "string" && s.type ? s.type : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => listReviewQueue({ data: { status: deps.status, type: deps.type || undefined } }),
  component: ReviewQueue,
});

function ReviewQueue() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  return (
    <div>
      <h1 className="font-display text-3xl">Review queue</h1>
      <form className="mt-4 flex gap-2">
        <Select name="status" defaultValue={search.status ?? "pending"} className="max-w-40">
          {["pending", "approved", "rejected", "deferred"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select name="type" defaultValue={search.type} className="max-w-56">
          <option value="">All types</option>
          {REVIEW_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        <button className="text-sm underline" type="submit">
          Filter
        </button>
      </form>
      {!data.items.length ? (
        <div className="mt-6">
          <EmptyState title="No evidence is awaiting review." />
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-rule border-y border-rule">
          {(data.items as Array<{ id: string; type: string; reason: string; generated_at: string; evidence_title: string | null; entity_name: string | null; severity: string }>).map((r) => (
            <li key={r.id} className="py-3">
              <Link to="/admin/review/$id" params={{ id: r.id }} className="font-medium hover:underline">
                {r.type}
              </Link>
              <p className="text-sm text-muted">
                {r.entity_name ?? "No entity"} · {r.evidence_title ?? "No evidence title"} · {r.severity} · {relativeTime(r.generated_at)}
              </p>
              <p className="text-sm">{r.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
