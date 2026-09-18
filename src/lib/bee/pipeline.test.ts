import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "./db-types.ts";
import { createEntity, lockField } from "./entities.server.ts";
import { ingestDocument } from "./pipeline.server.ts";
import { approveReview } from "./review.server.ts";
import { mergeEntities } from "./merge.server.ts";
import { processExpiries } from "./expiry.server.ts";
import { createSubmission, searchAcross, getPublicEntity } from "./queries.server.ts";
import { matchEntity } from "./match.server.ts";
import { setSetting } from "./settings.server.ts";
import { applyPasswordChange } from "./admin-password.server.ts";
import { hashPassword, verifyPassword } from "./passwords.ts";

delete process.env.XAI_API_KEY;

function wrap(pg: PGlite): Sql {
  const sql = (async () => {
    throw new Error("tagged template unused in tests");
  }) as unknown as Sql;
  sql.query = async <T>(text: string, params: unknown[] = []) => {
    try {
      const res = await pg.query<T>(text, params);
      return res.rows.map((row) => {
        if (!row || typeof row !== "object") return row;
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
          out[k] = v instanceof Date ? v.toISOString() : typeof v === "bigint" ? Number(v) : v;
        }
        return out as T;
      });
    } catch (err) {
      const preview = params.map((p) =>
        p === null
          ? "null"
          : p === undefined
            ? "undefined"
            : p instanceof Uint8Array
              ? `Uint8Array(${p.byteLength})`
              : `${typeof p}:${JSON.stringify(p).slice(0, 80)}`,
      );
      console.error("SQL FAIL", text.replace(/\s+/g, " ").trim(), preview);
      throw err;
    }
  };
  return sql;
}

async function memoryDb(): Promise<{ db: Sql; pg: PGlite }> {
  const pg = new PGlite();
  await pg.waitReady;
  const migration = readFileSync(new URL("../../../migrations/0002_schema.sql", import.meta.url), "utf8");
  await pg.exec(migration);
  return { db: wrap(pg), pg };
}

function certText(input: { name: string; reg: string; level: string; issue: string; expiry: string }) {
  return `
    B-BBEE Certificate
    Measured entity: ${input.name}
    Registration: ${input.reg}
    B-BBEE level: Level ${input.level} Contributor
    Recognition level: 110%
    Scorecard type: Generic
    Issue date: ${input.issue}
    Expiry date: ${input.expiry}
    Verification agency: Example Verify (Pty) Ltd
    Technical signatory: Test Signatory
  `;
}

describe("end-to-end evidence pipeline", () => {
  it("ingests, reviews, publishes, preserves history, locks, merges, expires, submissions", async () => {
    const { db } = await memoryDb();
    const actor = "adm_test";

    const a = await createEntity(db, { canonicalName: "Example Retail (Pty) Ltd", registrationNumber: "2010/123456/07", actorId: actor, visibility: "draft" });
    const first = await ingestDocument(db, {
      bytes: new TextEncoder().encode(
        certText({ name: "Example Retail (Pty) Ltd", reg: "2010/123456/07", level: "Four", issue: "26 September 2025", expiry: "25 September 2026" }),
      ),
      mimeType: "text/plain",
      filename: "cert-2025.txt",
      evidenceType: "bee_certificate",
      entityId: a.id,
      actorType: "admin",
      actorId: actor,
    });
    assert.equal(first.duplicate, false);
    assert.ok(first.reviewItemId);
    assert.equal(first.autoPublished, false);

    const ev1 = (await db.query<{ publication_state: string; content_hash: string }>("select publication_state, content_hash from evidence where id = $1", [first.evidenceId]))[0];
    assert.equal(ev1?.publication_state, "unpublished");
    assert.ok(ev1?.content_hash);

    const approved = await approveReview(db, {
      reviewItemId: first.reviewItemId!,
      revision: 1,
      actorId: actor,
      entityId: a.id,
      evidenceId: first.evidenceId,
      expiringSoonDays: 90,
    });
    assert.equal(approved.ok, true);

    const publicAfter = await getPublicEntity(db, a.slug);
    assert.ok(publicAfter?.entity);
    assert.equal(publicAfter?.current?.bee_level, "4");

    const audit = await db.query<{ n: number }>("select count(*)::int as n from audit_logs where action = 'evidence.published'");
    assert.ok((audit[0]?.n ?? 0) >= 1);

    const dup = await ingestDocument(db, {
      bytes: new TextEncoder().encode(
        certText({ name: "Example Retail (Pty) Ltd", reg: "2010/123456/07", level: "Four", issue: "26 September 2025", expiry: "25 September 2026" }),
      ),
      mimeType: "text/plain",
      filename: "cert-2025-copy.txt",
      entityId: a.id,
      actorType: "crawler",
      actorId: "job",
    });
    assert.equal(dup.duplicate, true);
    assert.equal(dup.evidenceId, first.evidenceId);
    const evidenceCount = (await db.query<{ n: number }>("select count(*)::int as n from evidence"))[0]?.n;
    assert.equal(evidenceCount, 1);

    const second = await ingestDocument(db, {
      bytes: new TextEncoder().encode(
        certText({ name: "Example Retail (Pty) Ltd", reg: "2010/123456/07", level: "Three", issue: "12 September 2026", expiry: "11 September 2027" }),
      ),
      mimeType: "text/plain",
      filename: "cert-2026.txt",
      evidenceType: "bee_certificate",
      entityId: a.id,
      actorType: "admin",
      actorId: actor,
    });
    assert.equal(second.duplicate, false);
    assert.ok(second.reviewItemId);
    assert.notEqual(second.evidenceId, first.evidenceId);

    const stillOld = await getPublicEntity(db, a.slug);
    assert.equal(stillOld?.current?.bee_level, "4");

    const approved2 = await approveReview(db, {
      reviewItemId: second.reviewItemId!,
      revision: 1,
      actorId: actor,
      entityId: a.id,
      evidenceId: second.evidenceId,
      expiringSoonDays: 90,
    });
    assert.equal(approved2.ok, true);
    const now = await getPublicEntity(db, a.slug);
    assert.equal(now?.current?.bee_level, "3");
    const old = (await db.query<{ lifecycle_state: string }>("select lifecycle_state from evidence where id = $1", [first.evidenceId]))[0];
    assert.ok(old?.lifecycle_state === "superseded" || old?.lifecycle_state === "expired");
    assert.equal((await db.query<{ n: number }>("select count(*)::int as n from evidence"))[0]?.n, 2);

    await lockField(db, { entityId: a.id, fieldKey: "bee_level", value: "3", reason: "manual hold", actorId: actor });
    const third = await ingestDocument(db, {
      bytes: new TextEncoder().encode(
        certText({ name: "Example Retail (Pty) Ltd", reg: "2010/123456/07", level: "Two", issue: "1 January 2027", expiry: "31 December 2027" }),
      ),
      mimeType: "text/plain",
      filename: "cert-2027.txt",
      evidenceType: "bee_certificate",
      entityId: a.id,
      actorType: "crawler",
      actorId: "bot",
    });
    const review = (await db.query<{ type: string }>("select type from review_items where id = $1", [third.reviewItemId]))[0];
    assert.equal(review?.type, "manual_lock_conflict");
    const lockedState = await getPublicEntity(db, a.slug);
    assert.equal(lockedState?.current?.bee_level, "3");

    const similar = await createEntity(db, { canonicalName: "Example Retail Group", actorId: actor, visibility: "public" });
    const conflict = await matchEntity(db, { extractedName: "Example Retail (Pty) Ltd", extractedReg: "1999/000001/06" });
    assert.equal(conflict.uncertain, true);
    assert.equal(conflict.conflict, "registration_number_conflict");
    const search = await searchAcross(db, "Example Retail");
    assert.ok(search.companies.length >= 2);

    const merged = await mergeEntities(db, {
      survivorId: a.id,
      absorbedId: similar.id,
      actorId: actor,
      expiringSoonDays: 90,
    });
    assert.equal(merged.ok, true);
    const absorbed = (await db.query<{ merged_into_id: string | null }>("select merged_into_id from entities where id = $1", [similar.id]))[0];
    assert.equal(absorbed?.merged_into_id, a.id);

    await db.query("update evidence set expiry_date = '2020-01-01', lifecycle_state = 'current' where id = $1", [second.evidenceId]);
    const expiry = await processExpiries(db);
    assert.ok(expiry.updated >= 1);
    const expired = (await db.query<{ lifecycle_state: string }>("select lifecycle_state from evidence where id = $1", [second.evidenceId]))[0];
    assert.equal(expired?.lifecycle_state, "expired");
    const stillThere = (await db.query<{ n: number }>("select count(*)::int as n from evidence where id = $1", [second.evidenceId]))[0];
    assert.equal(stillThere?.n, 1);

    const sub = await createSubmission(db, { type: "certificate_url", url: "https://example.com/cert.pdf", companyText: "Someone", ipHash: "abc" });
    assert.equal(sub.ok, true);
    const pending = (await db.query<{ status: string }>("select status from submissions where id = $1", [sub.ok ? sub.id : ""]))[0];
    assert.equal(pending?.status, "pending");
    const publicUnchanged = await getPublicEntity(db, a.slug);
    assert.equal(publicUnchanged?.current?.bee_level, "3");

    await setSetting("auto_publish_enabled", true, actor, db);
    await setSetting("confidence_threshold", 0.5, actor, db);
    await db.query(
      "update automation_rules set enabled = 1, config = $1",
      [
        JSON.stringify({
          officialCompanyDomain: false,
          recognizedDocumentType: true,
          minimumConfidence: 0.5,
          exactEntityMatch: true,
          validDates: true,
          noConflictingCurrentEvidence: false,
          knownVerifier: false,
          registrationNumberConsistency: true,
          manualLockConflictMustBeFalse: true,
        }),
      ],
    );
    await db.query("update entities set automation_state = 'automation_allowed' where id = $1", [a.id]);
    await db.query("delete from field_overrides where entity_id = $1", [a.id]);
    const auto = await ingestDocument(db, {
      bytes: new TextEncoder().encode(
        certText({ name: "Example Retail (Pty) Ltd", reg: "2010/123456/07", level: "One", issue: "1 February 2027", expiry: "31 January 2028" }),
      ),
      mimeType: "text/plain",
      filename: "cert-auto.txt",
      evidenceType: "bee_certificate",
      entityId: a.id,
      actorType: "automation",
      actorId: "test",
    });
    assert.equal(auto.autoPublished, true);
    const autoAudit = await db.query<{ n: number }>("select count(*)::int as n from audit_logs where action = 'evidence.auto_published'");
    assert.ok((autoAudit[0]?.n ?? 0) >= 1);
    const pub = (await db.query<{ rule_version: string | null }>("select rule_version from published_claims where entity_id = $1 and field_key = 'bee_level'", [a.id]))[0];
    assert.ok(pub?.rule_version);
  });
});

describe("admin password change", () => {
  it("updates the hash, keeps this session, and revokes the others", async () => {
    const { db } = await memoryDb();
    const adminId = "adm_pw";
    const keepSession = "ses_keep";
    const dropSession = "ses_drop";
    const current = "current-pass-1";
    const next = "replacement-pass-1";
    await db.query(
      "insert into admin_users (id, email, name, password_hash, role) values ($1,$2,$3,$4,'administrator')",
      [adminId, "operator@example.com", "Operator", await hashPassword(current)],
    );
    const expires = new Date(Date.now() + 86400000).toISOString();
    await db.query(
      "insert into admin_sessions (id, admin_user_id, token_hash, csrf_secret, expires_at) values ($1,$2,$3,$4,$5)",
      [keepSession, adminId, "keep-hash", "csrf-a", expires],
    );
    await db.query(
      "insert into admin_sessions (id, admin_user_id, token_hash, csrf_secret, expires_at) values ($1,$2,$3,$4,$5)",
      [dropSession, adminId, "drop-hash", "csrf-b", expires],
    );
    const stored = (await db.query<{ password_hash: string }>("select password_hash from admin_users where id = $1", [adminId]))[0];
    const bad = await applyPasswordChange(db, {
      adminId,
      sessionId: keepSession,
      storedHash: stored!.password_hash,
      currentPassword: "wrong-password",
      newPassword: next,
      confirmPassword: next,
    });
    assert.equal(bad.ok, false);
    const mismatch = await applyPasswordChange(db, {
      adminId,
      sessionId: keepSession,
      storedHash: stored!.password_hash,
      currentPassword: current,
      newPassword: next,
      confirmPassword: "does-not-match",
    });
    assert.equal(mismatch.ok, false);
    const ok = await applyPasswordChange(db, {
      adminId,
      sessionId: keepSession,
      storedHash: stored!.password_hash,
      currentPassword: current,
      newPassword: next,
      confirmPassword: next,
    });
    assert.equal(ok.ok, true);
    const after = (await db.query<{ password_hash: string }>("select password_hash from admin_users where id = $1", [adminId]))[0];
    assert.equal(await verifyPassword(next, after!.password_hash), true);
    assert.equal(await verifyPassword(current, after!.password_hash), false);
    const sessions = await db.query<{ id: string }>("select id from admin_sessions where admin_user_id = $1", [adminId]);
    assert.deepEqual(sessions.map((s) => s.id), [keepSession]);
    const audits = await db.query<{ n: number }>("select count(*)::int as n from audit_logs where action = 'admin.password_changed'");
    assert.equal(audits[0]?.n, 1);
  });
});
