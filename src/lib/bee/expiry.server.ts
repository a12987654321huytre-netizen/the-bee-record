import { expiryStatus, todayIso } from "./dates.ts";
import { rebuildCurrentState } from "./publication.server.ts";
import { getExpiringSoonDays } from "./settings.server.ts";
import type { Sql } from "./db-types.ts";

export async function processExpiries(db: Sql): Promise<{ updated: number }> {
  const days = await getExpiringSoonDays(db);
  const today = todayIso();
  const rows = await db.query<{ id: string; entity_id: string | null; expiry_date: string | null; lifecycle_state: string }>(
    `select e.id, l.entity_id, e.expiry_date, e.lifecycle_state
     from evidence e
     left join evidence_entity_links l on l.evidence_id = e.id and l.link_state in ('confirmed','extracted','candidate')
     where e.publication_state = 'published'
       and e.expiry_date is not null
       and e.lifecycle_state in ('current','expiring_soon','expired')`,
  );
  let updated = 0;
  const entities = new Set<string>();
  for (const row of rows) {
    const next = expiryStatus(row.expiry_date, row.lifecycle_state === "expired" ? "current" : row.lifecycle_state, days, today);
    if (next !== row.lifecycle_state) {
      await db.query("update evidence set lifecycle_state = $2, updated_at = now() where id = $1", [row.id, next]);
      updated += 1;
    }
    if (row.entity_id) entities.add(row.entity_id);
  }
  for (const entityId of entities) {
    await rebuildCurrentState(db, entityId, days);
  }
  return { updated };
}
