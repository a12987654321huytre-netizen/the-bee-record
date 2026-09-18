import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public-shell";
import { EmptyState, Input, Button } from "@/components/ui";
import { getVerifierDirectory } from "@/lib/bee/public.functions";

export const Route = createFileRoute("/verifiers/")({
  validateSearch: (s: Record<string, unknown>): { q?: string } => ({
    q: typeof s.q === "string" && s.q ? s.q : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getVerifierDirectory({ data: { q: deps.q } }),
  component: Verifiers,
  head: () => ({ meta: [{ title: "Verification agencies — The BEE Record" }] }),
});

function Verifiers() {
  const search = Route.useSearch();
  const { items } = Route.useLoaderData();
  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl px-4 py-10 md:px-6">
        <h1 className="font-display text-4xl">Verification agencies</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Agencies named on indexed documents. A listed certificate means the document identifies the agency — not an
          endorsement by this site.
        </p>
        <form className="mt-6 flex max-w-xl gap-2">
          <Input name="q" defaultValue={search.q} placeholder="Agency name" aria-label="Search agencies" />
          <Button type="submit">Search</Button>
        </form>
        {!items.length ? (
          <div className="mt-8">
            <EmptyState title="No verification agencies have been published yet." />
          </div>
        ) : (
          <ul className="mt-8 divide-y divide-rule border-y border-rule">
            {items.map((a) => (
              <li key={a.id} className="flex justify-between gap-3 py-3">
                <Link to="/verifiers/$slug" params={{ slug: a.slug }} className="font-medium hover:underline">
                  {a.name}
                </Link>
                <span className="tabular-nums text-sm text-muted">{a.evidence_count} document{a.evidence_count === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PublicShell>
  );
}
