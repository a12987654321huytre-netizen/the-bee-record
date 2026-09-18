import { createFileRoute, Link, useRouter, useRouteContext } from "@tanstack/react-router";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { approveReviewFn, rejectReviewFn, getReviewItem } from "@/lib/bee/admin.functions";
import { CLAIM_FIELD_LABELS, type BeeField } from "@/lib/bee/constants";
import { formatWhen } from "@/lib/bee/format";
import { useState } from "react";

export const Route = createFileRoute("/admin/review/$id")({
  loader: ({ params }) => getReviewItem({ data: { id: params.id } }),
  component: ReviewItem,
});

function ReviewItem() {
  const data = Route.useLoaderData();
  const ctx = useRouteContext({ from: "/admin" });
  const router = useRouter();
  const csrf = ctx.session?.csrf ?? "";
  const item = data.item;
  const evidence = data.evidence as Record<string, string | null> | null;
  const current = data.current as Record<string, string | null> | null;
  const [error, setError] = useState<string | null>(null);
  const payload = (() => {
    if (!item.payload) return {} as Record<string, unknown>;
    try {
      return JSON.parse(item.payload) as Record<string, unknown>;
    } catch {
      return {} as Record<string, unknown>;
    }
  })();

  const claimMap = new Map(data.claims.map((c) => [c.field_key, c]));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section>
        <p className="font-mono text-xs text-muted">
          {item.type} · rev {item.revision}
        </p>
        <h1 className="font-display text-3xl">Review</h1>
        <p className="mt-2 text-sm">{item.reason}</p>
        {evidence ? (
          <div className="mt-4 border border-rule p-4 text-sm">
            <p className="font-medium">{evidence.title}</p>
            <p className="break-all text-muted">{evidence.source_url}</p>
            <p>
              issued {formatWhen(evidence.issue_date)} · expires {formatWhen(evidence.expiry_date)} · {evidence.source_domain}
            </p>
            <p className="mt-2">
              <Link to="/admin/evidence/$id" params={{ id: String(evidence.id) }} className="underline">
                Open evidence
              </Link>
              {evidence.source_url ? (
                <>
                  {" · "}
                  <a href={evidence.source_url} className="underline" rel="noreferrer">
                    Open source
                  </a>
                </>
              ) : null}
            </p>
            {data.runs[0] && "raw_response" in data.runs[0] && data.runs[0].raw_response ? (
              <details className="mt-3">
                <summary>Raw extraction</summary>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs">{String(data.runs[0].raw_response)}</pre>
              </details>
            ) : null}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted">No evidence attached.</p>
        )}
        {"flags" in payload && Array.isArray(payload.flags) ? (
          <div className="mt-4 text-sm">
            <h2 className="font-display text-xl">Validation</h2>
            <ul className="list-disc pl-5">
              {(payload.flags as Array<{ code: string; message: string; severity: string }>).map((f, i) => (
                <li key={i}>
                  {f.severity}: {f.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section>
        <h2 className="font-display text-xl">Diff</h2>
        <table className="mt-2 w-full text-left text-sm">
          <thead className="text-xs uppercase text-muted">
            <tr>
              <th className="py-1">Field</th>
              <th>Published</th>
              <th>Proposed</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(CLAIM_FIELD_LABELS).map((field) => {
              const proposed = claimMap.get(field);
              const currentVal = currentField(current, field);
              const next = proposed?.edited_value ?? proposed?.normalized_value ?? proposed?.raw_value ?? "";
              const changed = Boolean(next) && next !== (currentVal ?? "");
              return (
                <tr key={field} className="border-t border-rule">
                  <td className="py-1">{CLAIM_FIELD_LABELS[field as BeeField]}</td>
                  <td className={changed && currentVal ? "text-rust line-through" : "text-muted"}>{currentVal ?? "—"}</td>
                  <td className={changed ? "text-sage" : ""}>{next || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {item.status === "pending" || item.status === "in_review" ? (
          <form
            className="mt-6 space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              const f = new FormData(e.currentTarget);
              const edits: Record<string, string> = {};
              for (const [k, v] of f.entries()) {
                if (k.startsWith("edit_") && String(v).trim()) edits[k.slice(5)] = String(v);
              }
              const result = await approveReviewFn({
                data: {
                  csrf,
                  reviewItemId: item.id,
                  revision: item.revision,
                  entityId: String(f.get("entityId")),
                  evidenceId: item.evidence_id ?? "",
                  edits,
                  reason: String(f.get("reason") || "") || undefined,
                },
              });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              await router.invalidate();
              await router.navigate({ to: "/admin/review" });
            }}
          >
            <div>
              <Label htmlFor="entityId">Publish against entity</Label>
              <Select id="entityId" name="entityId" className="mt-1" defaultValue={item.entity_id ?? ""} required>
                {(data.companies as Array<{ id: string; canonical_name: string }>).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.canonical_name}
                  </option>
                ))}
              </Select>
            </div>
            {data.claims.map((c) => (
              <div key={c.id}>
                <Label htmlFor={`edit_${c.field_key}`}>Edit {c.field_key} before approval</Label>
                <Input
                  id={`edit_${c.field_key}`}
                  name={`edit_${c.field_key}`}
                  className="mt-1"
                  defaultValue={c.edited_value ?? c.normalized_value ?? c.raw_value ?? ""}
                />
              </div>
            ))}
            <Textarea name="reason" placeholder="Approval note" />
            {error ? <p className="text-rust">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit">Approve and publish</Button>
              <Button
                type="button"
                variant="danger"
                onClick={async () => {
                  const reason = window.prompt("Rejection reason") ?? "";
                  const result = await rejectReviewFn({
                    data: { csrf, reviewItemId: item.id, revision: item.revision, reason: reason || undefined },
                  });
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  await router.invalidate();
                  await router.navigate({ to: "/admin/review" });
                }}
              >
                Reject
              </Button>
            </div>
          </form>
        ) : (
          <p className="mt-4 text-sm">Resolved: {item.status}</p>
        )}
      </section>
    </div>
  );
}

function currentField(state: Record<string, string | null> | null, field: string): string | null {
  if (!state) return null;
  switch (field) {
    case "bee_level":
      return state.bee_level;
    case "recognition_level":
      return state.recognition_level;
    case "scorecard_type":
      return state.scorecard_type;
    case "certificate_type":
      return state.certificate_type;
    case "issue_date":
      return state.issue_date;
    case "expiry_date":
      return state.expiry_date;
    case "registration_number":
      return state.registration_number;
    default:
      return null;
  }
}
