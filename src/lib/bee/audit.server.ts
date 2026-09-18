import { newId } from "./ids.ts";
import { jsonText, type Sql } from "./db-types.ts";

export async function audit(
  db: Sql,
  input: {
    actorType: string;
    actorId?: string | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    before?: unknown;
    after?: unknown;
    reason?: string | null;
    evidenceId?: string | null;
    jobId?: string | null;
  },
) {
  await db.query(
    `insert into audit_logs
      (id, actor_type, actor_id, action, target_type, target_id, before_state, after_state, reason, related_evidence_id, related_job_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      newId("aud"),
      input.actorType,
      input.actorId ?? null,
      input.action,
      input.targetType,
      input.targetId ?? null,
      input.before == null ? null : jsonText(input.before),
      input.after == null ? null : jsonText(input.after),
      input.reason ?? null,
      input.evidenceId ?? null,
      input.jobId ?? null,
    ],
  );
}
