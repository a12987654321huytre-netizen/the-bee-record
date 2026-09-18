import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public-shell";
import { EmptyState, Field } from "@/components/ui";
import { DateCell, EvidenceTypeLabel, LevelCell, LifecycleBadge } from "@/components/meta";
import { displayOrUnknown, formatWhen, publicStateLabel } from "@/lib/bee/format";
import { CLAIM_FIELD_LABELS, type BeeField } from "@/lib/bee/constants";
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
            <h2 className="font-display text-2xl">Current interpretation</h2>
            <p className="mt-1 text-sm text-muted">
              Derived from approved evidence. “Current” is not “whatever was inserted last”.
            </p>
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
                label="Evidence status"
                value={current?.lifecycle_state ? <LifecycleBadge state={current.lifecycle_state} /> : displayOrUnknown(null, "unknown")}
              />
              <Field label="Website" value={entity.website ? <a className="underline underline-offset-4" href={entity.website}>{entity.website}</a> : displayOrUnknown(null, "not_disclosed")} />
            </dl>

            <h2 className="mt-10 font-display text-2xl">Supporting evidence</h2>
            {supporting ? (
              <div className="mt-3 border border-rule bg-cream p-4">
                <p className="font-medium">
                  <Link to="/evidence/$id" params={{ id: supporting.id }} className="hover:underline">
                    {supporting.title ?? supporting.id}
                  </Link>
                </p>
                <p className="mt-2 flex flex-wrap gap-2 text-sm text-muted">
                  <EvidenceTypeLabel type={supporting.evidence_type} />
                  <span>· issued <DateCell value={supporting.issue_date} /></span>
                  <span>· expires <DateCell value={supporting.expiry_date} /></span>
                  <LifecycleBadge state={supporting.lifecycle_state} />
                </p>
                <p className="mt-2 text-sm">
                  Source: {supporting.source_url ? (
                    <a href={supporting.source_url} className="underline underline-offset-4" rel="noreferrer">
                      {supporting.source_domain ?? supporting.source_url}
                    </a>
                  ) : (
                    "Not recorded"
                  )}
                  {" · "}
                  original source {publicStateLabel(supporting.source_live_status, "unknown")}
                  {" · "}
                  {supporting.asset_id ? "archived copy retained" : "no archived copy"}
                </p>
              </div>
            ) : (
              <EmptyState title="No published evidence is attached to this company yet." />
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
                      <LifecycleBadge state={ev.lifecycle_state} />
                      {ev.expiry_date ? <>expires <DateCell value={ev.expiry_date} /></> : null}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <EmptyState title="No historical evidence yet." />
            )}

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
