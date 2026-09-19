import { audit } from "./audit.server.ts";
import { editClaimValues } from "./claims.server.ts";
import { newId } from "./ids.ts";
import { publishEvidence } from "./publication.server.ts";
import { jsonText, type Sql } from "./db-types.ts";

export async function ensureReviewItem(
  db: Sql,
  input: {
    type: string;
    reason: string;
    severity?: "low" | "normal" | "high" | "critical";
    entityId?: string | null;
    evidenceId?: string | null;
    jobId?: string | null;
    payload?: unknown;
  },
): Promise<string> {
  if (input.evidenceId) {
    const existing = await db.query<{ id: string }>(
      `select id from review_items
       where type = $1 and evidence_id = $2 and status = 'pending'
       limit 1`,
      [input.type, input.evidenceId],
    );
    if (existing[0]) return existing[0].id;
  }
  const id = newId("rvw");
  await db.query(
    `insert into review_items
      (id, type, reason, severity, entity_id, evidence_id, job_id, payload)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      id,
      input.type,
      input.reason,
      input.severity ?? "normal",
      input.entityId ?? null,
      input.evidenceId ?? null,
      input.jobId ?? null,
      input.payload == null ? null : jsonText(input.payload),
    ],
  );
  return id;
}

export async function rejectReview(
  db: Sql,
  input: {
    reviewItemId: string;
    revision: number;
    actorId: string;
    reason?: string | null;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const items = await db.query<{
    id: string;
    status: string;
    revision: number;
    evidence_id: string | null;
  }>("select id, status, revision, evidence_id from review_items where id = $1", [input.reviewItemId]);
  const item = items[0];
  if (!item) return { ok: false, error: "Review item not found." };
  if (item.status !== "pending" && item.status !== "in_review") {
    return { ok: false, error: "Review item is no longer open." };
  }
  if (item.revision !== input.revision) {
    return { ok: false, error: "This review item changed while it was open. Reload and try again." };
  }
  await db.query(
    `update review_items
     set status = 'rejected', reviewer_id = $2, resolved_at = now(), resolution = $3, notes = $3, updated_at = now()
     where id = $1`,
    [input.reviewItemId, input.actorId, input.reason ?? "Rejected."],
  );
  if (item.evidence_id) {
    await db.query(
      "update evidence set review_state = 'rejected', updated_at = now() where id = $1 and publication_state = 'unpublished'",
      [item.evidence_id],
    );
  }
  await audit(db, {
    actorType: "admin",
    actorId: input.actorId,
    action: "review.rejected",
    targetType: "review_item",
    targetId: input.reviewItemId,
    reason: input.reason,
    evidenceId: item.evidence_id,
  });
  return { ok: true };
}

export async function approveReview(
  db: Sql,
  input: {
    reviewItemId: string;
    revision: number;
    actorId: string;
    entityId: string;
    evidenceId: string;
    edits?: Record<string, string>;
    reason?: string | null;
    expiringSoonDays: number;
  },
): Promise<{ ok: true; supersededEvidenceId: string | null } | { ok: false; error: string }> {
  if (input.edits && Object.keys(input.edits).length) {
    await editClaimValues(db, {
      evidenceId: input.evidenceId,
      edits: input.edits,
      actorId: input.actorId,
    });
  }
  return publishEvidence(db, {
    evidenceId: input.evidenceId,
    entityId: input.entityId,
    actorType: "admin",
    actorId: input.actorId,
    reviewItemId: input.reviewItemId,
    reviewRevision: input.revision,
    reason: input.reason,
    expiringSoonDays: input.expiringSoonDays,
  });
}

export async function deferReview(
  db: Sql,
  input: { reviewItemId: string; actorId: string; notes?: string | null },
) {
  await db.query(
    `update review_items set status = 'deferred', reviewer_id = $2, notes = $3, updated_at = now()
     where id = $1 and status in ('pending','in_review')`,
    [input.reviewItemId, input.actorId, input.notes ?? null],
  );
}

export async function closeReview(
  db: Sql,
  input: {
    reviewItemId: string;
    actorId: string;
    status: "approved" | "rejected" | "deferred";
    resolution: string;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const items = await db.query<{
    id: string;
    status: string;
    evidence_id: string | null;
  }>("select id, status, evidence_id from review_items where id = $1", [input.reviewItemId]);
  const item = items[0];
  if (!item) return { ok: false, error: "Review item not found." };
  if (item.status !== "pending" && item.status !== "in_review") {
    return { ok: false, error: "Review item is no longer open." };
  }
  await db.query(
    `update review_items
     set status = $2, reviewer_id = $3, resolved_at = now(), resolution = $4, notes = $4, updated_at = now()
     where id = $1`,
    [input.reviewItemId, input.status, input.actorId, input.resolution],
  );
  await audit(db, {
    actorType: "admin",
    actorId: input.actorId,
    action: `review.${input.status}`,
    targetType: "review_item",
    targetId: input.reviewItemId,
    reason: input.resolution,
    evidenceId: item.evidence_id,
  });
  return { ok: true };
}
