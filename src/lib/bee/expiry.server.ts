import { applyLifecycleForEntity } from "./publication.server.ts";
import { ensureReviewItem } from "./review.server.ts";
import { getExpiringSoonDays } from "./settings.server.ts";
import type { Sql } from "./db-types.ts";

export async function processExpiries(db: Sql): Promise<{ updated: number }> {
  const days = await getExpiringSoonDays(db);
  const rows = await db.query<{ entity_id: string }>(
    `select distinct l.entity_id
     from evidence_entity_links l
     join evidence e on e.id = l.evidence_id
     join entities n on n.id = l.entity_id
     where e.publication_state = 'published'
       and n.merged_into_id is null
       and l.entity_id is not null`,
  );
  let updated = 0;
  for (const row of rows) {
    const out = await applyLifecycleForEntity(db, row.entity_id, days);
    updated += out.updated;
    if (out.disputed && out.reason) {
      await ensureReviewItem(db, {
        type: "conflicting_evidence",
        reason: out.reason,
        severity: "high",
        entityId: row.entity_id,
        evidenceId: out.supportingEvidenceId,
        payload: { disputed: true },
      });
    }
  }
  return { updated };
}
