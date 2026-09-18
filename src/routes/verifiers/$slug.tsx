import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public-shell";
import { EmptyState, Field } from "@/components/ui";
import { DateCell, LifecycleBadge } from "@/components/meta";
import { displayOrUnknown } from "@/lib/bee/format";
import { getVerifierPage } from "@/lib/bee/public.functions";

export const Route = createFileRoute("/verifiers/$slug")({
  loader: ({ params }) => getVerifierPage({ data: { slug: params.slug } }),
  component: VerifierPage,
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.agency.name ?? "Verifier"} — The BEE Record` }],
  }),
});

function VerifierPage() {
  const { agency, aliases, accreditations, signatories, evidence } = Route.useLoaderData();
  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-forest">Verification agency</p>
        <h1 className="mt-2 font-display text-4xl">{agency.name}</h1>
        <dl className="mt-6 max-w-2xl">
          <Field label="Legal name" value={displayOrUnknown(agency.legal_name, "not_disclosed")} />
          <Field
            label="Website"
            value={
              agency.website ? (
                <a href={agency.website} className="underline underline-offset-4" rel="noreferrer">
                  {agency.website}
                </a>
              ) : (
                displayOrUnknown(null, "not_disclosed")
              )
            }
          />
          <Field label="Aliases" value={aliases.length ? aliases.map((a) => a.alias).join(" · ") : displayOrUnknown(null)} />
        </dl>

        <h2 className="mt-10 font-display text-2xl">Accreditation (as evidenced)</h2>
        {accreditations.length ? (
          <ul className="mt-3 divide-y divide-rule border-y border-rule text-sm">
            {accreditations.map((a, i) => (
              <li key={i} className="py-3">
                {a.accreditation_body ?? "Accreditation body unknown"} {a.accreditation_identifier ? `· ${a.accreditation_identifier}` : ""}
                <div className="text-muted">{a.status ?? "Status unknown"}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">No accreditation records have been published for this agency.</p>
        )}

        <h2 className="mt-10 font-display text-2xl">Signatories named on indexed documents</h2>
        {signatories.length ? (
          <ul className="mt-3 list-disc pl-5 text-sm">
            {signatories.map((s) => (
              <li key={s.name}>
                {s.name}
                {s.role_title ? ` · ${s.role_title}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">No signatories have been published.</p>
        )}

        <h2 className="mt-10 font-display text-2xl">Indexed documents naming this agency</h2>
        <p className="mt-1 text-sm text-muted">
          These documents identify the agency. That is not a statement about an ongoing commercial relationship.
        </p>
        {evidence.length ? (
          <ul className="mt-3 divide-y divide-rule border-y border-rule">
            {evidence.map((ev) => (
              <li key={ev.id} className="py-3">
                <Link to="/evidence/$id" params={{ id: ev.id }} className="font-medium hover:underline">
                  {ev.title ?? ev.id}
                </Link>
                <p className="text-sm text-muted">
                  {ev.entity_slug ? (
                    <Link to="/companies/$slug" params={{ slug: ev.entity_slug }} className="hover:underline">
                      {ev.entity_name}
                    </Link>
                  ) : (
                    "Unlinked entity"
                  )}
                  {" · issued "}
                  <DateCell value={ev.issue_date} /> <LifecycleBadge state={ev.lifecycle_state} />
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No published documents currently name this agency." />
        )}
      </div>
    </PublicShell>
  );
}
