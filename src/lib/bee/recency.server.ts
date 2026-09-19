import { audit } from "./audit.server.ts";
import { isDisclosureEvidence, isStatusEvidence } from "./constants.ts";
import { isModernProcurementEvidence } from "./recency.ts";
import type { Sql } from "./db-types.ts";

const ACTOR = "import:recency-2026";

export type StaleEntityRow = {
  id: string;
  slug: string;
  canonical_name: string;
  evidence: Array<{
    id: string;
    type: string;
    issue_date: string | Date | null;
    source_url: string | null;
    title: string | null;
  }>;
};

function isCertificateClass(type: string): boolean {
  return isStatusEvidence(type) || (!isDisclosureEvidence(type) && Boolean(type));
}

export function entityIsStaleProcurementOnly(row: StaleEntityRow): boolean {
  const published = row.evidence ?? [];
  if (!published.length) return false;
  if (published.some((ev) => isCertificateClass(ev.type))) return false;
  const disclosures = published.filter((ev) => isDisclosureEvidence(ev.type));
  if (!disclosures.length) return false;
  return !disclosures.some((ev) =>
    isModernProcurementEvidence({
      issueDate: ev.issue_date,
      sourceUrl: ev.source_url,
      title: ev.title,
    }),
  );
}

export async function listStaleProcurementEntities(db: Sql): Promise<StaleEntityRow[]> {
  const rows = await db.query<{
    id: string;
    slug: string;
    canonical_name: string;
    evidence: StaleEntityRow["evidence"] | string;
  }>(
    `select e.id, e.slug, e.canonical_name,
            json_agg(json_build_object(
              'id', ev.id,
              'type', ev.evidence_type,
              'issue_date', ev.issue_date,
              'source_url', ev.source_url,
              'title', ev.title
            )) as evidence
     from entities e
     join evidence_entity_links l on l.entity_id = e.id and l.link_state in ('confirmed','extracted')
     join evidence ev on ev.id = l.evidence_id and ev.publication_state = 'published'
     where e.visibility = 'public' and e.merged_into_id is null
     group by e.id, e.slug, e.canonical_name`,
  );
  return rows
    .map((row) => ({
      ...row,
      evidence: typeof row.evidence === "string" ? (JSON.parse(row.evidence) as StaleEntityRow["evidence"]) : row.evidence,
    }))
    .filter(entityIsStaleProcurementOnly);
}

export async function unpublishStaleProcurementEntities(
  db: Sql,
  input: { limit?: number; dryRun?: boolean } = {},
): Promise<{
  stale: number;
  unpublished: number;
  dryRun: boolean;
  remaining: number;
  samples: Array<{ id: string; slug: string; canonical_name: string }>;
}> {
  const stale = await listStaleProcurementEntities(db);
  const limit = Math.max(1, Math.min(input.limit ?? stale.length, stale.length || 1));
  const batch = stale.slice(0, input.limit ? limit : stale.length);
  let unpublished = 0;
  if (!input.dryRun) {
    for (const row of batch) {
      await db.query(
        "update entities set visibility = 'hidden', updated_at = now() where id = $1 and visibility = 'public'",
        [row.id],
      );
      await audit(db, {
        actorType: "import",
        actorId: ACTOR,
        action: "entity.unpublished",
        targetType: "entity",
        targetId: row.id,
        before: { visibility: "public" },
        after: { visibility: "hidden" },
        reason:
          "Procurement-only public page withdrawn: no 2024–2026 evidence. Older procurement records were kept as historical evidence.",
      });
      unpublished += 1;
    }
  }
  const remaining = input.dryRun ? stale.length : Math.max(0, stale.length - unpublished);
  return {
    stale: stale.length,
    unpublished: input.dryRun ? 0 : unpublished,
    dryRun: Boolean(input.dryRun),
    remaining,
    samples: batch.slice(0, 25).map((row) => ({
      id: row.id,
      slug: row.slug,
      canonical_name: row.canonical_name,
    })),
  };
}
