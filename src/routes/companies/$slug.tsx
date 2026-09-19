import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public-shell";
import { EmptyState, Field } from "@/components/ui";
import { DateCell, EvidenceTypeLabel, LevelCell, LifecycleBadge } from "@/components/meta";
import { displayOrUnknown, formatWhen, publicStateLabel } from "@/lib/bee/format";
import { CLAIM_FIELD_LABELS, INTERPRETATION_LABELS, isDisclosureEvidence, type BeeField } from "@/lib/bee/constants";
import { companyInterpretation, disclosureInterpretation } from "@/lib/bee/disclosure";
import { getCompanyPage } from "@/lib/bee/public.functions";

export const Route = createFileRoute("/companies/$slug")({
  loader: ({ params }) => getCompanyPage({ data: { slug: params.slug } }),
  component: CompanyPage,
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.entity?.canonical_name ?? "Company"} — The BEE Record` }],
  }),
});

function CompanyPage() {
  const data = Route.useLoaderData();
  const entity = data.entity!;
  const current = data.current;
  const supporting = data.supporting;
  const disclosures = data.evidence.filter((ev) => isDisclosureEvidence(ev.evidence_type));
  const otherEvidence = data.evidence.filter((ev) => !isDisclosureEvidence(ev.evidence_type));
  const currentIsDisclosure = current?.evidence_id
    ? isDisclosureEvidence(data.evidence.find((ev) => ev.id === current.evidence_id)?.evidence_type)
    : false;
  const interpretation = companyInterpretation({
    currentLifecycle: currentIsDisclosure ? null : current?.lifecycle_state,
    currentEvidenceType: currentIsDisclosure
      ? null
      : (data.evidence.find((ev) => ev.id === current?.evidence_id)?.evidence_type ?? null),
    hasDisclosure: disclosures.length > 0,
  });
  const showCertificateFields = interpretation === "current_certificate" || interpretation === "expiring_soon";
  const supportingCertificate = supporting && !isDisclosureEvidence(supporting.evidence_type) ? supporting : null;

  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-forest">Published entity</p>
        <h1 className="mt-2 font-display text-4xl">{entity.canonical_name}</h1>
        <p className="mt-2 text-muted">
          {entity.legal_name && entity.legal_name !== entity.canonical_name ? `${entity.legal_name} · ` : null}
          {entity.registration_number ?? "Registration number not found in published evidence"}
        </p>

        <div className="mt-8 grid gap-10 lg:grid-cols-3">
          <section className="lg:col-span-2">
            <h2 className="font-display text-2xl">Current B-BBEE certificate</h2>
            <p className="mt-1 text-sm text-muted">
              A current status is shown only when a verification certificate or sworn affidavit with present validity is
              in the corpus. Official procurement tables are dated disclosures, not current certificates.
            </p>
            <p className="mt-3">
              <LifecycleBadge state={interpretation} />
            </p>
            {showCertificateFields ? (
              <dl className="mt-4">
                <Field label="B-BBEE level" value={<LevelCell level={current?.bee_level} />} hint={claimHint(data, "bee_level")} />
                <Field label="Recognition level" value={displayOrUnknown(current?.recognition_level)} hint={claimHint(data, "recognition_level")} />
                <Field label="Scorecard type" value={displayOrUnknown(current?.scorecard_type)} />
                <Field label="Issue date" value={<DateCell value={current?.issue_date} />} />
                <Field label="Expiry date" value={<DateCell value={current?.expiry_date} />} />
                <Field
                  label="Verification agency"
                  value={
                    data.agency ? (
                      <Link to="/verifiers/$slug" params={{ slug: data.agency.slug }} className="underline underline-offset-4">
                        {data.agency.name}
                      </Link>
                    ) : (
                      displayOrUnknown(data.publishedClaims.find((c) => c.field_key === "verification_agency")?.value ?? null)
                    )
                  }
                  hint={claimHint(data, "verification_agency")}
                />
                <Field
                  label="Certificate status"
                  value={current?.lifecycle_state ? <LifecycleBadge state={current.lifecycle_state} /> : displayOrUnknown(null, "unknown")}
                />
              </dl>
            ) : (
              <dl className="mt-4">
                <Field
                  label="Current certificate"
                  value="Not found in corpus"
                />
                {interpretation === "expired_certificate" || interpretation === "validity_unconfirmed" || interpretation === "historical_certificate" ? (
                  <>
                    <Field label="Last indexed certificate level" value={<LevelCell level={current?.bee_level} />} />
                    <Field label="Issue date" value={<DateCell value={current?.issue_date} />} />
                    <Field label="Expiry date" value={<DateCell value={current?.expiry_date} />} />
                  </>
                ) : null}
              </dl>
            )}
            <Field label="Website" value={entity.website ? <a className="underline underline-offset-4" href={entity.website}>{entity.website}</a> : displayOrUnknown(null, "not_disclosed")} />

            {supportingCertificate ? (
              <>
                <h2 className="mt-10 font-display text-2xl">Supporting certificate evidence</h2>
                <div className="mt-3 border border-rule bg-cream p-4">
                  <p className="font-medium">
                    <Link to="/evidence/$id" params={{ id: supportingCertificate.id }} className="hover:underline">
                      {supportingCertificate.title ?? supportingCertificate.id}
                    </Link>
                  </p>
                  <p className="mt-2 flex flex-wrap gap-2 text-sm text-muted">
                    <EvidenceTypeLabel type={supportingCertificate.evidence_type} />
                    <span>· issued <DateCell value={supportingCertificate.issue_date} /></span>
                    <span>· expires <DateCell value={supportingCertificate.expiry_date} /></span>
                    <LifecycleBadge state={supportingCertificate.lifecycle_state} />
                  </p>
                  <p className="mt-2 text-sm">
                    Source: {supportingCertificate.source_url ? (
                      <a href={supportingCertificate.source_url} className="underline underline-offset-4" rel="noreferrer">
                        {supportingCertificate.source_domain ?? supportingCertificate.source_url}
                      </a>
                    ) : (
                      "Not recorded"
                    )}
                    {" · "}
                    original source {publicStateLabel(supportingCertificate.source_live_status, "unknown")}
                    {" · "}
                    {supportingCertificate.asset_id ? "archived copy retained" : "no archived copy"}
                  </p>
                </div>
              </>
            ) : null}

            <h2 className="mt-10 font-display text-2xl">Historical / public disclosures</h2>
            <p className="mt-1 text-sm text-muted">
              Official procurement and other dated public records. A reported level is what that source recorded on that
              date — not a claim that the company is currently that level.
            </p>
            {disclosures.length ? (
              <ol className="mt-3 border-t border-rule">
                {disclosures.map((ev) => (
                  <li key={ev.id} className="border-b border-rule py-3">
                    <p className="text-xs uppercase tracking-wide text-muted">
                      {formatWhen(ev.issue_date ?? ev.publication_date ?? ev.discovered_at)}
                    </p>
                    <p>
                      <Link to="/evidence/$id" params={{ id: ev.id }} className="hover:underline">
                        {ev.title ?? ev.id}
                      </Link>
                    </p>
                    <p className="mt-1 flex flex-wrap gap-2 text-sm text-muted">
                      <EvidenceTypeLabel type={ev.evidence_type} />
                      {"reported_bee_level" in ev && ev.reported_bee_level ? (
                        <LevelCell level={String(ev.reported_bee_level)} />
                      ) : null}
                      <LifecycleBadge state={disclosureInterpretation({ evidenceType: ev.evidence_type, lifecycle: ev.lifecycle_state })} />
                    </p>
                    {ev.source_url ? (
                      <p className="mt-1 text-sm">
                        Source:{" "}
                        <a href={ev.source_url} className="underline underline-offset-4" rel="noreferrer">
                          {ev.document_issuer ?? ev.source_domain ?? ev.source_url}
                        </a>
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <div className="mt-3">
                <EmptyState title="No official procurement disclosures indexed for this company yet." />
              </div>
            )}

            <h2 className="mt-10 font-display text-2xl">Evidence timeline</h2>
            {data.evidence.length ? (
              <ol className="mt-3 border-t border-rule">
                {data.evidence.map((ev) => (
                  <li key={ev.id} className="border-b border-rule py-3">
                    <p className="text-xs uppercase tracking-wide text-muted">
                      {formatWhen(ev.issue_date ?? ev.discovered_at)}
                    </p>
                    <p>
                      <Link to="/evidence/$id" params={{ id: ev.id }} className="hover:underline">
                        {ev.title ?? ev.id}
                      </Link>
                      {" — "}
                      <EvidenceTypeLabel type={ev.evidence_type} />
                    </p>
                    <p className="mt-1 flex flex-wrap gap-2 text-sm text-muted">
                      <LifecycleBadge
                        state={
                          isDisclosureEvidence(ev.evidence_type)
                            ? disclosureInterpretation({ evidenceType: ev.evidence_type, lifecycle: ev.lifecycle_state })
                            : ev.lifecycle_state
                        }
                      />
                      {!isDisclosureEvidence(ev.evidence_type) && ev.expiry_date ? (
                        <>expires <DateCell value={ev.expiry_date} /></>
                      ) : null}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState title="No historical evidence yet." />
            )}

            {otherEvidence.length === 0 && disclosures.length === 0 ? (
              <EmptyState title="No published evidence is attached to this company yet." />
            ) : null}

            {data.events.length ? (
              <>
                <h2 className="mt-10 font-display text-2xl">Publication events</h2>
                <ol className="mt-3 divide-y divide-rule border-y border-rule text-sm">
                  {data.events.map((ev) => (
                    <li key={ev.id} className="py-3">
                      <p className="text-xs text-muted">{formatWhen(ev.published_at)}</p>
                      <p>{ev.summary}</p>
                    </li>
                  ))}
                </ol>
              </>
            ) : null}
          </section>

          <aside>
            <h2 className="font-display text-2xl">Identity</h2>
            <dl className="mt-3">
              <Field label="Trading name" value={displayOrUnknown(entity.trading_name, "not_disclosed")} />
              <Field
                label="Aliases"
                value={
                  data.aliases.length
                    ? data.aliases.map((a) => a.alias).join(" · ")
                    : displayOrUnknown(null, "not_found")
                }
              />
              <Field
                label="Sectors"
                value={
                  data.sectors.length
                    ? data.sectors.map((s) => (
                        <Link key={s.slug} to="/sectors/$slug" params={{ slug: s.slug }} className="mr-2 underline underline-offset-4">
                          {s.name}
                        </Link>
                      ))
                    : displayOrUnknown(null, "not_found")
                }
              />
              <Field
                label="Parent / holding"
                value={
                  data.parents.length
                    ? data.parents.map((p) => (
                        <Link key={p.id} to="/companies/$slug" params={{ slug: p.slug }} className="block underline underline-offset-4">
                          {p.canonical_name}
                        </Link>
                      ))
                    : displayOrUnknown(null, "not_found")
                }
              />
              <Field
                label="Subsidiaries / related"
                value={
                  data.children.length
                    ? data.children.map((p) => (
                        <Link key={p.id} to="/companies/$slug" params={{ slug: p.slug }} className="block underline underline-offset-4">
                          {p.canonical_name}
                        </Link>
                      ))
                    : displayOrUnknown(null, "not_found")
                }
              />
              <Field label="Interpretation" value={INTERPRETATION_LABELS[interpretation] ?? interpretation} />
            </dl>
            <p className="mt-6 text-sm">
              <Link to="/corrections" search={{ company: entity.slug }} className="underline underline-offset-4">
                Dispute or correct this record
              </Link>
            </p>
          </aside>
        </div>
      </div>
    </PublicShell>
  );
}

function claimHint(
  data: {
    publishedClaims: Array<{ field_key: string; evidence_id: string; published_at: string; published_by: string; rule_version: string | null }>;
  },
  field: BeeField,
) {
  const claim = data.publishedClaims.find((c) => c.field_key === field);
  if (!claim) return null;
  const who = claim.rule_version ? `automation rule v${claim.rule_version}` : "reviewed publication";
  return (
    <>
      Supported by{" "}
      <Link to="/evidence/$id" params={{ id: claim.evidence_id }} className="underline underline-offset-4">
        evidence
      </Link>{" "}
      · {CLAIM_FIELD_LABELS[field]} published {formatWhen(claim.published_at)} via {who}.
    </>
  );
}
