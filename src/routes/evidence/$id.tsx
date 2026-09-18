import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public-shell";
import { Field } from "@/components/ui";
import { DateCell, EvidenceTypeLabel, LifecycleBadge } from "@/components/meta";
import { displayOrUnknown, formatWhen, shortId } from "@/lib/bee/format";
import { CLAIM_FIELD_LABELS, type BeeField } from "@/lib/bee/constants";
import { getEvidencePage } from "@/lib/bee/public.functions";

export const Route = createFileRoute("/evidence/$id")({
  loader: ({ params }) => getEvidencePage({ data: { id: params.id } }),
  component: EvidencePage,
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.evidence.title ?? "Evidence"} — The BEE Record` }],
  }),
});

function EvidencePage() {
  const { evidence, entities, claims, agency, signatory, locations, archived } = Route.useLoaderData();
  return (
    <PublicShell>
      <div className="mx-auto max-w-3xl px-4 py-10 md:px-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-forest">Evidence {shortId(evidence.id)}</p>
        <h1 className="mt-2 font-display text-4xl">{evidence.title ?? evidence.id}</h1>
        <p className="mt-3 flex flex-wrap gap-2">
          <LifecycleBadge state={evidence.lifecycle_state} />
          <span className="text-sm text-muted">
            <EvidenceTypeLabel type={evidence.evidence_type} />
          </span>
        </p>
        <dl className="mt-8">
          <Field
            label="Linked entities"
            value={
              entities.length
                ? entities.map((e) => (
                    <Link key={e.id} to="/companies/$slug" params={{ slug: e.slug }} className="mr-3 underline underline-offset-4">
                      {e.canonical_name}
                    </Link>
                  ))
                : displayOrUnknown(null)
            }
          />
          <Field label="Issue date" value={<DateCell value={evidence.issue_date} />} />
          <Field label="Expiry date" value={<DateCell value={evidence.expiry_date} />} />
          <Field
            label="Original URL"
            value={
              evidence.source_url ? (
                <a href={evidence.source_url} className="break-all underline underline-offset-4" rel="noreferrer">
                  {evidence.source_url}
                </a>
              ) : (
                displayOrUnknown(null, "unknown")
              )
            }
          />
          <Field label="Source domain" value={displayOrUnknown(evidence.source_domain, "unknown")} />
          <Field label="Original source" value={evidence.source_live_status} />
          <Field label="Archived copy" value={archived ? "Retained (not published as a public file URL)" : "Not stored"} />
          <Field
            label="Verifier"
            value={
              agency ? (
                <Link to="/verifiers/$slug" params={{ slug: agency.slug }} className="underline underline-offset-4">
                  {agency.name}
                </Link>
              ) : (
                displayOrUnknown(evidence.document_issuer)
              )
            }
          />
          <Field label="Signatory" value={displayOrUnknown(signatory?.name)} />
          <Field label="Retrieved" value={formatWhen(evidence.retrieved_at)} />
          <Field label="Content hash" value={<span className="break-all font-mono text-xs">{evidence.content_hash ?? displayOrUnknown(null, "unknown")}</span>} />
          <Field label="Review" value={evidence.review_state} />
          <Field label="Publication" value={evidence.publication_state} />
        </dl>

        <h2 className="mt-10 font-display text-2xl">Published claims</h2>
        <p className="mt-1 text-sm text-muted">These are the structured values taken from this document after review or a recorded automation rule.</p>
        {claims.length ? (
          <dl className="mt-4">
            {claims.map((c) => (
              <Field
                key={c.id}
                label={CLAIM_FIELD_LABELS[c.field_key as BeeField] ?? c.field_key}
                value={c.edited_value ?? c.normalized_value ?? c.raw_value ?? displayOrUnknown(null)}
                hint={c.source_snippet ? `Locator: ${c.source_snippet}` : undefined}
              />
            ))}
          </dl>
        ) : (
          <p className="mt-3 text-sm text-muted">No structured claims have been published from this document.</p>
        )}

        {locations.length ? (
          <>
            <h2 className="mt-10 font-display text-2xl">Known locations</h2>
            <ul className="mt-3 divide-y divide-rule border-y border-rule text-sm">
              {locations.map((l) => (
                <li key={l.url} className="py-2">
                  <a href={l.url} className="break-all underline underline-offset-4" rel="noreferrer">
                    {l.url}
                  </a>
                  <p className="text-xs text-muted">Last seen {formatWhen(l.last_seen_at)}</p>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </PublicShell>
  );
}
