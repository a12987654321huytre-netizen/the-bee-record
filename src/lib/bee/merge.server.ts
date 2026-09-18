import { audit } from "./audit.server.ts";
import { newId } from "./ids.ts";
import { rebuildCurrentState } from "./publication.server.ts";
import { jsonText, type Sql } from "./db-types.ts";

export async function mergeEntities(
  db: Sql,
  input: { survivorId: string; absorbedId: string; actorId: string; notes?: string | null; expiringSoonDays: number },
): Promise<{ ok: true; mergeId: string } | { ok: false; error: string }> {
  if (input.survivorId === input.absorbedId) return { ok: false, error: "Cannot merge an entity into itself." };
  const rows = await db.query<Record<string, unknown>>(
    "select * from entities where id = $1 or id = $2",
    [input.survivorId, input.absorbedId],
  );
  const survivor = rows.find((r) => r.id === input.survivorId);
  const absorbed = rows.find((r) => r.id === input.absorbedId);
  if (!survivor || !absorbed) return { ok: false, error: "One of the entities was not found." };
  if (survivor.merged_into_id) return { ok: false, error: "The surviving entity has itself been merged." };
  if (absorbed.merged_into_id) return { ok: false, error: "The duplicate entity has already been merged." };

  const aliases = await db.query("select * from entity_aliases where entity_id = $1", [input.absorbedId]);
  const rels = await db.query("select * from entity_relationships where source_entity_id = $1 or target_entity_id = $1", [
    input.absorbedId,
  ]);
  const classes = await db.query("select * from entity_classifications where entity_id = $1", [input.absorbedId]);
  const links = await db.query("select * from evidence_entity_links where entity_id = $1", [input.absorbedId]);
  const sources = await db.query("select * from monitored_sources where entity_id = $1", [input.absorbedId]);
  const snapshot = {
    entity: absorbed,
    aliases,
    relationships: rels,
    classifications: classes,
    evidenceLinks: links,
    sources,
  };

  const mergeId = newId("mrg");
  await db.query(
    `insert into entity_merge_events (id, survivor_id, absorbed_id, absorbed_snapshot, created_by, notes)
     values ($1,$2,$3,$4,$5,$6)`,
    [mergeId, input.survivorId, input.absorbedId, jsonText(snapshot), input.actorId, input.notes ?? null],
  );

  for (const alias of aliases as Array<{ alias: string; normalized_alias: string; alias_type: string }>) {
    const exists = await db.query<{ id: string }>(
      "select id from entity_aliases where entity_id = $1 and normalized_alias = $2 limit 1",
      [input.survivorId, alias.normalized_alias],
    );
    if (!exists.length) {
      await db.query(
        `insert into entity_aliases (id, entity_id, alias, normalized_alias, alias_type, source, reviewed_status)
         values ($1,$2,$3,$4,$5,'merge','reviewed')`,
        [newId("als"), input.survivorId, alias.alias, alias.normalized_alias, alias.alias_type],
      );
    }
  }

  await db.query(
    `update entity_relationships set source_entity_id = $1
     where source_entity_id = $2 and target_entity_id <> $1`,
    [input.survivorId, input.absorbedId],
  );
  await db.query(
    `update entity_relationships set target_entity_id = $1
     where target_entity_id = $2 and source_entity_id <> $1`,
    [input.survivorId, input.absorbedId],
  );
  await db.query(
    "delete from entity_relationships where source_entity_id = $1 or target_entity_id = $1",
    [input.absorbedId],
  );

  for (const cls of classes as Array<{ sector_id: string; classification_type: string; is_public: number }>) {
    const exists = await db.query<{ id: string }>(
      "select id from entity_classifications where entity_id = $1 and sector_id = $2 and classification_type = $3",
      [input.survivorId, cls.sector_id, cls.classification_type],
    );
    if (!exists.length) {
      await db.query(
        `insert into entity_classifications (id, entity_id, sector_id, classification_type, is_public)
         values ($1,$2,$3,$4,$5)`,
        [newId("cls"), input.survivorId, cls.sector_id, cls.classification_type, cls.is_public],
      );
    }
  }

  const linkRows = links as Array<{
    id: string;
    evidence_id: string;
    link_state: string;
    extracted_name: string | null;
    match_method: string | null;
    confidence: number | null;
    registration_match: number;
    reason: string | null;
  }>;
  for (const link of linkRows) {
    const exists = await db.query<{ id: string }>(
      "select id from evidence_entity_links where evidence_id = $1 and entity_id = $2 limit 1",
      [link.evidence_id, input.survivorId],
    );
    if (exists.length) {
      await db.query("delete from evidence_entity_links where id = $1", [link.id]);
    } else {
      await db.query("update evidence_entity_links set entity_id = $2 where id = $1", [link.id, input.survivorId]);
    }
  }

  await db.query("update monitored_sources set entity_id = $1 where entity_id = $2", [
    input.survivorId,
    input.absorbedId,
  ]);
  await db.query("update published_claims set entity_id = $1 where entity_id = $2", [
    input.survivorId,
    input.absorbedId,
  ]);
  await db.query("delete from entity_current_state where entity_id = $1", [input.absorbedId]);
  await db.query("update review_items set entity_id = $1 where entity_id = $2", [input.survivorId, input.absorbedId]);
  await db.query("update submissions set linked_entity_id = $1 where linked_entity_id = $2", [
    input.survivorId,
    input.absorbedId,
  ]);

  if (!survivor.registration_number && absorbed.registration_number) {
    await db.query(
      `update entities set registration_number = $2, registration_number_normalized = $3, updated_at = now()
       where id = $1`,
      [input.survivorId, absorbed.registration_number, absorbed.registration_number_normalized],
    );
  }

  await db.query(
    `insert into entity_aliases (id, entity_id, alias, normalized_alias, alias_type, source, reviewed_status)
     values ($1,$2,$3,$4,'former','merge','reviewed')`,
    [
      newId("als"),
      input.survivorId,
      String(absorbed.canonical_name),
      String(absorbed.normalized_name),
    ],
  );

  await db.query(
    "update entities set merged_into_id = $1, visibility = 'hidden', updated_at = now() where id = $2",
    [input.survivorId, input.absorbedId],
  );

  await rebuildCurrentState(db, input.survivorId, input.expiringSoonDays);

  await audit(db, {
    actorType: "admin",
    actorId: input.actorId,
    action: "entity.merged",
    targetType: "entity",
    targetId: input.survivorId,
    after: { absorbedId: input.absorbedId, mergeId },
    reason: input.notes,
  });
  return { ok: true, mergeId };
}

export async function unmergeEntities(
  db: Sql,
  input: { mergeId: string; actorId: string; expiringSoonDays: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = await db.query<{
    id: string;
    survivor_id: string;
    absorbed_id: string;
    absorbed_snapshot: string;
    unmerged_at: string | null;
  }>("select id, survivor_id, absorbed_id, absorbed_snapshot, unmerged_at from entity_merge_events where id = $1", [
    input.mergeId,
  ]);
  const event = rows[0];
  if (!event) return { ok: false, error: "Merge event not found." };
  if (event.unmerged_at) return { ok: false, error: "This merge has already been reversed." };

  await db.query(
    "update entities set merged_into_id = null, visibility = 'draft', updated_at = now() where id = $1",
    [event.absorbed_id],
  );
  await db.query(
    "update entity_merge_events set unmerged_at = now(), unmerged_by = $2 where id = $1",
    [input.mergeId, input.actorId],
  );
  await rebuildCurrentState(db, event.survivor_id, input.expiringSoonDays);
  await audit(db, {
    actorType: "admin",
    actorId: input.actorId,
    action: "entity.unmerged",
    targetType: "entity",
    targetId: event.absorbed_id,
    after: { survivorId: event.survivor_id, mergeId: input.mergeId },
  });
  return { ok: true };
}
