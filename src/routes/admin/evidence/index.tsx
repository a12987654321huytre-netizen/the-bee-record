import { createFileRoute, Link, useRouter, useRouteContext } from "@tanstack/react-router";
import { Button, EmptyState, Input, Select, Textarea } from "@/components/ui";
import { ingestEvidenceFn, listAdminEvidence } from "@/lib/bee/admin.functions";
import { formatWhen } from "@/lib/bee/format";
import { EVIDENCE_TYPE_LABELS } from "@/lib/bee/constants";
import { useState } from "react";

export const Route = createFileRoute("/admin/evidence/")({
  validateSearch: (s: Record<string, unknown>): { q?: string; state?: string; review?: string; page?: number } => ({
    q: typeof s.q === "string" && s.q ? s.q : undefined,
    state: typeof s.state === "string" && s.state ? s.state : undefined,
    review: typeof s.review === "string" && s.review ? s.review : undefined,
    page: s.page != null && s.page !== "" ? Number(s.page) || 1 : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => listAdminEvidence({ data: deps }),
  component: EvidenceList,
});

function EvidenceList() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const ctx = useRouteContext({ from: "/admin" });
  const router = useRouter();
  const csrf = ctx.session?.csrf ?? "";
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div>
      <h1 className="font-display text-3xl">Evidence</h1>
      <form className="mt-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={search.q} placeholder="Title, URL or ID" className="max-w-xs" />
        <Select name="state" defaultValue={search.state} className="max-w-40">
          <option value="">Any lifecycle</option>
          {["discovered", "current", "historical", "superseded", "expired", "expiring_soon"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select name="review" defaultValue={search.review} className="max-w-40">
          <option value="">Any review</option>
          {["none", "required", "approved", "rejected"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="ghost">
          Filter
        </Button>
      </form>

      <form
        className="mt-6 space-y-2 border border-rule p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const result = await ingestEvidenceFn({
            data: {
              csrf,
              url: String(f.get("url") || "") || undefined,
              text: String(f.get("text") || "") || undefined,
              title: String(f.get("title") || "") || undefined,
              evidenceType: String(f.get("evidenceType") || "") || undefined,
              entityId: String(f.get("entityId") || "") || undefined,
            },
          });
          if ("ok" in result && result.ok === false) {
            setMsg(result.error);
            return;
          }
          if (!("duplicate" in result)) {
            setMsg("Ingest did not return a result.");
            return;
          }
          setMsg(result.duplicate ? "Duplicate document — existing evidence recorded." : "Evidence ingested.");
          await router.invalidate();
          if ("evidenceId" in result) {
            await router.navigate({ to: "/admin/evidence/$id", params: { id: result.evidenceId } });
          }
        }}
      >
        <p className="text-sm text-muted">Add a public URL or paste text. Documents are hashed. Duplicates are not recreated.</p>
        <Input name="url" placeholder="https://…" aria-label="Source URL" />
        <Input name="title" placeholder="Title" aria-label="Title" />
        <div className="grid gap-2 md:grid-cols-2">
          <Select name="evidenceType" defaultValue="bee_certificate" aria-label="Evidence type">
            {Object.entries(EVIDENCE_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Input name="entityId" placeholder="Entity ID (optional)" aria-label="Entity ID" />
        </div>
        <Textarea name="text" placeholder="Or paste certificate / page text" aria-label="Pasted text" />
        <Button type="submit">Ingest evidence</Button>
        {msg ? <p className="text-sm">{msg}</p> : null}
      </form>

      {!data.items.length ? (
        <div className="mt-6">
          <EmptyState title="No evidence records." />
        </div>
      ) : (
        <table className="mt-6 w-full text-left text-sm">
          <thead className="border-y border-rule text-xs uppercase text-muted">
            <tr>
              <th className="py-2 font-medium">Title</th>
              <th className="py-2 font-medium">Lifecycle</th>
              <th className="py-2 font-medium">Review</th>
              <th className="py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {(data.items as Array<{ id: string; title: string | null; lifecycle_state: string; review_state: string; created_at: string }>).map((row) => (
              <tr key={row.id} className="border-b border-rule">
                <td className="py-2">
                  <Link to="/admin/evidence/$id" params={{ id: row.id }} className="hover:underline">
                    {row.title ?? row.id}
                  </Link>
                </td>
                <td>{row.lifecycle_state}</td>
                <td>{row.review_state}</td>
                <td>{formatWhen(row.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
