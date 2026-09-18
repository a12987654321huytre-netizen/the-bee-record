import { createFileRoute, Link, useRouter, useRouteContext } from "@tanstack/react-router";
import { Button, EmptyState, Input, Select } from "@/components/ui";
import { createCompanyFn, listAdminCompanies } from "@/lib/bee/admin.functions";
import { formatWhen } from "@/lib/bee/format";
import { useState } from "react";

export const Route = createFileRoute("/admin/companies/")({
  validateSearch: (s: Record<string, unknown>): { q?: string; visibility?: string; page?: number } => ({
    q: typeof s.q === "string" && s.q ? s.q : undefined,
    visibility: typeof s.visibility === "string" && s.visibility ? s.visibility : undefined,
    page: s.page != null && s.page !== "" ? Number(s.page) || 1 : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => listAdminCompanies({ data: deps }),
  component: Companies,
});

function Companies() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const ctx = useRouteContext({ from: "/admin" });
  const router = useRouter();
  const csrf = ctx.session?.csrf ?? "";
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <h1 className="font-display text-3xl">Companies</h1>
      <form className="mt-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={search.q} placeholder="Name or registration" aria-label="Search" className="max-w-xs" />
        <Select name="visibility" defaultValue={search.visibility} aria-label="Visibility" className="max-w-40">
          <option value="">Any visibility</option>
          <option value="draft">Draft</option>
          <option value="public">Public</option>
          <option value="hidden">Hidden</option>
        </Select>
        <Button type="submit" variant="ghost">
          Filter
        </Button>
      </form>

      <form
        className="mt-6 grid gap-2 border border-rule p-4 md:grid-cols-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const result = await createCompanyFn({
            data: {
              csrf,
              canonicalName: String(form.get("canonicalName") || ""),
              registrationNumber: String(form.get("registrationNumber") || "") || undefined,
              website: String(form.get("website") || "") || undefined,
              visibility: "draft",
            },
          });
          if ("id" in result) {
            await router.invalidate();
            await router.navigate({ to: "/admin/companies/$id", params: { id: result.id } });
          } else {
            setError("Could not create company.");
          }
        }}
      >
        <Input name="canonicalName" placeholder="Canonical name" required aria-label="Canonical name" />
        <Input name="registrationNumber" placeholder="Registration number" aria-label="Registration number" />
        <Input name="website" placeholder="Website" aria-label="Website" />
        <Button type="submit">Create company</Button>
        {error ? <p className="text-sm text-rust md:col-span-4">{error}</p> : null}
      </form>

      {!data.items.length ? (
        <div className="mt-6">
          <EmptyState title="No companies yet." body="Create one here, then attach evidence." />
        </div>
      ) : (
        <table className="mt-6 w-full text-left text-sm">
          <thead className="border-y border-rule text-xs uppercase text-muted">
            <tr>
              <th className="py-2 font-medium">Name</th>
              <th className="py-2 font-medium">Visibility</th>
              <th className="py-2 font-medium">Automation</th>
              <th className="py-2 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((row) => (
              <tr key={row.id} className="border-b border-rule">
                <td className="py-2">
                  <Link to="/admin/companies/$id" params={{ id: row.id }} className="hover:underline">
                    {row.canonical_name}
                  </Link>
                  <div className="text-xs text-muted">{row.registration_number}</div>
                </td>
                <td>{row.visibility}</td>
                <td>{row.automation_state}</td>
                <td>{formatWhen(row.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
