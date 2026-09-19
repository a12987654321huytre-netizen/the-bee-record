import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public-shell";
import { Field } from "@/components/ui";
import { DateCell, EvidenceTypeLabel, LifecycleBadge } from "@/components/meta";
import {
  displayOrUnknown,
  formatLevel,
  formatScorecard,
  formatWhen,
  publicStateLabel,
  shortId,
} from "@/lib/bee/format";
import { CLAIM_FIELD_LABELS, DISCLOSURE_FIELD_LABELS, isDisclosureEvidence, type BeeField } from "@/lib/bee/constants";
import {
  canonicalFieldKey,
  extraPublicFields,
  isPublicClaimValue,
  PUBLIC_BBBEE_FIELDS,
  publicLocator,
  type LinkedEntityHint,
} from "@/lib/bee/claim-quality.ts";
import { disclosureInterpretation } from "@/lib/bee/disclosure";
import { getEvidencePage } from "@/lib/bee/public.functions";
import { polishEvidenceTitle, resolveEvidenceDate } from "@/lib/bee/evidence-date";

export const Route = createFileRoute("/evidence/$id")({
  loader: ({ params }) => getEvidencePage({ data: { id: params.id } }),
  component: EvidencePage,
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.evidence.title ?? "Evidence"} — The BEE Record` }],
  }),
});

function EvidencePage() {
  const { evidence, entities, claims, agency, signatory, locations, archived } = Route.useLoaderData();
  const linked: LinkedEntityHint = {
    canonicalName: entities[0]?.canonical_name ?? null,
    aliases: entities.map((e) => e.canonical_name),
  };
  const byField = new Map<string, (typeof claims)[number]>();
  for (const claim of claims) {
    const key = canonicalFieldKey(claim.field_key);
    if (!byField.has(key)) byField.set(key, claim);
  }

  function claimValue(field: string): string | null {
    const claim = byField.get(field);
    const raw = claim?.edited_value?.trim() || claim?.normalized_value || claim?.raw_value || null;
    if (!raw) return null;
    if (!isPublicClaimValue(field, raw, linked)) return null;
    return raw;
  }

  function locatorFor(field: string): string | undefined {
    const loc = publicLocator(byField.get(field)?.source_snippet);
    return loc ? loc : undefined;
  }

  function displayClaim(field: BeeField | string, value: string | null): string {
    if (!value) return displayOrUnknown(null);
    if (field === "bee_level") return formatLevel(value);
    if (field === "scorecard_type") return formatScorecard(value);
    if (field === "certificate_type" || field === "document_type") return publicStateLabel(value);
    return value;
  }

  const extraKeys = extraPublicFields([...byField.keys()]).filter((key) => claimValue(key));
  const signatoryName = isPublicClaimValue("signatory", signatory?.name ?? null)
    ? signatory?.name ?? null
    : claimValue("signatory");
  const disclosure = isDisclosureEvidence(evidence.evidence_type);
  const resolvedDate = resolveEvidenceDate({
    issueDate: evidence.issue_date,
    issueDateRaw: evidence.issue_date_raw,
    precision: evidence.issue_date_precision,
    sourceUrl: evidence.source_url,
    title: evidence.title,
    createdAt: evidence.created_at,
    retrievedAt: evidence.retrieved_at,
    discoveredAt: evidence.discovered_at,
  });
  const displayTitle = polishEvidenceTitle(evidence.title, resolvedDate) ?? evidence.title;
  const statusLabel = disclosure
    ? disclosureInterpretation({
        evidenceType: evidence.evidence_type,
        lifecycle: evidence.lifecycle_state,
        issueDate: resolvedDate.iso ?? evidence.issue_date,
        sourceUrl: evidence.source_url,
        title: evidence.title,
      })
    : evidence.lifecycle_state;

  return (
    <PublicShell>
      <div className="mx-auto max-w-3xl px-4 py-10 md:px-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-forest">Evidence {shortId(evidence.id)}</p>
        <h1 className="mt-2 font-display text-4xl">{displayTitle ?? evidence.id}</h1>
        <p className="mt-3 flex flex-wrap gap-2">
          <LifecycleBadge state={statusLabel} />
          <span className="text-sm text-muted">
            <EvidenceTypeLabel type={evidence.evidence_type} />
          </span>
        </p>
        {disclosure ? (
          <p className="mt-4 border border-rule bg-cream p-3 text-sm">
            This record is an official dated procurement disclosure. It reports the B-BBEE level as published by the
            source for that tender. It is not a current verification certificate, and no expiry date, verifier or
            certificate number has been inferred.
          </p>
        ) : null}

        <h2 className="mt-10 font-display text-2xl">Evidence details</h2>
        <dl className="mt-4">
          <Field
            label="Linked entity"
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
          <Field label="Evidence type" value={<EvidenceTypeLabel type={evidence.evidence_type} />} />
          <Field
            label={disclosure ? "Evidence date" : "Issue date"}
            value={
              resolvedDate.stated ? (
                <span className="tabular-nums">{resolvedDate.label}</span>
              ) : (
                <DateCell
                  value={null}
                  missing={disclosure ? "not_stated" : "not_found"}
                />
              )
            }
          />
          {disclosure ? (
            <Field
              label="Source year"
              value={resolvedDate.year ? String(resolvedDate.year) : displayOrUnknown(null, "not_stated")}
            />
          ) : (
            <Field label="Expiry date" value={<DateCell value={evidence.expiry_date} />} />
          )}
          <Field label="Evidence status" value={<LifecycleBadge state={statusLabel} />} />
          {disclosure ? (
            <Field label="Government institution" value={displayOrUnknown(claimValue("government_institution") ?? evidence.document_issuer)} />
          ) : (
            <>
              <Field
                label="Verification agency"
                value={
                  agency ? (
                    <Link to="/verifiers/$slug" params={{ slug: agency.slug }} className="underline underline-offset-4">
                      {agency.name}
                    </Link>
                  ) : (
                    displayOrUnknown(isPublicClaimValue("verification_agency", evidence.document_issuer) ? evidence.document_issuer : null)
                  )
                }
              />
              <Field label="Signatory" value={displayOrUnknown(signatoryName)} />
            </>
          )}
        </dl>

        <h2 className="mt-10 font-display text-2xl">{disclosure ? "Reported B-BBEE claims" : "B-BBEE claims"}</h2>
        <p className="mt-1 text-sm text-muted">
          {disclosure
            ? "Values copied from the official procurement table. They describe what that source recorded, not current certificate status."
            : "Structured values taken from this document after review or a recorded automation rule."}
        </p>
        <dl className="mt-4">
          {(disclosure ? (["bee_level", "measured_entity", "legal_entity_name"] as BeeField[]) : PUBLIC_BBBEE_FIELDS).map((field) => (
            <Field
              key={field}
              label={field === "scorecard_type" ? "Scorecard / sector code" : CLAIM_FIELD_LABELS[field]}
              value={displayClaim(field, claimValue(field))}
              hint={locatorFor(field)}
            />
          ))}
          {extraKeys.map((key) => (
            <Field
              key={key}
              label={DISCLOSURE_FIELD_LABELS[key as keyof typeof DISCLOSURE_FIELD_LABELS] ?? publicStateLabel(key)}
              value={displayClaim(key, claimValue(key))}
              hint={locatorFor(key)}
            />
          ))}
        </dl>

        <h2 className="mt-10 font-display text-2xl">Source and provenance</h2>
        <dl className="mt-4">
          <Field
            label="Original URL"
            value={
              evidence.source_url ? (
                <a href={evidence.source_url} className="break-all underline underline-offset-4" rel="noreferrer">
                  {evidence.source_url}
                </a>
              ) : (
                displayOrUnknown(null)
              )
            }
          />
          <Field label="Source domain" value={displayOrUnknown(evidence.source_domain)} />
          <Field label="Original source status" value={publicStateLabel(evidence.source_live_status, "unknown")} />
          <Field
            label="Archived copy"
            value={archived ? "Retained (not published as a public file URL)" : "Not stored"}
          />
          <Field
            label="Indexed by The BEE Record"
            value={<DateCell value={evidence.retrieved_at ?? evidence.created_at} missing="unknown" />}
          />
          <Field
            label="Content hash"
            value={
              evidence.content_hash ? (
                <span className="break-all font-mono text-xs">{evidence.content_hash}</span>
              ) : (
                displayOrUnknown(null)
              )
            }
          />
        </dl>

        <h2 className="mt-10 font-display text-2xl">Publication</h2>
        <dl className="mt-4">
          <Field label="Review status" value={publicStateLabel(evidence.review_state)} />
          <Field label="Publication status" value={publicStateLabel(evidence.publication_state)} />
        </dl>

        {!disclosure && extraKeys.length ? (
          <>
            <h2 className="mt-10 font-display text-2xl">Additional extracted claims</h2>
            <dl className="mt-4">
              {extraKeys.map((key) => (
                <Field
                  key={key}
                  label={CLAIM_FIELD_LABELS[key as BeeField] ?? key.replace(/_/g, " ")}
                  value={displayClaim(key, claimValue(key))}
                  hint={locatorFor(key)}
                />
              ))}
            </dl>
          </>
        ) : null}

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
