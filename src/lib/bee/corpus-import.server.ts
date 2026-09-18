import { timingSafeEqual } from "node:crypto";
import { addAlias, createEntity, createRelationship, setClassification } from "./entities.server.ts";
import { sha256HexNode } from "./hash.ts";
import { ingestDocument, rerunExtraction } from "./pipeline.server.ts";
import { createSource } from "./crawler.server.ts";
import { getExpiringSoonDays } from "./settings.server.ts";
import { publishEvidence } from "./publication.server.ts";
import { normalizeName, normalizeRegistration } from "./normalize.ts";
import type { Sql } from "./db-types.ts";

/** SHA-256 of the one-time corpus import bearer. Token is not in git. */
export const CORPUS_IMPORT_TOKEN_SHA256 =
  "9040152a95910e520a9d047410a68eb9e6ddd57a1b0ef9b5b8048e95fd6c432b";

const ACTOR = "import:corpus-2026";

export type CorpusEvidence = {
  url: string;
  evidenceType?: string;
  title?: string;
};

export type CorpusSource = {
  url: string;
  sourceType?: string;
  frequency?: "daily" | "weekly" | "monthly" | "manual";
};

export type CorpusItem = {
  canonicalName: string;
  legalName?: string;
  tradingName?: string;
  registrationNumber?: string;
  website?: string;
  aliases?: string[];
  sectorIds?: string[];
  jseListed?: boolean;
  parentName?: string;
  entityType?: string;
  evidence?: CorpusEvidence[];
  sources?: CorpusSource[];
  publishIfSafe?: boolean;
};

export type ImportItemResult = {
  canonicalName: string;
  entityId: string | null;
  created: boolean;
  duplicateEntity: boolean;
  published: boolean;
  evidence: Array<{
    url: string;
    evidenceId?: string;
    duplicate?: boolean;
    autoPublished?: boolean;
    published?: boolean;
    reviewItemId?: string | null;
    error?: string;
    retried?: boolean;
  }>;
  sources: Array<{ url: string; sourceId?: string; error?: string }>;
  error?: string;
};

function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== 32 || right.length !== 32) return false;
  return timingSafeEqual(left, right);
}

export function authorizeCorpusImport(header: string | null): boolean {
  if (!header?.toLowerCase().startsWith("bearer ")) return false;
  const token = header.slice(7).trim();
  if (!token) return false;
  const cron = process.env.CRON_SECRET?.trim();
  if (cron && token === cron) return true;
  return hashesEqual(sha256HexNode(token), CORPUS_IMPORT_TOKEN_SHA256);
}

async function findExistingEntity(
  db: Sql,
  input: { canonicalName: string; registrationNumber?: string | null },
): Promise<{ id: string; via: string } | null> {
  const reg = input.registrationNumber ? normalizeRegistration(input.registrationNumber) : null;
  if (reg) {
    const byReg = await db.query<{ id: string }>(
      `select id from entities
       where registration_number_normalized = $1 and merged_into_id is null
       limit 1`,
      [reg],
    );
    if (byReg[0]) return { id: byReg[0].id, via: "registration_number" };
  }
  const name = normalizeName(input.canonicalName);
  const byName = await db.query<{ id: string }>(
    `select id from entities
     where normalized_name = $1 and merged_into_id is null
     limit 1`,
    [name],
  );
  if (byName[0]) return { id: byName[0].id, via: "canonical_name" };
  const byAlias = await db.query<{ entity_id: string }>(
    `select a.entity_id from entity_aliases a
     join entities e on e.id = a.entity_id
     where a.normalized_alias = $1 and e.merged_into_id is null
     limit 1`,
    [name],
  );
  if (byAlias[0]) return { id: byAlias[0].entity_id, via: "alias" };
  return null;
}

async function findParentId(db: Sql, parentName: string): Promise<string | null> {
  const found = await findExistingEntity(db, { canonicalName: parentName });
  return found?.id ?? null;
}

function reviewUnsafe(type: string | null | undefined): boolean {
  if (!type) return false;
  return (
    type === "registration_number_conflict" ||
    type === "conflicting_evidence" ||
    type === "manual_lock_conflict"
  );
}

async function pendingReviewId(db: Sql, evidenceId: string): Promise<string | null> {
  const rows = await db.query<{ id: string; type: string }>(
    `select id, type from review_items
     where evidence_id = $1 and status in ('pending', 'in_review')
     order by created_at desc
     limit 1`,
    [evidenceId],
  );
  if (!rows[0]) return null;
  if (reviewUnsafe(rows[0].type)) return null;
  return rows[0].id;
}

export async function publishLinkedEvidence(
  db: Sql,
  input: { evidenceId: string; entityId: string; expiringSoonDays: number },
): Promise<{ published: boolean; error?: string; reviewItemId?: string | null }> {
  const evidence = await db.query<{ publication_state: string; extraction_state: string; asset_id: string | null }>(
    "select publication_state, extraction_state, asset_id from evidence where id = $1",
    [input.evidenceId],
  );
  const row = evidence[0];
  if (!row) return { published: false, error: "Evidence not found." };
  if (row.publication_state === "published") return { published: true };

  if (row.extraction_state !== "extracted" && row.asset_id) {
    try {
      await rerunExtraction(db, input.evidenceId, ACTOR);
    } catch (err) {
      return { published: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  const reviewItemId = await pendingReviewId(db, input.evidenceId);
  const unsafe = await db.query<{ type: string }>(
    `select type from review_items
     where evidence_id = $1 and status in ('pending', 'in_review')
     order by created_at desc limit 1`,
    [input.evidenceId],
  );
  if (reviewUnsafe(unsafe[0]?.type)) {
    return { published: false, error: `Held for review: ${unsafe[0].type}`, reviewItemId: null };
  }

  const published = await publishEvidence(db, {
    evidenceId: input.evidenceId,
    entityId: input.entityId,
    actorType: "import",
    actorId: ACTOR,
    reviewItemId,
    reason: "Initial corpus import: official-domain evidence linked to the named legal entity.",
    expiringSoonDays: input.expiringSoonDays,
  });
  if (published.ok) return { published: true, reviewItemId };
  return { published: false, error: published.error, reviewItemId };
}

export async function retryUnpublished(db: Sql, limit = 8): Promise<{
  attempted: number;
  published: number;
  results: Array<{ evidenceId: string; entityId: string; published: boolean; error?: string }>;
}> {
  const rows = await db.query<{ evidence_id: string; entity_id: string }>(
    `select e.id as evidence_id, el.entity_id
     from evidence e
     join evidence_entity_links el on el.evidence_id = e.id
     join entities n on n.id = el.entity_id
     where e.publication_state = 'unpublished'
       and n.merged_into_id is null
     order by e.created_at asc
     limit $1`,
    [limit],
  );
  const days = await getExpiringSoonDays(db);
  const results: Array<{ evidenceId: string; entityId: string; published: boolean; error?: string }> = [];
  let published = 0;
  for (const row of rows) {
    const out = await publishLinkedEvidence(db, {
      evidenceId: row.evidence_id,
      entityId: row.entity_id,
      expiringSoonDays: days,
    });
    if (out.published) published += 1;
    results.push({
      evidenceId: row.evidence_id,
      entityId: row.entity_id,
      published: out.published,
      error: out.error,
    });
  }
  return { attempted: rows.length, published, results };
}

export async function importCorpusItem(db: Sql, item: CorpusItem): Promise<ImportItemResult> {
  const result: ImportItemResult = {
    canonicalName: item.canonicalName,
    entityId: null,
    created: false,
    duplicateEntity: false,
    published: false,
    evidence: [],
    sources: [],
  };
  const name = item.canonicalName.trim();
  if (name.length < 2) {
    result.error = "canonicalName is required.";
    return result;
  }

  const existing = await findExistingEntity(db, {
    canonicalName: name,
    registrationNumber: item.registrationNumber,
  });
  let entityId: string;
  if (existing) {
    entityId = existing.id;
    result.duplicateEntity = true;
    result.entityId = entityId;
  } else {
    try {
      const created = await createEntity(db, {
        canonicalName: name,
        legalName: item.legalName ?? name,
        tradingName: item.tradingName,
        registrationNumber: item.registrationNumber,
        website: item.website,
        entityType: item.entityType ?? "company",
        visibility: "draft",
        automationState: "review_only",
        actorId: ACTOR,
      });
      entityId = created.id;
      result.created = true;
      result.entityId = entityId;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const again = await findExistingEntity(db, {
        canonicalName: name,
        registrationNumber: item.registrationNumber,
      });
      if (!again) {
        result.error = message;
        return result;
      }
      entityId = again.id;
      result.duplicateEntity = true;
      result.entityId = entityId;
    }
  }

  for (const alias of item.aliases ?? []) {
    if (alias.trim() && normalizeName(alias) !== normalizeName(name)) {
      await addAlias(db, { entityId, alias: alias.trim(), aliasType: "other", actorId: ACTOR });
    }
  }

  const sectors = new Set(item.sectorIds ?? []);
  if (item.jseListed) sectors.add("sec_jse");
  for (const sectorId of sectors) {
    try {
      await setClassification(db, { entityId, sectorId, actorId: ACTOR });
    } catch {
      // unknown sector id — skip
    }
  }

  if (item.parentName?.trim()) {
    const parentId = await findParentId(db, item.parentName.trim());
    if (parentId && parentId !== entityId) {
      const already = await db.query<{ id: string }>(
        `select id from entity_relationships
         where source_entity_id = $1 and target_entity_id = $2 and relationship_type = 'parent'
         limit 1`,
        [entityId, parentId],
      );
      if (!already[0]) {
        await createRelationship(db, {
          sourceEntityId: entityId,
          targetEntityId: parentId,
          relationshipType: "parent",
          publicStatus: "public",
          actorId: ACTOR,
        });
      }
    }
  }

  const sourceUrls = new Map<string, CorpusSource>();
  for (const source of item.sources ?? []) {
    if (source.url) sourceUrls.set(source.url, source);
  }
  for (const ev of item.evidence ?? []) {
    if (ev.url && !sourceUrls.has(ev.url)) {
      sourceUrls.set(ev.url, { url: ev.url, sourceType: "certificate", frequency: "monthly" });
    }
  }
  if (item.website && !sourceUrls.has(item.website)) {
    sourceUrls.set(item.website, { url: item.website, sourceType: "other", frequency: "monthly" });
  }

  for (const source of sourceUrls.values()) {
    try {
      const sourceId = await createSource(db, {
        url: source.url,
        entityId,
        sourceType: source.sourceType ?? "other",
        frequency: source.frequency ?? "monthly",
        actorId: ACTOR,
      });
      result.sources.push({ url: source.url, sourceId });
    } catch (err) {
      result.sources.push({
        url: source.url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const days = await getExpiringSoonDays(db);
  const shouldPublish = item.publishIfSafe !== false;
  for (const ev of item.evidence ?? []) {
    if (!ev.url) continue;
    try {
      const ingested = await ingestDocument(db, {
        url: ev.url,
        title: ev.title ?? ev.url,
        evidenceType: ev.evidenceType ?? "bee_certificate",
        entityId,
        actorType: "import",
        actorId: ACTOR,
      });
      const row: ImportItemResult["evidence"][number] = {
        url: ev.url,
        evidenceId: ingested.evidenceId,
        duplicate: ingested.duplicate,
        autoPublished: ingested.autoPublished,
        reviewItemId: ingested.reviewItemId,
      };
      if (ingested.duplicate) {
        const links = await db.query<{ entity_id: string }>(
          "select entity_id from evidence_entity_links where evidence_id = $1",
          [ingested.evidenceId],
        );
        const linkedHere = links.some((l) => l.entity_id === entityId);
        const publishedAlready = await db.query<{ publication_state: string }>(
          "select publication_state from evidence where id = $1",
          [ingested.evidenceId],
        );
        if (publishedAlready[0]?.publication_state === "published" || !linkedHere) {
          result.evidence.push(row);
          continue;
        }
        if (shouldPublish) {
          const retried = await publishLinkedEvidence(db, {
            evidenceId: ingested.evidenceId,
            entityId,
            expiringSoonDays: days,
          });
          row.retried = true;
          row.published = retried.published;
          if (retried.published) result.published = true;
          else row.error = retried.error;
          if (retried.reviewItemId) row.reviewItemId = retried.reviewItemId;
        }
        result.evidence.push(row);
        continue;
      }
      if (ingested.autoPublished) {
        row.published = true;
        result.published = true;
      } else if (shouldPublish && !ingested.extractionFailed) {
        let unsafe = false;
        if (ingested.reviewItemId) {
          const review = await db.query<{ type: string }>(
            "select type from review_items where id = $1",
            [ingested.reviewItemId],
          );
          unsafe = reviewUnsafe(review[0]?.type);
        }
        if (!unsafe) {
          const published = await publishEvidence(db, {
            evidenceId: ingested.evidenceId,
            entityId,
            actorType: "import",
            actorId: ACTOR,
            reviewItemId: ingested.reviewItemId,
            reason: "Initial corpus import: official-domain evidence linked to the named legal entity.",
            expiringSoonDays: days,
          });
          if (published.ok) {
            row.published = true;
            result.published = true;
          } else {
            row.error = published.error;
          }
        } else {
          row.error = "Held for review due to a conflict.";
        }
      }
      result.evidence.push(row);
    } catch (err) {
      result.evidence.push({
        url: ev.url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (result.published) {
    await db.query(
      "update entities set visibility = 'public', updated_at = now() where id = $1 and visibility = 'draft'",
      [entityId],
    );
  }

  return result;
}

export async function importCorpusBatch(db: Sql, items: CorpusItem[]): Promise<{
  results: ImportItemResult[];
  duplicateEntityAttempts: number;
  duplicateDocuments: number;
  published: number;
  reviewHeld: number;
}> {
  const results: ImportItemResult[] = [];
  let duplicateEntityAttempts = 0;
  let duplicateDocuments = 0;
  let published = 0;
  let reviewHeld = 0;
  for (const item of items) {
    const row = await importCorpusItem(db, item);
    results.push(row);
    if (row.duplicateEntity) duplicateEntityAttempts += 1;
    for (const ev of row.evidence) {
      if (ev.duplicate) duplicateDocuments += 1;
      if (ev.published || ev.autoPublished) published += 1;
      else if (ev.reviewItemId && !ev.published) reviewHeld += 1;
    }
  }
  return { results, duplicateEntityAttempts, duplicateDocuments, published, reviewHeld };
}