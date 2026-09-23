import { audit } from "./audit.server.ts";
import { newId } from "./ids.ts";
import { normalizeAlias, normalizeName, normalizeRegistration, slugify } from "./normalize.ts";
import { uniqueSlug, type Sql } from "./db-types.ts";

export async function createEntity(
  db: Sql,
  input: {
    canonicalName: string;
    legalName?: string | null;
    tradingName?: string | null;
    registrationNumber?: string | null;
    website?: string | null;
    description?: string | null;
    entityType?: string;
    visibility?: string;
    automationState?: string;
    actorId: string;
  },
) {
  const id = newId("ent");
  const name = input.canonicalName.trim();
  const slug = await uniqueSlug(db, "entities", slugify(name));
  const reg = input.registrationNumber?.trim() || null;
  await db.query(
    `insert into entities (
        id, canonical_name, normalized_name, legal_name, trading_name,
        registration_number, registration_number_normalized, website, description,
        entity_type, visibility, slug, automation_state
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      id,
      name,
      normalizeName(name),
      input.legalName?.trim() || null,
      input.tradingName?.trim() || null,
      reg,
      reg ? normalizeRegistration(reg) : null,
      input.website?.trim() || null,
      input.description?.trim() || null,
      input.entityType ?? "company",
      input.visibility ?? "draft",
      slug,
      input.automationState ?? "review_only",
    ],
  );
  if (input.tradingName?.trim() && normalizeAlias(input.tradingName) !== normalizeAlias(name)) {
    await addAlias(db, {
      entityId: id,
      alias: input.tradingName.trim(),
      aliasType: "trading",
      actorId: input.actorId,
    });
  }
  await audit(db, {
    actorType: "admin",
    actorId: input.actorId,
    action: "entity.created",
    targetType: "entity",
    targetId: id,
    after: { name, slug },
  });
  return { id, slug };
}

export async function updateEntity(
  db: Sql,
  input: {
    id: string;
    canonicalName?: string;
    legalName?: string | null;
    tradingName?: string | null;
    registrationNumber?: string | null;
    website?: string | null;
    description?: string | null;
    entityType?: string;
    visibility?: string;
    automationState?: string;
    actorId: string;
  },
) {
  const existing = await db.query<Record<string, unknown>>("select * from entities where id = $1", [input.id]);
  const row = existing[0];
  if (!row) throw new Error("Entity not found.");
  const name = input.canonicalName?.trim() ?? String(row.canonical_name);
  const reg =
    input.registrationNumber === undefined
      ? (row.registration_number as string | null)
      : input.registrationNumber?.trim() || null;
  await db.query(
    `update entities set
        canonical_name = $2,
        normalized_name = $3,
        legal_name = $4,
        trading_name = $5,
        registration_number = $6,
        registration_number_normalized = $7,
        website = $8,
        description = $9,
        entity_type = $10,
        visibility = $11,
        automation_state = $12,
        updated_at = now()
     where id = $1`,
    [
      input.id,
      name,
      normalizeName(name),
      input.legalName === undefined ? row.legal_name : input.legalName?.trim() || null,
      input.tradingName === undefined ? row.trading_name : input.tradingName?.trim() || null,
      reg,
      reg ? normalizeRegistration(reg) : null,
      input.website === undefined ? row.website : input.website?.trim() || null,
      input.description === undefined ? row.description : input.description?.trim() || null,
      input.entityType ?? row.entity_type,
      input.visibility ?? row.visibility,
      input.automationState ?? row.automation_state,
    ],
  );
  await audit(db, {
    actorType: "admin",
    actorId: input.actorId,
    action: "entity.edited",
    targetType: "entity",
    targetId: input.id,
    before: row,
    after: { name, visibility: input.visibility ?? row.visibility },
  });
}

export async function addAlias(
  db: Sql,
  input: {
    entityId: string;
    alias: string;
    aliasType?: string;
    evidenceId?: string | null;
    source?: string | null;
    actorId?: string | null;
  },
) {
  const alias = input.alias.trim();
  if (!alias) throw new Error("Alias is required.");
  const normalized = normalizeAlias(alias);
  const dup = await db.query<{ id: string }>(
    "select id from entity_aliases where entity_id = $1 and normalized_alias = $2 limit 1",
    [input.entityId, normalized],
  );
  if (dup[0]) return dup[0].id;
  const id = newId("als");
  await db.query(
    `insert into entity_aliases (id, entity_id, alias, normalized_alias, alias_type, evidence_id, source, reviewed_status)
     values ($1,$2,$3,$4,$5,$6,$7,'reviewed')`,
    [id, input.entityId, alias, normalized, input.aliasType ?? "other", input.evidenceId ?? null, input.source ?? "admin"],
  );
  return id;
}

export async function removeAlias(db: Sql, aliasId: string) {
  await db.query("delete from entity_aliases where id = $1", [aliasId]);
}

export async function createRelationship(
  db: Sql,
  input: {
    sourceEntityId: string;
    targetEntityId: string;
    relationshipType: string;
    evidenceId?: string | null;
    publicStatus?: string;
    actorId: string;
  },
) {
  if (input.sourceEntityId === input.targetEntityId) throw new Error("A company cannot be related to itself.");
  const id = newId("rel");
  await db.query(
    `insert into entity_relationships
      (id, source_entity_id, target_entity_id, relationship_type, evidence_id, confidence, review_state, public_status, created_by)
     values ($1,$2,$3,$4,$5,'reviewed','approved',$6,$7)`,
    [
      id,
      input.sourceEntityId,
      input.targetEntityId,
      input.relationshipType,
      input.evidenceId ?? null,
      input.publicStatus ?? "public",
      input.actorId,
    ],
  );
  await audit(db, {
    actorType: "admin",
    actorId: input.actorId,
    action: "relationship.changed",
    targetType: "relationship",
    targetId: id,
    after: input,
  });
  return id;
}

export async function setClassification(
  db: Sql,
  input: { entityId: string; sectorId: string; isPublic?: boolean; actorId: string; classificationType?: string },
) {
  const id = newId("cls");
  const classificationType = input.classificationType ?? "sector";
  await db.query(
    `insert into entity_classifications (id, entity_id, sector_id, classification_type, is_public)
     values ($1,$2,$3,$4,$5)
     on conflict (entity_id, sector_id, classification_type) do update set is_public = excluded.is_public`,
    [id, input.entityId, input.sectorId, classificationType, input.isPublic === false ? 0 : 1],
  );
}

export async function removeClassification(db: Sql, entityId: string, sectorId: string) {
  await db.query("delete from entity_classifications where entity_id = $1 and sector_id = $2", [entityId, sectorId]);
}

export async function lockField(
  db: Sql,
  input: { entityId: string; fieldKey: string; value?: string | null; reason?: string | null; actorId: string },
) {
  const id = newId("lck");
  await db.query(
    `insert into field_overrides (id, entity_id, field_key, locked, lock_reason, locked_by, value)
     values ($1,$2,$3,1,$4,$5,$6)
     on conflict (entity_id, field_key) do update set
       locked = 1, lock_reason = excluded.lock_reason, locked_by = excluded.locked_by,
       locked_at = now(), value = excluded.value`,
    [id, input.entityId, input.fieldKey, input.reason ?? null, input.actorId, input.value ?? null],
  );
  await audit(db, {
    actorType: "admin",
    actorId: input.actorId,
    action: "field.locked",
    targetType: "entity",
    targetId: input.entityId,
    after: { field: input.fieldKey, value: input.value ?? null },
    reason: input.reason,
  });
}

export async function unlockField(db: Sql, input: { entityId: string; fieldKey: string; actorId: string }) {
  await db.query("update field_overrides set locked = 0 where entity_id = $1 and field_key = $2", [
    input.entityId,
    input.fieldKey,
  ]);
  await audit(db, {
    actorType: "admin",
    actorId: input.actorId,
    action: "field.unlocked",
    targetType: "entity",
    targetId: input.entityId,
    after: { field: input.fieldKey },
  });
}

export async function addAdminNote(
  db: Sql,
  input: { targetType: string; targetId: string; body: string; actorId: string },
) {
  const body = input.body.trim();
  if (!body) return;
  await db.query(
    "insert into admin_notes (id, target_type, target_id, body, created_by) values ($1,$2,$3,$4,$5)",
    [newId("nte"), input.targetType, input.targetId, body, input.actorId],
  );
}
