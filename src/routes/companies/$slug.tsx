import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public-shell";
import { EmptyState, Field } from "@/components/ui";
import { DateCell, EvidenceTypeLabel, LevelCell, LifecycleBadge } from "@/components/meta";
import { displayOrUnknown, formatWhen } from "@/lib/bee/format";
import { CLAIM_FIELD_LABELS, INTERPRETATION_LABELS, isDisclosureEvidence, type BeeField } from "@/lib/bee/constants";
import { isPublicClaimValue } from "@/lib/bee/claim-quality";
import { companyInterpretation, disclosureInterpretation } from "@/lib/bee/disclosure";
import { isModernProcurementEvidence, publicCorpusState } from "@/lib/bee/recency";
import { getCompanyPage } from "@/lib/bee/public.functions";
import { resolveEvidenceDate, polishEvidenceTitle } from "@/lib/bee/evidence-date";
import {
  evidenceDateInput,
  isCompanyDisclosureType,
  latestEvidenceKind,
  LATEST_EVIDENCE_LABELS,
  selectLatestPublicEvidence,
  sourceOrganisationLabel,
} from "@/lib/bee/latest-evidence";

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
  const hasCompanyDisclosure = data.evidence.some((ev) => isCompanyDisclosureType(ev.evidence_type));
  const interpretation = companyInterpretation({
    currentLifecycle: currentIsDisclosure ? null : current?.lifecycle_state,
    currentEvidenceType: currentIsDisclosure
      ? null
      : (data.evidence.find((ev) => ev.id === current?.evidence_id)?.evidence_type ?? null),
    hasDisclosure: disclosures.length > 0,
    disclosureModern: disclosures.some((ev) =>
      isModernProcurementEvidence({
        issueDate: ev.issue_date,
        issueDateRaw: ev.issue_date_raw,
        precision: ev.issue_date_precision,
        sourceUrl: ev.source_url,
        title: ev.title,
        createdAt: ev.created_at,
        retrievedAt: ev.retrieved_at,
        discoveredAt: ev.discovered_at,
      }),
    ),
    hasCompanyDisclosure,
  });
  const showCertificateFields = interpretation === "current_certificate" || interpretation === "expiring_soon";
  const supportingCertificate = supporting && !isDisclosureEvidence(supporting.evidence_type) ? supporting : null;
  const latest = selectLatestPublicEvidence(data.evidence);
  const latestDate = latest ? resolveEvidenceDate(evidenceDateInput(latest)) : null;
  const latestKind = latest ? latestEvidenceKind(latest, latestDate ?? undefined) : null;
  const leadWithCertificate = showCertificateFields;
  const corpusState = publicCorpusState(
    data.evidence.map((ev) => ({
      id: ev.id,
      type: ev.evidence_type,
      lifecycle: ev.lifecycle_state,
      issueDate: ev.issue_date,
      issueDateRaw: ev.issue_date_raw,
      precision: ev.issue_date_precision,
      sourceUrl: ev.source_url,
      title: ev.title,
      createdAt: ev.created_at,
      retrievedAt: ev.retrieved_at,
      discoveredAt: ev.discovered_at,
    })),
  );
  const certNumberRaw = data.publishedClaims.find((c) => c.field_key === "certificate_number")?.value ?? null;
  const certNumber = isPublicClaimValue("certificate_number", certNumberRaw) ? certNumberRaw : null;

  const sortedEvidence = [...data.evidence].sort((a, b) => {
    const da = resolveEvidenceDate(evidenceDateInput(a)).iso ?? "";
    const db = resolveEvidenceDate(evidenceDateInput(b)).iso ?? "";
    if (da !== db) return db.localeCompare(da);
    return a.id < b.id ? 1 : -1;
  });
  const dated = sortedEvidence.filter((ev) => resolveEvidenceDate(evidenceDateInput(ev)).stated);
  const undated = sortedEvidence.filter((ev) => !resolveEvidenceDate(evidenceDateInput(ev)).stated);

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
            {leadWithCertificate ? (
              <CertificateBlock
                data={data}
                current={current}
                interpretation={interpretation}
                certNumber={certNumber}
              />
            ) : latest ? (
              <LatestPublicBlock
                latest={latest}
                latestDate={latestDate!}
                latestKind={latestKind!}
                corpusState={corpusState}
              />
            ) : (
              <CertificateBlock
                data={data}
                current={current}
                interpretation={interpretation}
                certNumber={certNumber}
              />
            )}

            {!leadWithCertificate ? (
              <div className="mt-10">
                <h2 className="font-display text-2xl">Current B-BBEE certificate</h2>
                <dl className="mt-4">
                  <Field label="Current certificate" value="Not found in corpus" />
                  {interpretation === "expired_certificate" || interpretation === "validity_unconfirmed" || interpretation === "historical_certificate" ? (
                    <>
                      <Field label="Last indexed certificate level" value={<LevelCell level={current?.bee_level} />} />
                      <Field label="Issue date" value={<DateCell value={current?.issue_date} />} />
                      <Field label="Expiry date" value={<DateCell value={current?.expiry_date} />} />
                    </>
                  ) : null}
                </dl>
              </div>
            ) : latest && latest.id !== current?.evidence_id ? (
              <div className="mt-10">
                <h2 className="font-display text-2xl">Latest public B-BBEE evidence</h2>
                <LatestPublicBlock
                  latest={latest}
                  latestDate={latestDate!}
                  latestKind={latestKind!}
                  compact
                />
              </div>
            ) : null}

            {entity.website ? (
              <dl className="mt-4">
                <Field label="Website" value={<a className="underline underline-offset-4" href={entity.website}>{entity.website}</a>} />
              </dl>
            ) : null}

            {supportingCertificate && leadWithCertificate ? (
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
                        {supportingCertificate.agency_name ?? supportingCertificate.source_domain ?? supportingCertificate.source_url}
                      </a>
                    ) : (
                      "Not recorded"
                    )}
                    {" · "}
                    original source {supportingCertificate.source_live_status === "live" ? "Live" : supportingCertificate.source_live_status}
                    {" · "}
                    {supportingCertificate.asset_id ? "archived copy retained" : "no archived copy"}
                  </p>
                </div>
              </>
            ) : null}

            <h2 className="mt-10 font-display text-2xl">Historical / public disclosures</h2>
            <p className="mt-1 text-sm text-muted">
              Official procurement and other dated public records. A reported level is what that source recorded on that
              date — not a claim that the company currently holds that status.
            </p>
            {disclosures.length ? (
              <ol className="mt-3 border-t border-rule">
                {disclosures.map((ev) => {
                  const date = resolveEvidenceDate(evidenceDateInput(ev));
                  const kind = latestEvidenceKind(ev, date);
                  const issuer = (ev as { government_institution?: string | null }).government_institution ?? ev.document_issuer;
                  const tender = (ev as { tender_number?: string | null }).tender_number;
                  return (
                    <li key={ev.id} className="border-b border-rule py-3">
                      <p className="text-xs uppercase tracking-wide text-muted">
                        {date.stated ? date.label : "Date not stated in source"}
                      </p>
                      <p>
                        <Link to="/evidence/$id" params={{ id: ev.id }} className="hover:underline">
                          {polishEvidenceTitle(ev.title, date) ?? ev.title ?? ev.id}
                        </Link>
                      </p>
                      <p className="mt-1 flex flex-wrap gap-2 text-sm text-muted">
                        {ev.reported_bee_level ? <LevelCell level={String(ev.reported_bee_level)} /> : null}
                        <span>{LATEST_EVIDENCE_LABELS[kind]}</span>
                      </p>
                      {issuer ? (
                        <p className="mt-1 text-sm">
                          Source:{" "}
                          {ev.source_url ? (
                            <a href={ev.source_url} className="underline underline-offset-4" rel="noreferrer">
                              {issuer}
                            </a>
                          ) : (
                            issuer
                          )}
                        </p>
                      ) : null}
                      {tender ? <p className="mt-1 text-sm text-muted">Tender / reference: {tender}</p> : null}
                      <p className="mt-1 text-xs text-muted">
                        This disclosure records what the source reported at that date. It is not a claim that the company
                        currently holds that level.
                      </p>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div className="mt-3">
                <EmptyState title="No official procurement disclosures indexed for this company yet." />
              </div>
            )}

            <h2 className="mt-10 font-display text-2xl">Evidence timeline</h2>
            {dated.length || undated.length ? (
              <ol className="mt-3 border-t border-rule">
                {dated.map((ev) => {
                  const date = resolveEvidenceDate(evidenceDateInput(ev));
                  const kind = isDisclosureEvidence(ev.evidence_type)
                    ? latestEvidenceKind(ev, date)
                    : ev.lifecycle_state === "current"
                      ? "current_certificate"
                      : ev.lifecycle_state === "expiring_soon"
                        ? "expiring_soon"
                        : ev.lifecycle_state;
                  return (
                    <li key={ev.id} className="border-b border-rule py-3">
                      <p className="text-xs uppercase tracking-wide text-muted">{date.label}</p>
                      <p>
                        <Link to="/evidence/$id" params={{ id: ev.id }} className="hover:underline">
                          {polishEvidenceTitle(ev.title, date) ?? ev.title ?? ev.id}
                        </Link>
                      </p>
                      <p className="mt-1 flex flex-wrap gap-2 text-sm text-muted">
                        {isDisclosureEvidence(ev.evidence_type) ? (
                          <>
                            {LATEST_EVIDENCE_LABELS[kind as keyof typeof LATEST_EVIDENCE_LABELS] ?? kind}
                            {ev.reported_bee_level ? <LevelCell level={String(ev.reported_bee_level)} /> : null}
                            <span>{sourceOrganisationLabel(ev)}</span>
                          </>
                        ) : (
                          <>
                            <EvidenceTypeLabel type={ev.evidence_type} />
                            {ev.reported_bee_level ? <LevelCell level={String(ev.reported_bee_level)} /> : null}
                            {ev.agency_name ? <span>{ev.agency_name}</span> : null}
                            <LifecycleBadge state={ev.lifecycle_state} />
                            {ev.expiry_date ? <>expires <DateCell value={ev.expiry_date} /></> : null}
                          </>
                        )}
                      </p>
                    </li>
                  );
                })}
                {undated.length ? (
                  <li className="border-b border-rule py-3">
                    <p className="text-xs uppercase tracking-wide text-muted">Date not stated in source</p>
                    <ul className="mt-2 space-y-2">
                      {undated.map((ev) => (
                        <li key={ev.id}>
                          <Link to="/evidence/$id" params={{ id: ev.id }} className="hover:underline">
                            {ev.title ?? ev.id}
                          </Link>
                          {" — "}
                          <EvidenceTypeLabel type={ev.evidence_type} />
                        </li>
                      ))}
                    </ul>
                  </li>
                ) : null}
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
                    : displayOrUnknown(null, "not_yet")
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
                    : displayOrUnknown(null, "not_yet")
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
                    : displayOrUnknown(null, "not_yet")
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
                    : displayOrUnknown(null, "not_yet")
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

function CertificateBlock({
  data,
  current,
  interpretation,
  certNumber,
}: {
  data: {
    agency: { slug: string; name: string } | null;
    publishedClaims: Array<{ field_key: string; evidence_id: string; published_at: string; published_by: string; rule_version: string | null; value?: string | null }>;
  };
  current: {
    bee_level?: string | null;
    recognition_level?: string | null;
    scorecard_type?: string | null;
    issue_date?: string | null;
    expiry_date?: string | null;
    lifecycle_state?: string | null;
  } | null;
  interpretation: string;
  certNumber: string | null;
}) {
  return (
    <>
      <h2 className="font-display text-2xl">Current B-BBEE certificate</h2>
      <p className="mt-1 text-sm text-muted">
        A current status is shown only when a verification certificate or sworn affidavit with present validity is in
        the corpus.
      </p>
      <p className="mt-3">
        <LifecycleBadge state={interpretation} />
      </p>
      <dl className="mt-4">
        <Field label="B-BBEE level" value={<LevelCell level={current?.bee_level} />} hint={claimHint(data, "bee_level")} />
        {current?.recognition_level ? (
          <Field label="Recognition level" value={current.recognition_level} hint={claimHint(data, "recognition_level")} />
        ) : null}
        {current?.scorecard_type ? <Field label="Scorecard type" value={current.scorecard_type} /> : null}
        <Field label="Issue date" value={<DateCell value={current?.issue_date} />} />
        <Field label="Expiry date" value={<DateCell value={current?.expiry_date} />} />
        {certNumber ? <Field label="Certificate number" value={certNumber} /> : null}
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
      </dl>
    </>
  );
}

function LatestPublicBlock({
  latest,
  latestDate,
  latestKind,
  compact,
  corpusState,
}: {
  latest: {
    id: string;
    title: string | null;
    evidence_type: string;
    reported_bee_level?: string | null;
    document_issuer?: string | null;
    agency_name?: string | null;
    source_url?: string | null;
    source_domain?: string | null;
    retrieved_at?: string | Date | null;
    created_at?: string;
    tender_number?: string | null;
    government_institution?: string | null;
    enterprise_class?: string | null;
  };
  latestDate: ReturnType<typeof resolveEvidenceDate>;
  latestKind: string;
  compact?: boolean;
  corpusState?: "current_certificate" | "recent_public_evidence" | "historical_evidence_only" | "official_undated";
}) {
  const issuer = latest.government_institution ?? latest.document_issuer ?? latest.agency_name;
  const source = sourceOrganisationLabel(latest);
  const state = corpusState ?? (latestDate.stated ? "recent_public_evidence" : "official_undated");
  const heading =
    state === "historical_evidence_only"
      ? "Historical B-BBEE evidence"
      : state === "official_undated"
        ? "Official B-BBEE evidence"
        : "Latest public B-BBEE evidence";
  const note =
    state === "historical_evidence_only"
      ? "Historical evidence only. No recent or current B-BBEE status is established by this record."
      : state === "official_undated"
        ? "Source date not stated. Current B-BBEE status cannot be determined from this evidence."
        : "What the source reported on that date. This is not a current verification certificate.";
  return (
    <>
      {!compact ? <h2 className="font-display text-2xl">{heading}</h2> : null}
      <p className="mt-1 text-sm text-muted">{note}</p>
      <p className="mt-3">
        <LifecycleBadge state={state === "historical_evidence_only" || state === "official_undated" ? state : latestKind} />
      </p>
      <dl className="mt-4">
        {latest.reported_bee_level ? (
          <Field label="Reported B-BBEE level" value={<LevelCell level={latest.reported_bee_level} />} />
        ) : null}
        <Field
          label="Evidence type"
          value={LATEST_EVIDENCE_LABELS[latestKind as keyof typeof LATEST_EVIDENCE_LABELS] ?? latestKind}
        />
        <Field
          label="Evidence date"
          value={latestDate.stated ? latestDate.label : "Not stated in source"}
        />
        {issuer || source ? (
          <Field
            label="Source"
            value={
              latest.source_url ? (
                <a href={latest.source_url} className="underline underline-offset-4" rel="noreferrer">
                  {issuer || source}
                </a>
              ) : (
                issuer || source
              )
            }
          />
        ) : null}
        {latest.tender_number ? <Field label="Tender / reference" value={latest.tender_number} /> : null}
        {latest.enterprise_class ? <Field label="Enterprise category" value={latest.enterprise_class} /> : null}
        {latest.title ? (
          <Field
            label="Record"
            value={
              <Link to="/evidence/$id" params={{ id: latest.id }} className="underline underline-offset-4">
                {polishEvidenceTitle(latest.title, latestDate) ?? latest.title}
              </Link>
            }
          />
        ) : null}
        {latest.retrieved_at || latest.created_at ? (
          <Field
            label="Indexed by The BEE Record"
            value={formatWhen(latest.retrieved_at ?? latest.created_at)}
          />
        ) : null}
      </dl>
    </>
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
