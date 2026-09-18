import { expiryStatus, todayIso } from "./dates.ts";
import { newId } from "./ids.ts";
import { normalizeBeeLevel } from "./level.ts";
import { normalizeName, normalizeRegistration } from "./normalize.ts";
import type { Sql } from "./db-types.ts";
import type { ExtractedClaim } from "./types.ts";

export function workingValue(claim: ExtractedClaim | null | undefined): string | null {
  if (!claim) return null;
  const edited = claim.edited_value?.trim();
  if (edited) return edited;
  return claim.normalized_value ?? claim.structured_value ?? claim.raw_value ?? null;
}

export async function latestSuccessfulRunId(db: Sql, evidenceId: string): Promise<string | null> {
  const rows = await db.query<{ id: string }>(
    `select id from extraction_runs
     where evidence_id = $1 and success = 1
     order by started_at desc
     limit 1`,
    [evidenceId],
  );
  return rows[0]?.id ?? null;
}

export async function claimsForRun(db: Sql, runId: string): Promise<ExtractedClaim[]> {
  return db.query<ExtractedClaim>(
    `select * from extracted_claims where extraction_run_id = $1 order by field_key`,
    [runId],
  );
}

export async function workingClaims(db: Sql, evidenceId: string): Promise<ExtractedClaim[]> {
  const runId = await latestSuccessfulRunId(db, evidenceId);
  if (!runId) return [];
  return claimsForRun(db, runId);
}

export function claimsByField(claims: ExtractedClaim[]): Map<string, ExtractedClaim> {
  const map = new Map<string, ExtractedClaim>();
  for (const c of claims) {
    if (!map.has(c.field_key)) map.set(c.field_key, c);
  }
  return map;
}

export function applyManualNormalization(field: string, value: string | null): string | null {
  if (!value) return null;
  if (field === "bee_level") return normalizeBeeLevel(value) ?? value;
  if (field === "registration_number") return normalizeRegistration(value);
  if (field === "legal_entity_name" || field === "measured_entity" || field === "trading_name") {
    return normalizeName(value);
  }
  return value;
}

export async function editClaimValues(
  db: Sql,
  input: {
    evidenceId: string;
    edits: Record<string, string>;
    actorId: string;
  },
) {
  const claims = await workingClaims(db, input.evidenceId);
  const byField = claimsByField(claims);
  for (const [field, value] of Object.entries(input.edits)) {
    const existing = byField.get(field);
    const trimmed = value.trim();
    if (existing) {
      await db.query(
        `update extracted_claims
         set edited_value = $2, edited_by = $3, edited_at = now(), review_state = 'edited'
         where id = $1`,
        [existing.id, trimmed, input.actorId],
      );
    } else {
      const runId = await latestSuccessfulRunId(db, input.evidenceId);
      if (!runId) continue;
      await db.query(
        `insert into extracted_claims
          (id, evidence_id, extraction_run_id, field_key, structured_value, normalized_value, raw_value,
           confidence, parser, review_state, edited_value, edited_by, edited_at)
         values ($1,$2,$3,$4,$5,$6,$7,1,'manual','edited',$5,$8,now())`,
        [
          newId("clm"),
          input.evidenceId,
          runId,
          field,
          applyManualNormalization(field, trimmed),
          applyManualNormalization(field, trimmed),
          trimmed,
          input.actorId,
        ],
      );
    }
  }
}

export async function derivedLifecycle(
  db: Sql,
  evidence: { expiry_date: string | null; lifecycle_state: string; publication_state: string },
  expiringSoonDays: number,
): Promise<string> {
  if (evidence.publication_state !== "published") return evidence.lifecycle_state;
  return expiryStatus(evidence.expiry_date, evidence.lifecycle_state, expiringSoonDays, todayIso());
}
