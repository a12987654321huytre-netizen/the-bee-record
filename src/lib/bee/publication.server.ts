import { audit } from "./audit.server.ts";
import { workingClaims, workingValue } from "./claims.server.ts";
import { RECOGNIZED_DOCUMENT_TYPES } from "./constants.ts";
import { compareIso, expiryStatus, todayIso } from "./dates.ts";
import { newId } from "./ids.ts";
import type { Sql } from "./db-types.ts";
import type { CurrentState, ExtractedClaim } from "./types.ts";

const STATE_FIELDS = [
  "bee_level",
  "recognition_level",
  "scorecard_type",
  "certificate_type",
  "issue_date",
  "expiry_date",
  "registration_number",
] as const;

export async function getCurrentState(db: Sql, entityId: string): Promise<CurrentState | null> {
  const rows = await db.query<CurrentState>("select * from entity_current_state where entity_id = $1", [entityId]);
  return rows[0] ?? null;
}

export async function lockedFields(db: Sql, entityId: string): Promise<Map<string, { value: string | null; reason: string | null }>> {
  const rows = await db.query<{ field_key: string; value: string | null; lock_reason: string | null }>(
    "select field_key, value, lock_reason from field_overrides where entity_id = $1 and locked = 1",
    [entityId],
  );
  return new Map(rows.map((r) => [r.field_key, { value: r.value, reason: r.lock_reason }]));
}

function presentFields(claims: ExtractedClaim[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const claim of claims) {
    const value = workingValue(claim);
    if (value) map.set(claim.field_key, value);
  }
  return map;
}

export async function rebuildCurrentState(db: Sql, entityId: string, expiringSoonDays: number) {
  const claims = await db.query<{
    field_key: string;
    value: string | null;
    evidence_id: string;
    published_at: string;
  }>("select field_key, value, evidence_id, published_at from published_claims where entity_id = $1", [entityId]);
  const map = new Map(claims.map((c) => [c.field_key, c]));
  const supporting = map.get("bee_level") ?? map.get("issue_date") ?? claims[0];
  const expiry = map.get("expiry_date")?.value ?? null;
  const lifecycle = supporting
    ? expiryStatus(expiry, "current", expiringSoonDays, todayIso())
    : null;
  await db.query(
    `insert into entity_current_state (
        entity_id, bee_level, recognition_level, scorecard_type, certificate_type,
        issue_date, expiry_date, verifier_agency_id, signatory_id, registration_number,
        evidence_id, lifecycle_state, published_at, updated_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
     on conflict (entity_id) do update set
        bee_level = excluded.bee_level,
        recognition_level = excluded.recognition_level,
        scorecard_type = excluded.scorecard_type,
        certificate_type = excluded.certificate_type,
        issue_date = excluded.issue_date,
        expiry_date = excluded.expiry_date,
        verifier_agency_id = excluded.verifier_agency_id,
        signatory_id = excluded.signatory_id,
        registration_number = excluded.registration_number,
        evidence_id = excluded.evidence_id,
        lifecycle_state = excluded.lifecycle_state,
        published_at = excluded.published_at,
        updated_at = now()`,
    [
      entityId,
      map.get("bee_level")?.value ?? null,
      map.get("recognition_level")?.value ?? null,
      map.get("scorecard_type")?.value ?? null,
      map.get("certificate_type")?.value ?? null,
      map.get("issue_date")?.value ?? null,
      expiry,
      null,
      null,
      map.get("registration_number")?.value ?? null,
      supporting?.evidence_id ?? null,
      lifecycle,
      supporting?.published_at ?? null,
    ],
  );

  const evidence = await db.query<{ id: string; verifier_agency_id: string | null; signatory_id: string | null }>(
    "select id, verifier_agency_id, signatory_id from evidence where id = $1",
    [supporting?.evidence_id ?? ""],
  );
  if (evidence[0]) {
    await db.query(
      "update entity_current_state set verifier_agency_id = $2, signatory_id = $3, updated_at = now() where entity_id = $1",
      [entityId, evidence[0].verifier_agency_id, evidence[0].signatory_id],
    );
  }
}

export async function publishEvidence(
  db: Sql,
  input: {
    evidenceId: string;
    entityId: string;
    actorType: string;
    actorId: string;
    ruleVersion?: number | null;
    reviewItemId?: string | null;
    reviewRevision?: number | null;
    reason?: string | null;
    expiringSoonDays: number;
  },
): Promise<{ ok: true; supersededEvidenceId: string | null } | { ok: false; error: string }> {
  if (input.reviewItemId) {
    const items = await db.query<{ status: string; revision: number; evidence_id: string | null; entity_id: string | null }>(
      "select status, revision, evidence_id, entity_id from review_items where id = $1",
      [input.reviewItemId],
    );
    const item = items[0];
    if (!item) return { ok: false, error: "Review item no longer exists." };
    if (item.status !== "pending" && item.status !== "in_review") {
      return { ok: false, error: "Review item is no longer open." };
    }
    if (input.reviewRevision != null && item.revision !== input.reviewRevision) {
      return { ok: false, error: "This review item changed while it was open. Reload and try again." };
    }
    if (item.evidence_id && item.evidence_id !== input.evidenceId) {
      return { ok: false, error: "Review item is attached to different evidence." };
    }
  }

  const entities = await db.query<{
    id: string;
    visibility: string;
    merged_into_id: string | null;
    automation_state: string;
  }>("select id, visibility, merged_into_id, automation_state from entities where id = $1", [input.entityId]);
  const entity = entities[0];
  if (!entity) return { ok: false, error: "Entity not found." };
  if (entity.merged_into_id) return { ok: false, error: "This entity was merged. Publish against the surviving record." };

  const evidenceRows = await db.query<{
    id: string;
    evidence_type: string;
    issue_date: string | null;
    expiry_date: string | null;
    publication_state: string;
    lifecycle_state: string;
    verifier_agency_id: string | null;
    signatory_id: string | null;
  }>("select id, evidence_type, issue_date, expiry_date, publication_state, lifecycle_state, verifier_agency_id, signatory_id from evidence where id = $1", [
    input.evidenceId,
  ]);
  const evidence = evidenceRows[0];
  if (!evidence) return { ok: false, error: "Evidence not found." };

  const claims = await workingClaims(db, input.evidenceId);
  const fields = presentFields(claims);
  const issueDate = fields.get("issue_date") ?? evidence.issue_date;
  const expiryDate = fields.get("expiry_date") ?? evidence.expiry_date;
  const locks = await lockedFields(db, input.entityId);
  const skippedLocked: string[] = [];

  const previous = await getCurrentState(db, input.entityId);
  const previousEvidenceId = previous?.evidence_id ?? null;

  for (const [field, incoming] of fields) {
    const lock = locks.get(field);
    if (!lock) continue;
    const currentVal = lock.value ?? currentFieldValue(previous, field);
    if (currentVal && incoming !== currentVal) {
      skippedLocked.push(field);
      fields.delete(field);
    }
  }

  const shouldSupersede =
    Boolean(previousEvidenceId && previousEvidenceId !== input.evidenceId) &&
    isPrimaryEvidence(evidence.evidence_type) &&
    (!previous?.issue_date || !issueDate || compareIso(issueDate, previous.issue_date) >= 0);

  if (shouldSupersede && previousEvidenceId) {
    await db.query(
      `update evidence
       set lifecycle_state = case
             when expiry_date is not null and expiry_date < $2 then 'expired'
             else 'superseded'
           end,
           updated_at = now()
       where id = $1`,
      [previousEvidenceId, todayIso()],
    );
    await db.query(
      `update extracted_claims set published_state = 'superseded'
       where evidence_id = $1 and published_state = 'published'`,
      [previousEvidenceId],
    );
  }

  for (const [field, value] of fields) {
    const existing = await db.query<{ id: string; evidence_id: string; value: string | null }>(
      "select id, evidence_id, value from published_claims where entity_id = $1 and field_key = $2",
      [input.entityId, field],
    );
    const claim = claims.find((c) => c.field_key === field);
    if (existing[0]) {
      await db.query(
        `update published_claims
         set value = $3, normalized_value = $3, evidence_id = $4, claim_id = $5,
             published_at = now(), published_by = $6, rule_version = $7, superseded_at = null
         where id = $1 and entity_id = $2`,
        [
          existing[0].id,
          input.entityId,
          value,
          input.evidenceId,
          claim?.id ?? null,
          input.actorId,
          input.ruleVersion != null ? String(input.ruleVersion) : null,
        ],
      );
    } else {
      await db.query(
        `insert into published_claims
          (id, entity_id, field_key, value, normalized_value, evidence_id, claim_id, published_by, rule_version)
         values ($1,$2,$3,$4,$4,$5,$6,$7,$8)`,
        [
          newId("pcl"),
          input.entityId,
          field,
          value,
          input.evidenceId,
          claim?.id ?? null,
          input.actorId,
          input.ruleVersion != null ? String(input.ruleVersion) : null,
        ],
      );
    }
    if (claim) {
      await db.query(
        "update extracted_claims set published_state = 'published', review_state = 'approved', reviewer_id = $2, reviewed_at = now() where id = $1",
        [claim.id, input.actorId],
      );
    }
  }

  const lifecycle = expiryStatus(expiryDate, "current", input.expiringSoonDays, todayIso());
  await db.query(
    `update evidence
     set publication_state = 'published',
         review_state = 'approved',
         lifecycle_state = $2,
         issue_date = coalesce($3, issue_date),
         expiry_date = coalesce($4, expiry_date),
         updated_at = now()
     where id = $1`,
    [input.evidenceId, lifecycle, issueDate, expiryDate],
  );

  const existingLink = await db.query<{ id: string }>(
    "select id from evidence_entity_links where evidence_id = $1 and entity_id = $2 limit 1",
    [input.evidenceId, input.entityId],
  );
  if (!existingLink[0]) {
    await db.query(
      `insert into evidence_entity_links
        (id, evidence_id, entity_id, link_state, match_method, confidence, reason)
       values ($1,$2,$3,'confirmed','publication',1,'Confirmed at publication')`,
      [newId("lnk"), input.evidenceId, input.entityId],
    );
  } else {
    await db.query(
      `update evidence_entity_links set link_state = 'confirmed'
       where evidence_id = $1 and entity_id = $2`,
      [input.evidenceId, input.entityId],
    );
  }

  if (entity.visibility === "draft") {
    await db.query("update entities set visibility = 'public', updated_at = now() where id = $1", [input.entityId]);
  }
  await db.query("update entities set last_reviewed_at = now(), updated_at = now() where id = $1", [input.entityId]);

  await rebuildCurrentState(db, input.entityId, input.expiringSoonDays);

  const level = fields.get("bee_level");
  const summary = level
    ? `Published B-BBEE level ${level} from evidence ${input.evidenceId}`
    : `Published evidence ${input.evidenceId}`;
  await db.query(
    `insert into publication_events
      (id, entity_id, evidence_id, event_type, summary, previous_evidence_id, published_by)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      newId("pub"),
      input.entityId,
      input.evidenceId,
      input.ruleVersion != null ? "auto_published" : "published",
      skippedLocked.length ? `${summary} (locked fields preserved: ${skippedLocked.join(", ")})` : summary,
      shouldSupersede ? previousEvidenceId : null,
      input.actorId,
    ],
  );

  if (input.reviewItemId) {
    await db.query(
      `update review_items
       set status = 'approved', reviewer_id = $2, resolved_at = now(), resolution = $3, updated_at = now()
       where id = $1`,
      [input.reviewItemId, input.actorId, input.reason ?? "Approved and published."],
    );
  }

  await audit(db, {
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.ruleVersion != null ? "evidence.auto_published" : "evidence.published",
    targetType: "evidence",
    targetId: input.evidenceId,
    after: {
      entityId: input.entityId,
      fields: Object.fromEntries(fields),
      ruleVersion: input.ruleVersion ?? null,
      skippedLocked,
    },
    reason: input.reason,
    evidenceId: input.evidenceId,
  });

  return { ok: true, supersededEvidenceId: shouldSupersede ? previousEvidenceId : null };
}

function isPrimaryEvidence(type: string): boolean {
  return (RECOGNIZED_DOCUMENT_TYPES as readonly string[]).includes(type);
}

function currentFieldValue(state: CurrentState | null, field: string): string | null {
  if (!state) return null;
  switch (field) {
    case "bee_level":
      return state.bee_level;
    case "recognition_level":
      return state.recognition_level;
    case "scorecard_type":
      return state.scorecard_type;
    case "certificate_type":
      return state.certificate_type;
    case "issue_date":
      return state.issue_date;
    case "expiry_date":
      return state.expiry_date;
    case "registration_number":
      return state.registration_number;
    default:
      return null;
  }
}

export { STATE_FIELDS };
