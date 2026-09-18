import { ensureAgency, ensureSignatory, canonicalAgencyName } from "./agencies.server.ts";
import { workingClaims, workingValue } from "./claims.server.ts";
import { PARSER_REPAIR } from "./constants.ts";
import { EXTRACTION_SCHEMA_VERSION } from "./constants.ts";
import { jsonText, type Sql } from "./db-types.ts";
import { extractBva, extractDeterministically } from "./deterministic-extract.ts";
import { safeFetch } from "./fetch.server.ts";
import { newId } from "./ids.ts";
import { classifyPublishedEvidence, mergeRepairClaims } from "./lifecycle.ts";
import { normalizeRegistration } from "./normalize.ts";
import { parseDocument } from "./parse.server.ts";
import { applyLifecycleForEntity, lockedFields } from "./publication.server.ts";
import { ensureReviewItem } from "./review.server.ts";
import { getExpiringSoonDays } from "./settings.server.ts";
import { readAsset } from "./storage.server.ts";
import type { ExtractedClaim } from "./types.ts";

const ACTOR = "repair:corpus-2026";

export type RepairEvidenceResult = {
  evidenceId: string;
  skipped: boolean;
  parsed: boolean;
  filled: string[];
  conflicts: Array<{ field: string; previous: string; incoming: string }>;
  agencyId: string | null;
  reviewItemIds: string[];
  textLength?: number;
  fetchFallback?: boolean;
  error?: string;
};

async function persistRepairRun(
  db: Sql,
  evidenceId: string,
  claims: ReturnType<typeof mergeRepairClaims>["claims"],
  warnings: string[],
): Promise<string> {
  const runId = newId("xrn");
  await db.query(
    `insert into extraction_runs
      (id, evidence_id, parser, model, schema_version, completed_at, success, validated_response)
     values ($1,$2,$3,null,$4,now(),1,$5)`,
    [runId, evidenceId, PARSER_REPAIR, EXTRACTION_SCHEMA_VERSION, jsonText({ claims, warnings })],
  );
  for (const claim of claims) {
    await db.query(
      `insert into extracted_claims
        (id, evidence_id, extraction_run_id, field_key, structured_value, normalized_value, raw_value,
         confidence, page_number, source_snippet, parser, section, edited_value, edited_by, edited_at,
         published_state, review_state)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        newId("clm"),
        evidenceId,
        runId,
        claim.field_key,
        claim.normalized_value,
        claim.normalized_value,
        claim.raw_value,
        claim.confidence,
        claim.page_number,
        claim.source_snippet,
        claim.parser,
        claim.section,
        claim.edited_value,
        claim.edited_by,
        claim.edited_at,
        claim.published_state,
        claim.review_state,
      ],
    );
  }
  return runId;
}

async function applyEvidenceMetadata(
  db: Sql,
  evidenceId: string,
  claims: ExtractedClaim[],
  extras: { agencyId: string | null; signatoryId: string | null },
) {
  const map = new Map(claims.map((c) => [c.field_key, workingValue(c)]));
  const issue = map.get("issue_date") ?? null;
  const expiry = map.get("expiry_date") ?? null;
  const docType = map.get("document_type") ?? map.get("certificate_type") ?? null;
  const issuer = map.get("verification_agency") ?? null;
  let typeUpdate: string | null = null;
  if (docType === "bee_certificate" || docType === "sworn_affidavit") typeUpdate = docType;
  await db.query(
    `update evidence set
        issue_date = coalesce($2, issue_date),
        expiry_date = coalesce($3, expiry_date),
        issue_date_raw = coalesce($4, issue_date_raw),
        expiry_date_raw = coalesce($5, expiry_date_raw),
        document_issuer = coalesce($6, document_issuer),
        evidence_type = coalesce($7, evidence_type),
        verifier_agency_id = coalesce($8, verifier_agency_id),
        signatory_id = coalesce($9, signatory_id),
        extraction_state = 'extracted',
        updated_at = now()
     where id = $1`,
    [
      evidenceId,
      issue && /^\d{4}-\d{2}-\d{2}$/.test(issue) ? issue : null,
      expiry && /^\d{4}-\d{2}-\d{2}$/.test(expiry) ? expiry : null,
      claims.find((c) => c.field_key === "issue_date")?.raw_value ?? null,
      claims.find((c) => c.field_key === "expiry_date")?.raw_value ?? null,
      issuer,
      typeUpdate,
      extras.agencyId,
      extras.signatoryId,
    ],
  );
}

export async function remainingRepairCount(db: Sql): Promise<number> {
  const rows = await db.query<{ n: number }>(
    `select count(*)::int as n from evidence e
     where not exists (
       select 1 from extraction_runs r
       where r.evidence_id = e.id and r.parser = $1 and r.success = 1
     )`,
    [PARSER_REPAIR],
  );
  return rows[0]?.n ?? 0;
}

export async function repairOneEvidence(db: Sql, evidenceId: string): Promise<RepairEvidenceResult> {
  const result: RepairEvidenceResult = {
    evidenceId,
    skipped: false,
    parsed: false,
    filled: [],
    conflicts: [],
    agencyId: null,
    reviewItemIds: [],
  };

  const already = await db.query<{ id: string }>(
    "select id from extraction_runs where evidence_id = $1 and parser = $2 and success = 1 limit 1",
    [evidenceId, PARSER_REPAIR],
  );
  if (already[0]) {
    result.skipped = true;
    return result;
  }

  const evidence = await db.query<{
    id: string;
    asset_id: string | null;
    mime_type: string | null;
    original_filename: string | null;
    publication_state: string;
    evidence_type: string;
    source_url: string | null;
  }>(
    "select id, asset_id, mime_type, original_filename, publication_state, evidence_type, source_url from evidence where id = $1",
    [evidenceId],
  );
  const row = evidence[0];
  if (!row) {
    result.error = "Evidence not found.";
    return result;
  }

  const links = await db.query<{
    entity_id: string;
    registration_number: string | null;
    registration_number_normalized: string | null;
    canonical_name: string;
  }>(
    `select e.id as entity_id, e.registration_number, e.registration_number_normalized, e.canonical_name
     from evidence_entity_links l
     join entities e on e.id = l.entity_id
     where l.evidence_id = $1 and l.link_state in ('confirmed','extracted','candidate')
       and e.merged_into_id is null
     order by case l.link_state when 'confirmed' then 0 when 'extracted' then 1 else 2 end
     limit 1`,
    [evidenceId],
  );
  const entity = links[0] ?? null;
  const locks = entity ? await lockedFields(db, entity.entity_id) : new Map();
  const previous = await workingClaims(db, evidenceId);

  let text = "";
  try {
    if (row.asset_id) {
      const asset = await readAsset(db, row.asset_id);
      if (asset) {
        const parsed = await parseDocument(asset.bytes, row.mime_type ?? asset.mimeType, row.original_filename ?? row.source_url);
        text = parsed.text;
      }
    }
    if (!text.trim() && row.source_url) {
      const fetched = await safeFetch(row.source_url);
      if (fetched.ok) {
        const parsed = await parseDocument(
          fetched.bytes,
          fetched.mimeType ?? row.mime_type,
          row.original_filename ?? row.source_url,
        );
        text = parsed.text;
        result.fetchFallback = true;
      } else {
        result.error = fetched.reason;
      }
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }
  result.parsed = Boolean(text.trim());
  result.textLength = text.trim().length;

  const extracted = text.trim() ? extractDeterministically(text) : { claims: [], warnings: ["No extractable text was available."], ambiguity: [] };
  const previousValues = new Map(previous.map((c) => [c.field_key, workingValue(c)]));

  const merged = mergeRepairClaims({
    previous,
    extracted: extracted.claims,
    lockedFields: new Set(locks.keys()),
    entityReg: entity?.registration_number_normalized ?? null,
    evidencePublished: row.publication_state === "published",
  });
  result.conflicts = merged.conflicts;

  for (const claim of merged.claims) {
    const before = previousValues.get(claim.field_key);
    const after = claim.edited_value?.trim() || claim.normalized_value || claim.raw_value;
    if (!before && after) result.filled.push(claim.field_key);
  }

  await persistRepairRun(db, evidenceId, merged.claims, [
    ...extracted.warnings,
    ...extracted.ambiguity,
    ...merged.conflicts.map((c) => `${c.field}: kept ${c.previous}; incoming ${c.incoming}`),
  ]);

  const claims = await workingClaims(db, evidenceId);
  const agencyName = workingValue(claims.find((c) => c.field_key === "verification_agency"));
  const bva = text ? extractBva(text) : null;
  const agencyWarning = claims.find((c) => c.field_key === "verification_agency")?.section;
  const bvaFromWarning = agencyWarning?.match(/\bBVA\s*\d{2,4}\b/i)?.[0] ?? null;
  const agencyId = await ensureAgency(db, {
    name: agencyName,
    bva: bva ?? bvaFromWarning,
    evidenceId,
  });
  result.agencyId = agencyId;

  const signatoryName = workingValue(claims.find((c) => c.field_key === "signatory"));
  const signatoryClaim = claims.find((c) => c.field_key === "signatory");
  const title = /technical\s+signatory/i.test(signatoryClaim?.source_snippet ?? "") ? "Technical Signatory" : null;
  const signatoryId = await ensureSignatory(db, { name: signatoryName, agencyId, title });

  await applyEvidenceMetadata(db, evidenceId, claims, { agencyId, signatoryId });

  if (entity) {
    const extractedReg = workingValue(claims.find((c) => c.field_key === "registration_number"));
    const extractedNorm = extractedReg ? normalizeRegistration(extractedReg) : null;
    if (extractedNorm && entity.registration_number_normalized && extractedNorm !== entity.registration_number_normalized) {
      const reviewId = await ensureReviewItem(db, {
        type: "registration_number_conflict",
        reason: `Extracted registration ${extractedReg} does not match ${entity.canonical_name} (${entity.registration_number}). Entity identifier was not overwritten.`,
        severity: "high",
        entityId: entity.entity_id,
        evidenceId,
        payload: { extractedReg, entityReg: entity.registration_number },
      });
      result.reviewItemIds.push(reviewId);
    }
    for (const conflict of merged.conflicts) {
      if (locks.has(conflict.field)) {
        const reviewId = await ensureReviewItem(db, {
          type: "manual_lock_conflict",
          reason: `Locked field ${conflict.field} differs from repaired extraction.`,
          severity: "high",
          entityId: entity.entity_id,
          evidenceId,
          payload: conflict,
        });
        result.reviewItemIds.push(reviewId);
      } else if (conflict.field !== "registration_number") {
        const reviewId = await ensureReviewItem(db, {
          type: "conflicting_evidence",
          reason: `Repair extracted a different ${conflict.field} (${conflict.incoming}) than the stored value (${conflict.previous}). Stored value was kept.`,
          severity: "normal",
          entityId: entity.entity_id,
          evidenceId,
          payload: conflict,
        });
        result.reviewItemIds.push(reviewId);
      }
    }
  }

  return result;
}

export async function repairEvidenceBatch(
  db: Sql,
  limit = 3,
): Promise<{
  processed: number;
  skipped: number;
  filled: number;
  agenciesLinked: number;
  reviews: number;
  remaining: number;
  results: RepairEvidenceResult[];
  entityIds: string[];
}> {
  const rows = await db.query<{ id: string }>(
    `select e.id from evidence e
     where not exists (
       select 1 from extraction_runs r
       where r.evidence_id = e.id and r.parser = $1 and r.success = 1
     )
     order by e.created_at asc
     limit $2`,
    [PARSER_REPAIR, limit],
  );
  const results: RepairEvidenceResult[] = [];
  const entityIds = new Set<string>();
  let skipped = 0;
  let filled = 0;
  let agenciesLinked = 0;
  let reviews = 0;
  for (const row of rows) {
    const out = await repairOneEvidence(db, row.id);
    results.push(out);
    if (out.skipped) skipped += 1;
    if (out.filled.length) filled += 1;
    if (out.agencyId) agenciesLinked += 1;
    reviews += out.reviewItemIds.length;
    const links = await db.query<{ entity_id: string }>(
      "select entity_id from evidence_entity_links where evidence_id = $1 and entity_id is not null",
      [row.id],
    );
    for (const l of links) entityIds.add(l.entity_id);
  }
  const days = await getExpiringSoonDays(db);
  for (const entityId of entityIds) {
    await applyLifecycleForEntity(db, entityId, days);
  }
  return {
    processed: rows.length,
    skipped,
    filled,
    agenciesLinked,
    reviews,
    remaining: await remainingRepairCount(db),
    results,
    entityIds: [...entityIds],
  };
}

export async function repairLifecycleBatch(
  db: Sql,
  input: { limit?: number; afterId?: string | null } = {},
): Promise<{
  processed: number;
  updated: number;
  disputed: number;
  nextAfterId: string | null;
  remaining: number;
}> {
  const limit = input.limit ?? 40;
  const afterId = input.afterId ?? null;
  const days = await getExpiringSoonDays(db);
  const rows = await db.query<{ entity_id: string }>(
    `select distinct l.entity_id
     from evidence_entity_links l
     join evidence e on e.id = l.evidence_id
     join entities n on n.id = l.entity_id
     where e.publication_state = 'published'
       and n.merged_into_id is null
       and ($1::text is null or l.entity_id > $1)
     order by l.entity_id
     limit $2`,
    [afterId, limit],
  );
  let updated = 0;
  let disputed = 0;
  for (const row of rows) {
    const out = await applyLifecycleForEntity(db, row.entity_id, days);
    updated += out.updated;
    if (out.disputed) disputed += 1;
  }
  const last = rows[rows.length - 1]?.entity_id ?? null;
  const remainingRows = await db.query<{ n: number }>(
    `select count(*)::int as n from (
       select distinct l.entity_id
       from evidence_entity_links l
       join evidence e on e.id = l.evidence_id
       join entities n on n.id = l.entity_id
       where e.publication_state = 'published'
         and n.merged_into_id is null
         and ($1::text is null or l.entity_id > $1)
     ) t`,
    [last],
  );
  return {
    processed: rows.length,
    updated,
    disputed,
    nextAfterId: rows.length < limit ? null : last,
    remaining: remainingRows[0]?.n ?? 0,
  };
}

export async function repairCorpusStats(db: Sql) {
  const q = async (text: string, params: unknown[] = []) =>
    (await db.query<{ n: number }>(text, params))[0]?.n ?? 0;
  return {
    entities: await q("select count(*)::int as n from entities where merged_into_id is null"),
    published: await q(
      "select count(*)::int as n from entities where visibility = 'public' and merged_into_id is null",
    ),
    evidence: await q("select count(*)::int as n from evidence"),
    current: await q("select count(*)::int as n from evidence where lifecycle_state = 'current'"),
    historical: await q(
      "select count(*)::int as n from evidence where lifecycle_state in ('historical','superseded')",
    ),
    expired: await q("select count(*)::int as n from evidence where lifecycle_state = 'expired'"),
    disputed: await q("select count(*)::int as n from evidence where lifecycle_state = 'disputed'"),
    expiring: await q("select count(*)::int as n from evidence where lifecycle_state = 'expiring_soon'"),
    sources: await q("select count(*)::int as n from monitored_sources"),
    verifiers: await q("select count(*)::int as n from verification_agencies"),
    agenciesLinked: await q("select count(*)::int as n from evidence where verifier_agency_id is not null"),
    expirySet: await q("select count(*)::int as n from evidence where expiry_date is not null"),
    expiryMissing: await q("select count(*)::int as n from evidence where expiry_date is null"),
    review: await q("select count(*)::int as n from review_items where status = 'pending'"),
    remainingExtract: await remainingRepairCount(db),
    fieldOverrides: await q("select count(*)::int as n from field_overrides where locked = 1"),
  };
}

export async function resetRepairRuns(db: Sql): Promise<{ runs: number; claims: number; garbageAgencies: number }> {
  const runs = await db.query<{ n: number }>(
    "select count(*)::int as n from extraction_runs where parser = $1",
    [PARSER_REPAIR],
  );
  await db.query(
    `update published_claims set claim_id = null
     where claim_id in (
       select c.id from extracted_claims c
       join extraction_runs r on r.id = c.extraction_run_id
       where r.parser = $1
     )`,
    [PARSER_REPAIR],
  );
  const claims = await db.query<{ n: number }>(
    `select count(*)::int as n from extracted_claims c
     join extraction_runs r on r.id = c.extraction_run_id
     where r.parser = $1`,
    [PARSER_REPAIR],
  );
  await db.query(
    `delete from extracted_claims
     where extraction_run_id in (select id from extraction_runs where parser = $1)`,
    [PARSER_REPAIR],
  );
  await db.query("delete from extraction_runs where parser = $1", [PARSER_REPAIR]);
  const garbageAgencies = await cleanupGarbageAgencies(db);
  return { runs: runs[0]?.n ?? 0, claims: claims[0]?.n ?? 0, garbageAgencies };
}

export async function cleanupGarbageAgencies(db: Sql): Promise<number> {
  const agencies = await db.query<{ id: string; name: string }>("select id, name from verification_agencies");
  let removed = 0;
  for (const agency of agencies) {
    if (canonicalAgencyName(agency.name)) continue;
    await db.query("update evidence set verifier_agency_id = null, updated_at = now() where verifier_agency_id = $1", [
      agency.id,
    ]);
    await db.query("update entity_current_state set verifier_agency_id = null, updated_at = now() where verifier_agency_id = $1", [
      agency.id,
    ]);
    await db.query("update signatories set agency_id = null where agency_id = $1", [agency.id]);
    await db.query("delete from agency_accreditations where agency_id = $1", [agency.id]);
    await db.query("delete from agency_aliases where agency_id = $1", [agency.id]);
    await db.query("delete from verification_agencies where id = $1", [agency.id]);
    removed += 1;
  }
  return removed;
}

export { classifyPublishedEvidence };
