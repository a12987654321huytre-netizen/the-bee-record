import { createFileRoute, useRouter, useRouteContext } from "@tanstack/react-router";
import { Button, EmptyState, Input } from "@/components/ui";
import { createVerifierFn, listVerifiersAdmin } from "@/lib/bee/admin.functions";

export const Route = createFileRoute("/admin/verifiers")({
  loader: () => listVerifiersAdmin(),
  component: VerifiersAdmin,
});

function VerifiersAdmin() {
  const { items } = Route.useLoaderData();
  const ctx = useRouteContext({ from: "/admin" });
  const router = useRouter();
  const csrf = ctx.session?.csrf ?? "";
  return (
    <div>
      <h1 className="font-display text-3xl">Verification agencies</h1>
      <form
        className="mt-4 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          await createVerifierFn({ data: { csrf, name: String(f.get("name")), website: String(f.get("website") || "") || undefined } });
          await router.invalidate();
        }}
      >
        <Input name="name" placeholder="Agency name" required />
        <Input name="website" placeholder="Website" />
        <Button type="submit">Add</Button>
      </form>
      {!items.length ? (
        <div className="mt-6">
          <EmptyState title="No agencies recorded." />
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-rule border-y border-rule text-sm">
          {(items as Array<{ id: string; name: string; website: string | null; slug: string }>).map((a) => (
            <li key={a.id} className="py-2">
              {a.name} {a.website ? `· ${a.website}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
