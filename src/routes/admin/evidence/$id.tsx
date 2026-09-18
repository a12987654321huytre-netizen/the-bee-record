import { createFileRoute, Link, useRouter, useRouteContext } from "@tanstack/react-router";
import { Button, Select, Textarea } from "@/components/ui";
import { addNoteFn, getAdminEvidence, relinkEvidenceFn, rerunExtractFn } from "@/lib/bee/admin.functions";
import { formatWhen, shortId } from "@/lib/bee/format";

export const Route = createFileRoute("/admin/evidence/$id")({
  loader: ({ params }) => getAdminEvidence({ data: { id: params.id } }),
  component: EvidenceAdmin,
});

function EvidenceAdmin() {
  const data = Route.useLoaderData();
  const ctx = useRouteContext({ from: "/admin" });
  const router = useRouter();
  const csrf = ctx.session?.csrf ?? "";
  const ev = data.evidence as Record<string, string | number | null>;

  return (
    <div className="grid gap-8 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-6">
        <div>
          <p className="font-mono text-xs">{shortId(String(ev.id))}</p>
          <h1 className="font-display text-3xl">{String(ev.title ?? ev.id)}</h1>
          {ev.publication_state === "published" ? (
            <Link to="/evidence/$id" params={{ id: String(ev.id) }} className="text-sm underline underline-offset-4">
              Public page
            </Link>
          ) : null}
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          {["evidence_type", "lifecycle_state", "review_state", "publication_state", "extraction_state", "validation_state", "source_url", "source_domain", "content_hash", "issue_date", "expiry_date", "mime_type", "byte_size", "source_live_status"].map((k) => (
            <div key={k} className="border-t border-rule py-2">
              <dt className="text-xs uppercase text-muted">{k}</dt>
              <dd className="break-all">{String(ev[k] ?? "—")}</dd>
            </div>
          ))}
        </dl>
        <h2 className="font-display text-xl">Working claims</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-muted">
            <tr>
              <th className="py-1">Field</th>
              <th>Raw</th>
              <th>Normalized / edited</th>
              <th>Conf.</th>
            </tr>
          </thead>
          <tbody>
            {data.claims.map((c) => (
              <tr key={c.id} className="border-t border-rule">
                <td className="py-1 font-mono text-xs">{c.field_key}</td>
                <td>{c.raw_value}</td>
                <td>{c.edited_value ?? c.normalized_value}</td>
                <td>{c.confidence ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2 className="font-display text-xl">Extraction runs</h2>
        <ul className="text-sm">
          {(data.runs as Array<{ id: string; parser: string; success: number; error: string | null; started_at: string; raw_response: string | null }>).map((r) => (
            <li key={r.id} className="border-t border-rule py-2">
              {r.parser} · {r.success ? "ok" : "failed"} · {formatWhen(r.started_at)}
              {r.error ? <p className="text-rust">{r.error}</p> : null}
              {r.raw_response ? (
                <details className="mt-1">
                  <summary>Raw response (admin only)</summary>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs">{r.raw_response}</pre>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
        {!data.aiConfigured ? <p className="text-sm text-muted">AI extraction is not configured.</p> : null}
      </div>
      <aside className="space-y-6 text-sm">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await rerunExtractFn({ data: { csrf, evidenceId: String(ev.id) } });
            await router.invalidate();
          }}
        >
          <Button type="submit">Re-run extraction</Button>
        </form>
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            await relinkEvidenceFn({ data: { csrf, evidenceId: String(ev.id), entityId: String(f.get("entityId")) } });
            await router.invalidate();
          }}
        >
          <Select name="entityId" required>
            {(data.companies as Array<{ id: string; canonical_name: string }>).map((c) => (
              <option key={c.id} value={c.id}>
                {c.canonical_name}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="ghost">
            Relink entity
          </Button>
        </form>
        <div>
          <h2 className="font-display text-xl">Links</h2>
          <ul>
            {(data.links as Array<{ id: string; canonical_name: string | null; entity_id: string | null; link_state: string }>).map((l) => (
              <li key={l.id}>
                {l.entity_id ? (
                  <Link to="/admin/companies/$id" params={{ id: l.entity_id }} className="underline">
                    {l.canonical_name}
                  </Link>
                ) : (
                  "unmatched"
                )}{" "}
                ({l.link_state})
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="font-display text-xl">Review items</h2>
          <ul>
            {(data.reviews as Array<{ id: string; type: string; status: string }>).map((r) => (
              <li key={r.id}>
                <Link to="/admin/review/$id" params={{ id: r.id }} className="underline">
                  {r.type}
                </Link>{" "}
                {r.status}
              </li>
            ))}
          </ul>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            await addNoteFn({ data: { csrf, targetType: "evidence", targetId: String(ev.id), body: String(f.get("body")) } });
            await router.invalidate();
          }}
        >
          <Textarea name="body" required />
          <Button type="submit" variant="ghost" className="mt-2">
            Add note
          </Button>
        </form>
      </aside>
    </div>
  );
}
