import { createFileRoute, Link, useRouter, useRouteContext } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import {
  addAliasFn,
  addNoteFn,
  addRelationshipFn,
  getAdminCompany,
  lockFieldFn,
  mergeCompaniesFn,
  removeAliasFn,
  runEnrichmentPassFn,
  setClassificationFn,
  unmergeCompaniesFn,
  updateCompanyFn,
} from "@/lib/bee/admin.functions";
import { formatWhen } from "@/lib/bee/format";

export const Route = createFileRoute("/admin/companies/$id")({
  loader: ({ params }) => getAdminCompany({ data: { id: params.id } }),
  component: CompanyAdmin,
});

function CompanyAdmin() {
  const data = Route.useLoaderData();
  const ctx = useRouteContext({ from: "/admin" });
  const router = useRouter();
  const csrf = ctx.session?.csrf ?? "";
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const entity = data.entity as {
    id: string;
    canonical_name: string;
    legal_name: string | null;
    trading_name: string | null;
    registration_number: string | null;
    website: string | null;
    description: string | null;
    visibility: string;
    automation_state: string;
    slug: string;
    merged_into_id: string | null;
  };

  async function refresh() {
    await router.invalidate();
  }

  return (
    <div className="grid gap-8 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-8">
        <div>
          <p className="font-mono text-xs text-muted">{entity.id}</p>
          <h1 className="font-display text-3xl">{entity.canonical_name}</h1>
          <p className="text-sm">
            Public: <Link to="/companies/$slug" params={{ slug: entity.slug }} className="underline underline-offset-4">/{entity.slug}</Link>
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              disabled={enrichBusy}
              onClick={async () => {
                setEnrichBusy(true);
                setEnrichError(null);
                try {
                  const result = await runEnrichmentPassFn({ data: { csrf, batchSize: 10, entityId: entity.id } });
                  await router.navigate({ to: "/admin/jobs/$id", params: { id: result.jobId } });
                } catch (err) {
                  setEnrichError(err instanceof Error ? err.message : "Enrichment failed.");
                  setEnrichBusy(false);
                }
              }}
            >
              {enrichBusy ? "Starting…" : "Enrich this company"}
            </Button>
          </div>
          {enrichError ? <p className="mt-2 text-sm text-rust">{enrichError}</p> : null}
        </div>

        <form
          className="grid gap-3 md:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            await updateCompanyFn({
              data: {
                csrf,
                id: entity.id,
                canonicalName: String(f.get("canonicalName")),
                legalName: String(f.get("legalName") || "") || null,
                tradingName: String(f.get("tradingName") || "") || null,
                registrationNumber: String(f.get("registrationNumber") || "") || null,
                website: String(f.get("website") || "") || null,
                description: String(f.get("description") || "") || null,
                visibility: String(f.get("visibility")) as "draft" | "public" | "hidden",
                automationState: String(f.get("automationState")) as "automation_allowed" | "review_only" | "locked",
              },
            });
            await refresh();
          }}
        >
          <div className="md:col-span-2">
            <Label htmlFor="canonicalName">Canonical name</Label>
            <Input id="canonicalName" name="canonicalName" className="mt-1" defaultValue={entity.canonical_name} />
          </div>
          <div>
            <Label htmlFor="legalName">Legal name</Label>
            <Input id="legalName" name="legalName" className="mt-1" defaultValue={entity.legal_name ?? ""} />
          </div>
          <div>
            <Label htmlFor="tradingName">Trading name</Label>
            <Input id="tradingName" name="tradingName" className="mt-1" defaultValue={entity.trading_name ?? ""} />
          </div>
          <div>
            <Label htmlFor="registrationNumber">Registration number</Label>
            <Input id="registrationNumber" name="registrationNumber" className="mt-1" defaultValue={entity.registration_number ?? ""} />
          </div>
          <div>
            <Label htmlFor="website">Website</Label>
            <Input id="website" name="website" className="mt-1" defaultValue={entity.website ?? ""} />
          </div>
          <div>
            <Label htmlFor="visibility">Visibility</Label>
            <Select id="visibility" name="visibility" className="mt-1" defaultValue={entity.visibility}>
              <option value="draft">draft</option>
              <option value="public">public</option>
              <option value="hidden">hidden</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="automationState">Automation</Label>
            <Select id="automationState" name="automationState" className="mt-1" defaultValue={entity.automation_state}>
              <option value="review_only">review only</option>
              <option value="automation_allowed">automation allowed</option>
              <option value="locked">locked</option>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" name="description" className="mt-1" defaultValue={entity.description ?? ""} />
          </div>
          <Button type="submit">Save metadata</Button>
        </form>

        <section>
          <h2 className="font-display text-xl">Evidence</h2>
          <ul className="mt-2 divide-y divide-rule border-y border-rule text-sm">
            {(data.evidence as Array<{ id: string; title: string | null; lifecycle_state: string; review_state: string }>).map((ev) => (
              <li key={ev.id} className="py-2">
                <Link to="/admin/evidence/$id" params={{ id: ev.id }} className="hover:underline">
                  {ev.title ?? ev.id}
                </Link>
                <span className="ml-2 text-muted">
                  {ev.lifecycle_state} / {ev.review_state}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm">
            <Link to="/admin/evidence" className="underline underline-offset-4">
              Add evidence
            </Link>
          </p>
        </section>
      </div>

      <aside className="space-y-8 text-sm">
        <section>
          <h2 className="font-display text-xl">Aliases</h2>
          <ul className="mt-2 space-y-1">
            {(data.aliases as Array<{ id: string; alias: string; alias_type: string }>).map((a) => (
              <li key={a.id} className="flex justify-between gap-2">
                <span>
                  {a.alias} <span className="text-muted">({a.alias_type})</span>
                </span>
                <button
                  type="button"
                  className="text-rust underline"
                  onClick={async () => {
                    await removeAliasFn({ data: { csrf, aliasId: a.id } });
                    await refresh();
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <form
            className="mt-2 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              await addAliasFn({ data: { csrf, entityId: entity.id, alias: String(f.get("alias")), aliasType: String(f.get("aliasType") || "other") } });
              (e.currentTarget as HTMLFormElement).reset();
              await refresh();
            }}
          >
            <Input name="alias" placeholder="Alias" required />
            <Button type="submit" variant="ghost">
              Add
            </Button>
          </form>
        </section>

        <section>
          <h2 className="font-display text-xl">Sectors</h2>
          <ul className="mt-2 space-y-1">
            {(data.classifications as Array<{ sector_id: string; sector_name: string }>).map((c) => (
              <li key={c.sector_id} className="flex justify-between">
                {c.sector_name}
                <button
                  type="button"
                  className="text-rust underline"
                  onClick={async () => {
                    await setClassificationFn({ data: { csrf, entityId: entity.id, sectorId: c.sector_id, remove: true } });
                    await refresh();
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <form
            className="mt-2 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              await setClassificationFn({ data: { csrf, entityId: entity.id, sectorId: String(f.get("sectorId")) } });
              await refresh();
            }}
          >
            <Select name="sectorId" required>
              {(data.sectors as Array<{ id: string; name: string }>).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="ghost">
              Add
            </Button>
          </form>
        </section>

        <section>
          <h2 className="font-display text-xl">Relationships</h2>
          <ul className="mt-2 space-y-1">
            {(data.relationships as Array<{ id: string; relationship_type: string; source_name: string; target_name: string }>).map((r) => (
              <li key={r.id}>
                {r.source_name} → {r.relationship_type} → {r.target_name}
              </li>
            ))}
          </ul>
          <form
            className="mt-2 space-y-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              await addRelationshipFn({
                data: {
                  csrf,
                  sourceEntityId: entity.id,
                  targetEntityId: String(f.get("targetEntityId")),
                  relationshipType: String(f.get("relationshipType")),
                },
              });
              await refresh();
            }}
          >
            <Select name="relationshipType" required>
              {["parent", "subsidiary", "holding_company", "operating_company", "division", "trading_brand", "group_membership", "predecessor", "successor", "other"].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            <Select name="targetEntityId" required>
              {(data.others as Array<{ id: string; canonical_name: string }>).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.canonical_name}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="ghost">
              Add relationship
            </Button>
          </form>
        </section>

        <section>
          <h2 className="font-display text-xl">Field locks</h2>
          <ul className="mt-2 space-y-1">
            {(data.locks as Array<{ field_key: string; locked: number; value: string | null }>).map((l) => (
              <li key={l.field_key} className="flex justify-between">
                <span>
                  {l.field_key} {l.locked ? "(locked)" : "(unlocked)"} {l.value ? `= ${l.value}` : ""}
                </span>
                {l.locked ? (
                  <button
                    type="button"
                    className="underline"
                    onClick={async () => {
                      await lockFieldFn({ data: { csrf, entityId: entity.id, fieldKey: l.field_key, unlock: true } });
                      await refresh();
                    }}
                  >
                    Unlock
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <form
            className="mt-2 space-y-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              await lockFieldFn({
                data: {
                  csrf,
                  entityId: entity.id,
                  fieldKey: String(f.get("fieldKey")),
                  value: String(f.get("value") || "") || undefined,
                  reason: String(f.get("reason") || "") || undefined,
                },
              });
              await refresh();
            }}
          >
            <Input name="fieldKey" placeholder="bee_level" required />
            <Input name="value" placeholder="Locked value (optional)" />
            <Input name="reason" placeholder="Reason" />
            <Button type="submit" variant="ghost">
              Lock field
            </Button>
          </form>
        </section>

        <section>
          <h2 className="font-display text-xl">Merge</h2>
          <p className="text-muted">Absorb a duplicate into this surviving company. IDs are preserved.</p>
          <form
            className="mt-2 space-y-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              await mergeCompaniesFn({
                data: { csrf, survivorId: entity.id, absorbedId: String(f.get("absorbedId")), notes: String(f.get("notes") || "") || undefined },
              });
              await refresh();
            }}
          >
            <Select name="absorbedId" required>
              {(data.others as Array<{ id: string; canonical_name: string }>).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.canonical_name}
                </option>
              ))}
            </Select>
            <Input name="notes" placeholder="Notes" />
            <Button type="submit" variant="danger">
              Merge into this company
            </Button>
          </form>
          {(data.merges as Array<{ id: string; absorbed_id: string; unmerged_at: string | null }>).map((m) => (
            <p key={m.id} className="mt-2">
              Merge {m.id.slice(0, 16)} {m.unmerged_at ? "(reversed)" : ""}
              {!m.unmerged_at ? (
                <button
                  type="button"
                  className="ml-2 underline"
                  onClick={async () => {
                    await unmergeCompaniesFn({ data: { csrf, mergeId: m.id } });
                    await refresh();
                  }}
                >
                  Unmerge
                </button>
              ) : null}
            </p>
          ))}
        </section>

        <section>
          <h2 className="font-display text-xl">Private notes</h2>
          <ul className="mt-2 space-y-2">
            {(data.notes as Array<{ id: string; body: string; created_at: string }>).map((n) => (
              <li key={n.id} className="border-t border-rule pt-2">
                <p>{n.body}</p>
                <p className="text-xs text-muted">{formatWhen(n.created_at)}</p>
              </li>
            ))}
          </ul>
          <form
            className="mt-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              await addNoteFn({ data: { csrf, targetType: "entity", targetId: entity.id, body: String(f.get("body")) } });
              (e.currentTarget as HTMLFormElement).reset();
              await refresh();
            }}
          >
            <Textarea name="body" required />
            <Button type="submit" variant="ghost" className="mt-2">
              Add note
            </Button>
          </form>
        </section>
      </aside>
    </div>
  );
}
