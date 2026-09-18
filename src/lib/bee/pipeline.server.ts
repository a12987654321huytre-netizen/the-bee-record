import { audit } from "./audit.server.ts";
import { workingClaims, workingValue } from "./claims.server.ts";
import { RECOGNIZED_DOCUMENT_TYPES } from "./constants.ts";
import { extractEvidence } from "./extract.server.ts";
import { safeFetch } from "./fetch.server.ts";
import { newId } from "./ids.ts";
import { matchEntity } from "./match.server.ts";
import { extractDomain, isOfficialDomain, normalizeRegistration, normalizeUrl } from "./normalize.ts";
import { parseDocument } from "./parse.server.ts";
import { getCurrentState, lockedFields, publishEvidence } from "./publication.server.ts";
import { ensureReviewItem } from "./review.server.ts";
import { getActiveRule, getAutoPublishEnabled, getConfidenceThreshold, getExpiringSoonDays } from "./settings.server.ts";
import { jsonText, type Sql } from "./db-types.ts";
import { storeAsset } from "./storage.server.ts";
import { evaluateAutomation, validateClaims } from "./validation.ts";
import type { EvidenceRow, ExtractedClaim } from "./types.ts";

export type IngestResult = {
  evidenceId: string;
  duplicate: boolean;
  reviewItemId: string | null;
  autoPublished: boolean;
  assetId: string | null;
  extractionFailed: boolean;
  warnings: string[];
};

async function confirmLink(
  db: Sql,
  evidenceId: string,
  entityId: string,
  method: string,
  confidence: number,
  reason: string,
  extractedName: string | null,
  registrationMatch: boolean,
) {
  const existing = await db.query<{ id: string }>(
    "select id from evidence_entity_links where evidence_id = $1 and entity_id = $2 limit 1",
    [evidenceId, entityId],
  );
  if (existing[0]) {
    await db.query(
      `update evidence_entity_links
       set link_state = $3, match_method = $4, confidence = $5, reason = $6, extracted_name = $7, registration_match = $8
       where id = $1 and evidence_id = $2`,
      [existing[0].id, evidenceId, "candidate", method, confidence, reason, extractedName, registrationMatch ? 1 : 0],
    );
    return existing[0].id;
  }
  const id = newId("lnk");
  await db.query(
    `insert into evidence_entity_links
      (id, evidence_id, entity_id, link_state, extracted_name, match_method, confidence, registration_match, reason)
     values ($1,$2,$3,'candidate',$4,$5,$6,$7,$8)`,
    [id, evidenceId, entityId, extractedName, method, confidence, registrationMatch ? 1 : 0, reason],
  );
  return id;
}

async function applyClaimMetadata(db: Sql, evidenceId: string, claims: ExtractedClaim[]) {
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
    ],
  );
}

async function resolveAgency(db: Sql, name: string | null): Promise<string | null> {
  if (!name) return null;
  const { normalizeName } = await import("./normalize.ts");
  const n = normalizeName(name);
  const rows = await db.query<{ id: string }>(
    `select id from verification_agencies where normalized_name = $1
     union
     select agency_id as id from agency_aliases where normalized_alias = $1
     limit 1`,
    [n],
  );
  return rows[0]?.id ?? null;
}

export async function processEvidence(
  db: Sql,
  input: {
    evidenceId: string;
    text: string;
    suggestedEntityId?: string | null;
    actorType: string;
    actorId: string;
    jobId?: string | null;
  },
): Promise<{ reviewItemId: string | null; autoPublished: boolean; extractionFailed: boolean; warnings: string[] }> {
  const extracted = await extractEvidence(db, input.evidenceId, input.text);
  const evidenceRows = await db.query<EvidenceRow>("select * from evidence where id = $1", [input.evidenceId]);
  const evidence = evidenceRows[0];
  if (!evidence) throw new Error("Evidence disappeared during processing.");

  const claims = await workingClaims(db, input.evidenceId);
  await applyClaimMetadata(db, input.evidenceId, claims);

  const nameClaim =
    claims.find((c) => c.field_key === "legal_entity_name") ?? claims.find((c) => c.field_key === "measured_entity");
  const regClaim = claims.find((c) => c.field_key === "registration_number");
  const agencyClaim = claims.find((c) => c.field_key === "verification_agency");
  const agencyId = await resolveAgency(db, workingValue(agencyClaim));
  if (agencyId) {
    await db.query("update evidence set verifier_agency_id = $2, updated_at = now() where id = $1", [
      input.evidenceId,
      agencyId,
    ]);
  }

  const match = await matchEntity(db, {
    extractedName: workingValue(nameClaim) ?? nameClaim?.raw_value ?? null,
    extractedReg: workingValue(regClaim) ?? regClaim?.raw_value ?? null,
    suggestedEntityId: input.suggestedEntityId,
  });

  let entityId = match.entityId ?? input.suggestedEntityId ?? null;
  if (entityId) {
    await confirmLink(
      db,
      input.evidenceId,
      entityId,
      match.method ?? "suggested",
      match.confidence,
      match.reason,
      match.extractedName,
      Boolean(regClaim && match.method === "registration_number"),
    );
  }

  const entity = entityId
    ? (
        await db.query<{
          id: string;
          canonical_name: string;
          normalized_name: string;
          registration_number_normalized: string | null;
          website: string | null;
          automation_state: "automation_allowed" | "review_only" | "locked";
        }>(
          "select id, canonical_name, normalized_name, registration_number_normalized, website, automation_state from entities where id = $1",
          [entityId],
        )
      )[0]
    : null;

  const current = entityId ? await getCurrentState(db, entityId) : null;
  const locks = entityId ? await lockedFields(db, entityId) : new Map();
  const flags = validateClaims({
    evidence,
    claims,
    current,
    entityReg: entity?.registration_number_normalized ?? null,
    entityName: entity?.normalized_name ?? null,
    entityWebsite: entity?.website ?? null,
    knownAgency: Boolean(agencyId),
    duplicateHash: false,
    sourceMissing: evidence.source_live_status === "missing",
    lockedFields: [...locks.keys()],
    minConfidence: await getConfidenceThreshold(db),
  });

  await db.query("update evidence set validation_state = $2, updated_at = now() where id = $1", [
    input.evidenceId,
    flags.some((f) => f.severity === "error") ? "failed" : flags.length ? "warnings" : "passed",
  ]);

  const warnings = [
    ...extracted.deterministic.warnings,
    ...(extracted.ai?.warnings ?? []),
    ...(extracted.aiError ? [extracted.aiError] : []),
    ...flags.map((f) => f.message),
  ];

  if (extracted.aiConfigured && extracted.aiError && !extracted.deterministic.claims.length) {
    const reviewItemId = await ensureReviewItem(db, {
      type: "extraction_failed",
      reason: extracted.aiError,
      severity: "high",
      entityId,
      evidenceId: input.evidenceId,
      jobId: input.jobId,
      payload: { flags, match },
    });
    await db.query("update evidence set review_state = 'required', updated_at = now() where id = $1", [input.evidenceId]);
    return { reviewItemId, autoPublished: false, extractionFailed: true, warnings };
  }

  if (match.conflict === "registration_number_conflict") {
    const reviewItemId = await ensureReviewItem(db, {
      type: "registration_number_conflict",
      reason: match.reason,
      severity: "critical",
      entityId,
      evidenceId: input.evidenceId,
      jobId: input.jobId,
      payload: { match, flags },
    });
    await db.query("update evidence set review_state = 'required', updated_at = now() where id = $1", [input.evidenceId]);
    return { reviewItemId, autoPublished: false, extractionFailed: false, warnings };
  }

  if (!entityId || match.uncertain) {
    const reviewItemId = await ensureReviewItem(db, {
      type: "uncertain_entity_match",
      reason: match.reason,
      severity: match.conflict ? "high" : "normal",
      entityId,
      evidenceId: input.evidenceId,
      jobId: input.jobId,
      payload: { match, flags },
    });
    await db.query("update evidence set review_state = 'required', updated_at = now() where id = $1", [input.evidenceId]);
    return { reviewItemId, autoPublished: false, extractionFailed: false, warnings };
  }

  const autoEnabled = await getAutoPublishEnabled(db);
  const rule = await getActiveRule(db);
  const minClaimConfidence = claims.reduce<number | null>((acc, c) => {
    if (c.confidence == null) return acc;
    return acc == null ? c.confidence : Math.min(acc, c.confidence);
  }, null);
  const hasLockConflict = flags.some((f) => f.code === "manual_lock_conflict");
  const automation = evaluateAutomation({
    enabled: autoEnabled,
    ruleEnabled: rule.enabled,
    ruleVersion: rule.version,
    config: rule.config,
    flags,
    officialDomain: isOfficialDomain(evidence.source_domain, entity?.website ?? null),
    recognizedType: (RECOGNIZED_DOCUMENT_TYPES as readonly string[]).includes(evidence.evidence_type),
    exactEntityMatch: match.confidence >= 0.9 && !match.uncertain,
    knownVerifier: Boolean(agencyId),
    minClaimConfidence,
    hasLockConflict,
    entityAutomation: entity?.automation_state ?? "review_only",
  });

  if (hasLockConflict) {
    const reviewItemId = await ensureReviewItem(db, {
      type: "manual_lock_conflict",
      reason: "Extracted values conflict with a locked published field.",
      severity: "high",
      entityId,
      evidenceId: input.evidenceId,
      jobId: input.jobId,
      payload: { flags, automation },
    });
    await db.query("update evidence set review_state = 'required', updated_at = now() where id = $1", [input.evidenceId]);
    return { reviewItemId, autoPublished: false, extractionFailed: false, warnings };
  }

  if (flags.some((f) => f.code === "conflicting_level") && !automation.pass) {
    const reviewItemId = await ensureReviewItem(db, {
      type: "conflicting_evidence",
      reason: flags.find((f) => f.code === "conflicting_level")?.message ?? "Conflicts with published evidence.",
      severity: "high",
      entityId,
      evidenceId: input.evidenceId,
      jobId: input.jobId,
      payload: { flags, current, automation },
    });
    await db.query("update evidence set review_state = 'required', updated_at = now() where id = $1", [input.evidenceId]);
    return { reviewItemId, autoPublished: false, extractionFailed: false, warnings };
  }

  if (automation.pass && entityId) {
    const expiringSoonDays = await getExpiringSoonDays(db);
    const published = await publishEvidence(db, {
      evidenceId: input.evidenceId,
      entityId,
      actorType: "automation",
      actorId: `rule:v${rule.version}`,
      ruleVersion: rule.version,
      reason: "Auto-published under configured rules.",
      expiringSoonDays,
    });
    if (published.ok) {
      return { reviewItemId: null, autoPublished: true, extractionFailed: false, warnings };
    }
  }

  const reviewType = flags.some((f) => f.code === "low_confidence")
    ? "low_confidence_extraction"
    : flags.some((f) => f.severity === "error")
      ? "invalid_dates"
      : "new_evidence";
  const reviewItemId = await ensureReviewItem(db, {
    type: reviewType,
    reason: automation.reasons[0] ?? "New evidence requires review before publication.",
    severity: flags.some((f) => f.severity === "error") ? "high" : "normal",
    entityId,
    evidenceId: input.evidenceId,
    jobId: input.jobId,
    payload: { flags, automation, match },
  });
  await db.query("update evidence set review_state = 'required', updated_at = now() where id = $1", [input.evidenceId]);
  return { reviewItemId, autoPublished: false, extractionFailed: false, warnings };
}

export async function processEvidenceSafe(
  db: Sql,
  input: {
    evidenceId: string;
    text: string;
    suggestedEntityId?: string | null;
    actorType: string;
    actorId: string;
    jobId?: string | null;
  },
): Promise<{ reviewItemId: string | null; autoPublished: boolean; extractionFailed: boolean; warnings: string[] }> {
  try {
    return await processEvidence(db, input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const reviewItemId = await ensureReviewItem(db, {
      type: "extraction_failed",
      reason: message,
      severity: "high",
      entityId: input.suggestedEntityId,
      evidenceId: input.evidenceId,
      jobId: input.jobId,
    });
    await db.query(
      "update evidence set review_state = 'required', extraction_state = 'failed', updated_at = now() where id = $1",
      [input.evidenceId],
    );
    return { reviewItemId, autoPublished: false, extractionFailed: true, warnings: [message] };
  }
}

export async function ingestDocument(
  db: Sql,
  input: {
    bytes?: Uint8Array;
    url?: string | null;
    mimeType?: string | null;
    filename?: string | null;
    title?: string | null;
    evidenceType?: string;
    entityId?: string | null;
    actorType: string;
    actorId: string;
    jobId?: string | null;
    sourceId?: string | null;
    userAgent?: string;
  },
): Promise<IngestResult> {
  let bytes = input.bytes;
  let mimeType = input.mimeType ?? null;
  let finalUrl = input.url ?? null;
  let sourceStatus: "live" | "missing" | "unknown" | "redirected" = "unknown";
  let hash: string | null = null;

  if (!bytes && input.url) {
    const fetched = await safeFetch(input.url, { userAgent: input.userAgent });
    if (!fetched.ok) {
      sourceStatus = fetched.status === 404 ? "missing" : "unknown";
      const evidenceId = newId("evd");
      await db.query(
        `insert into evidence
          (id, evidence_type, title, source_url, discovered_url, source_domain, original_source_status,
           crawler_job_id, extraction_state, review_state, lifecycle_state, source_live_status, admin_notes)
         values ($1,$2,$3,$4,$4,$5,$6,$7,'none','required','discovered',$8,$9)`,
        [
          evidenceId,
          input.evidenceType ?? "other",
          input.title ?? input.url,
          input.url,
          extractDomain(input.url),
          sourceStatus,
          input.jobId ?? null,
          sourceStatus,
          fetched.reason,
        ],
      );
      if (input.entityId) {
        await confirmLink(db, evidenceId, input.entityId, "admin", 1, "Linked at ingest.", null, false);
      }
      const reviewItemId = await ensureReviewItem(db, {
        type: "source_problem",
        reason: fetched.reason,
        severity: "high",
        entityId: input.entityId,
        evidenceId,
        jobId: input.jobId,
      });
      return {
        evidenceId,
        duplicate: false,
        reviewItemId,
        autoPublished: false,
        assetId: null,
        extractionFailed: true,
        warnings: [fetched.reason],
      };
    }
    bytes = fetched.bytes;
    mimeType = fetched.mimeType;
    finalUrl = fetched.finalUrl;
    hash = fetched.hash;
    sourceStatus = fetched.redirected ? "redirected" : "live";
  }

  if (!bytes) throw new Error("No document bytes were provided.");

  const stored = await storeAsset(db, { bytes, mimeType });
  hash = stored.hash;

  const existing = await db.query<{ id: string }>(
    "select id from evidence where content_hash = $1 limit 1",
    [hash],
  );
  if (existing[0]) {
    if (finalUrl) {
      const loc = await db.query<{ id: string }>(
        "select id from evidence_source_locations where evidence_id = $1 and url = $2 limit 1",
        [existing[0].id, finalUrl],
      );
      if (loc[0]) {
        await db.query("update evidence_source_locations set last_seen_at = now() where id = $1", [loc[0].id]);
      } else {
        await db.query(
          "insert into evidence_source_locations (id, evidence_id, url) values ($1,$2,$3)",
          [newId("loc"), existing[0].id, finalUrl],
        );
      }
    }
    await audit(db, {
      actorType: input.actorType,
      actorId: input.actorId,
      action: "evidence.duplicate_detected",
      targetType: "evidence",
      targetId: existing[0].id,
      after: { hash, url: finalUrl },
      evidenceId: existing[0].id,
      jobId: input.jobId,
    });
    return {
      evidenceId: existing[0].id,
      duplicate: true,
      reviewItemId: null,
      autoPublished: false,
      assetId: stored.assetId,
      extractionFailed: false,
      warnings: ["Identical document already stored. Discovery was recorded; evidence was not duplicated."],
    };
  }

  const parsed = await parseDocument(bytes, mimeType, input.filename);
  const evidenceId = newId("evd");
  const canonical = finalUrl ? normalizeUrl(finalUrl) : null;
  await db.query(
    `insert into evidence (
        id, evidence_type, title, source_url, discovered_url, canonical_url, source_domain,
        original_filename, mime_type, byte_size, content_hash, normalized_hash,
        retrieved_at, original_source_status, asset_id, crawler_job_id,
        extraction_state, lifecycle_state, source_live_status
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),$13,$14,$15,'pending','discovered',$16)`,
    [
      evidenceId,
      input.evidenceType ?? "other",
      input.title ?? input.filename ?? (finalUrl ? finalUrl.split("/").pop() : "Untitled evidence"),
      finalUrl,
      input.url ?? finalUrl,
      canonical,
      finalUrl ? extractDomain(finalUrl) : null,
      input.filename ?? null,
      mimeType,
      stored.byteSize,
      hash,
      parsed.normalizedHash,
      sourceStatus,
      stored.assetId,
      input.jobId ?? null,
      sourceStatus === "live" || sourceStatus === "redirected" ? sourceStatus : "unknown",
    ],
  );
  if (finalUrl) {
    await db.query("insert into evidence_source_locations (id, evidence_id, url) values ($1,$2,$3)", [
      newId("loc"),
      evidenceId,
      finalUrl,
    ]);
  }
  if (input.entityId) {
    await confirmLink(db, evidenceId, input.entityId, "admin", 1, "Linked at ingest.", null, false);
  }

  await audit(db, {
    actorType: input.actorType,
    actorId: input.actorId,
    action: "evidence.created",
    targetType: "evidence",
    targetId: evidenceId,
    after: { hash, url: finalUrl, assetId: stored.assetId },
    evidenceId,
    jobId: input.jobId,
  });

  const processed = await processEvidenceSafe(db, {
    evidenceId,
    text: parsed.text,
    suggestedEntityId: input.entityId,
    actorType: input.actorType,
    actorId: input.actorId,
    jobId: input.jobId,
  });

  return {
    evidenceId,
    duplicate: false,
    reviewItemId: processed.reviewItemId,
    autoPublished: processed.autoPublished,
    assetId: stored.assetId,
    extractionFailed: processed.extractionFailed,
    warnings: processed.warnings,
  };
}

export async function rerunExtraction(db: Sql, evidenceId: string, actorId: string) {
  const rows = await db.query<{ asset_id: string | null; mime_type: string | null; original_filename: string | null }>(
    "select asset_id, mime_type, original_filename from evidence where id = $1",
    [evidenceId],
  );
  const row = rows[0];
  if (!row?.asset_id) throw new Error("No archived document is available to re-extract.");
  const { readAsset } = await import("./storage.server.ts");
  const asset = await readAsset(db, row.asset_id);
  if (!asset) throw new Error("Archived document bytes are missing.");
  const parsed = await parseDocument(asset.bytes, row.mime_type, row.original_filename);
  if (!parsed.text) {
    await db.query("update evidence set extraction_state = 'failed', updated_at = now() where id = $1", [evidenceId]);
    await ensureReviewItem(db, {
      type: "extraction_failed",
      reason: "Document could not be parsed into text.",
      evidenceId,
      severity: "high",
    });
    return { extractionFailed: true };
  }
  return processEvidenceSafe(db, {
    evidenceId,
    text: parsed.text,
    actorType: "admin",
    actorId,
  });
}

export function jsonPayload(value: unknown): string {
  return jsonText(value);
}

export { normalizeRegistration };
