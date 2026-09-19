import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public-shell";
import { Button, EmptyState, Input } from "@/components/ui";
import { DateCell, LevelCell, LifecycleBadge } from "@/components/meta";
import { APP_TAGLINE } from "@/lib/bee/constants";
import { getHomeData } from "@/lib/bee/public.functions";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  loader: () => getHomeData(),
  component: Home,
  head: () => ({
    meta: [{ title: "The BEE Record — public B-BBEE evidence index" }],
  }),
});

function Home() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const { stats } = data;

  return (
    <PublicShell>
      <section className="border-b border-rule bg-cream">
        <div className="mx-auto max-w-6xl px-4 py-10 md:px-6 md:py-14">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-forest">Public research index</p>
          <h1 className="mt-3 max-w-3xl font-display text-4xl text-ink md:text-5xl">{APP_TAGLINE}</h1>
          <form
            className="mt-8 flex max-w-2xl flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              void navigate({ to: "/search", search: { q } });
            }}
          >
            <label className="sr-only" htmlFor="home-search">
              Search companies, aliases, registration numbers, verifiers
            </label>
            <Input
              id="home-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Company, alias, registration number, verifier"
            />
            <Button type="submit" className="sm:w-36">
              Search
            </Button>
          </form>
          <dl className="mt-10 grid grid-cols-2 gap-px bg-rule sm:grid-cols-4">
            <Stat label="Published companies" value={stats.companies} />
            <Stat label="Indexed evidence" value={stats.evidence} />
            <Stat label="Current certificates" value={stats.currentCertificates} />
            <Stat label="Official disclosures" value={stats.officialDisclosures} />
          </dl>
          <p className="mt-3 text-xs text-muted">
            Counts are live from this database. Published companies have checkable B-BBEE evidence; they do not all have a
            currently valid certificate. {stats.updated30d} publication event{stats.updated30d === 1 ? "" : "s"} in
            the last 30 days.
          </p>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 md:grid-cols-3 md:px-6">
        <section className="md:col-span-2">
          <HeaderLink title="Recently updated" to="/updates" />
          {data.recent.updated.length ? (
            <ul className="divide-y divide-rule border-t border-rule">
              {data.recent.updated.map((row) => (
                <li key={row.slug} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                  <Link to="/companies/$slug" params={{ slug: row.slug }} className="font-medium hover:underline">
                    {row.canonical_name}
                  </Link>
                  <span className="text-sm text-muted">
                    <LevelCell level={row.bee_level} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No companies have been published yet."
              body="The index starts empty. Records appear here only after evidence is reviewed and published."
            />
          )}

          <HeaderLink title="Recently indexed evidence" to="/updates" className="mt-10" />
          {data.recent.evidence.length ? (
            <ul className="divide-y divide-rule border-t border-rule">
              {data.recent.evidence.map((row) => (
                <li key={row.id} className="py-3">
                  <Link to="/evidence/$id" params={{ id: row.id }} className="hover:underline">
                    {row.title ?? row.id}
                  </Link>
                  <p className="text-sm text-muted">
                    {row.entity_name ? (
                      <Link to="/companies/$slug" params={{ slug: row.entity_slug ?? "" }} className="hover:underline">
                        {row.entity_name}
                      </Link>
                    ) : (
                      "Unlinked"
                    )}
                    {" · "}
                    <DateCell value={row.issue_date} />
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No evidence has been published yet." />
          )}
        </section>

        <aside className="space-y-8">
          <section>
            <HeaderLink title="Sectors" to="/companies" />
            <ul className="divide-y divide-rule border-t border-rule text-sm">
              {data.sectors.map((s) => (
                <li key={s.slug} className="flex justify-between py-2">
                  <Link to="/sectors/$slug" params={{ slug: s.slug }} className="hover:underline">
                    {s.name}
                  </Link>
                  <span className="tabular-nums text-muted">{s.n}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <HeaderLink title="Expiring evidence" to="/evidence/expiring" />
            {data.expiring.length ? (
              <ul className="divide-y divide-rule border-t border-rule text-sm">
                {data.expiring.map((row) => (
                  <li key={row.id} className="py-2">
                    <Link to="/evidence/$id" params={{ id: row.id }} className="hover:underline">
                      {row.entity_name ?? row.title ?? row.id}
                    </Link>
                    <div className="mt-1 flex items-center gap-2">
                      <LifecycleBadge state={row.lifecycle_state} />
                      <DateCell value={row.expiry_date} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No indexed evidence is currently marked as expiring soon." />
            )}
          </section>
          <p className="text-sm text-muted">
            <Link to="/submit" className="underline underline-offset-4">
              Submit a source
            </Link>
            {" · "}
            <Link to="/methodology" className="underline underline-offset-4">
              How the index works
            </Link>
          </p>
        </aside>
      </div>
    </PublicShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-cream px-4 py-4">
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="font-display text-3xl tabular-nums">{value}</dd>
    </div>
  );
}

function HeaderLink({ title, to, className }: { title: string; to: string; className?: string }) {
  return (
    <div className={`mb-3 flex items-baseline justify-between ${className ?? ""}`}>
      <h2 className="font-display text-2xl">{title}</h2>
      <Link to={to} className="text-sm text-muted hover:text-ink">
        View all
      </Link>
    </div>
  );
}
