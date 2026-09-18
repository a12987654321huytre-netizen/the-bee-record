import { createServerFn } from "@tanstack/react-start";
import { redirect } from "@tanstack/react-router";
import { setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import {
  adminCount,
  bootstrapAdmin,
  changeOwnPassword,
  getAdminSession,
  loginAdmin,
  logoutAdmin,
  requireAdmin,
  requireCsrf,
} from "./admin-auth.server.ts";
import { audit } from "./audit.server.ts";
import { workingClaims } from "./claims.server.ts";
import { runSourceCheck, createSource, runDueSources, setSourceEnabled } from "./crawler.server.ts";
import {
  addAdminNote,
  addAlias,
  createEntity,
  createRelationship,
  lockField,
  removeAlias,
  removeClassification,
  setClassification,
  unlockField,
  updateEntity,
} from "./entities.server.ts";
import { aiConfigured } from "./extract.server.ts";
import { processExpiries } from "./expiry.server.ts";
import { ingestDocument, rerunExtraction } from "./pipeline.server.ts";
import { mergeEntities, unmergeEntities } from "./merge.server.ts";
import { newId } from "./ids.ts";
import { approveReview, rejectReview } from "./review.server.ts";
import { getActiveRule, getAutoPublishEnabled, getConfidenceThreshold, getExpiringSoonDays, setSetting } from "./settings.server.ts";
import { sql, withTransaction } from "./sql.server.ts";
import { checkFetchUrl } from "./ssrf.ts";
import { slugify, normalizeName } from "./normalize.ts";
import { uniqueSlug } from "./db-types.ts";

function noStore() {
  setResponseHeader("cache-control", "no-store");
  setResponseHeader("vary", "cookie");
}

export const getAdminContext = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  const [session, count, ai] = await Promise.all([getAdminSession(), adminCount(), Promise.resolve(aiConfigured())]);
  return { session, needsBootstrap: count === 0, aiConfigured: ai };
});

export const bootstrapFirstAdmin = createServerFn({ method: "POST" })
  .validator(z.object({ name: z.string(), email: z.string(), password: z.string() }))
  .handler(async ({ data }) => bootstrapAdmin(data));

export const loginAdminFn = createServerFn({ method: "POST" })
  .validator(z.object({ email: z.string(), password: z.string() }))
  .handler(async ({ data }) => loginAdmin(data.email, data.password));

export const changePasswordFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      csrf: z.string(),
      currentPassword: z.string(),
      newPassword: z.string(),
      confirmPassword: z.string(),
    }),
  )
  .handler(async ({ data }) => changeOwnPassword(data));

export const logoutAdminFn = createServerFn({ method: "POST" }).handler(async () => {
  await logoutAdmin();
  throw redirect({ to: "/admin/login" });
});

export const getDashboard = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  await requireAdmin();
  const db = await sql();
  const q = async (text: string) => (await db.query<{ n: number }>(text))[0]?.n ?? 0;
  const tracked = await q("select count(*)::int as n from entities where merged_into_id is null");
  const visible = await q("select count(*)::int as n from entities where visibility = 'public' and merged_into_id is null");
  const sources = await q("select count(*)::int as n from monitored_sources");
  const evidence = await q("select count(*)::int as n from evidence");
  const current = await q("select count(*)::int as n from evidence where lifecycle_state = 'current'");
  const historical = await q("select count(*)::int as n from evidence where lifecycle_state in ('historical','superseded')");
  const expired = await q("select count(*)::int as n from evidence where lifecycle_state = 'expired'");
  const expiring = await q("select count(*)::int as n from evidence where lifecycle_state = 'expiring_soon'");
  const review = await q("select count(*)::int as n from review_items where status = 'pending'");
  const matches = await q("select count(*)::int as n from review_items where status = 'pending' and type = 'uncertain_entity_match'");
  const submissions = await q("select count(*)::int as n from submissions where status = 'pending'");
  const period = await db.query<{
    sources_checked: number;
    new_evidence: number;
    extracted: number;
    extract_fail: number;
    auto_pub: number;
    crawler_fail: number;
  }>(
    `select
       (select count(*)::int from source_checks where started_at >= now() - interval '7 days') as sources_checked,
       (select count(*)::int from evidence where created_at >= now() - interval '7 days') as new_evidence,
       (select count(*)::int from extraction_runs where started_at >= now() - interval '7 days' and success = 1) as extracted,
       (select count(*)::int from extraction_runs where started_at >= now() - interval '7 days' and success = 0) as extract_fail,
       (select count(*)::int from publication_events where published_at >= now() - interval '7 days' and event_type = 'auto_published') as auto_pub,
       (select count(*)::int from crawler_jobs where created_at >= now() - interval '7 days' and state = 'failed') as crawler_fail`,
  );
  const newest = await db.query<{ id: string; title: string | null; created_at: string; review_state: string }>(
    "select id, title, created_at, review_state from evidence order by created_at desc limit 8",
  );
  const staleSources = await db.query<{ id: string; url: string; last_checked_at: string | null; last_error: string | null }>(
    `select id, url, last_checked_at, last_error from monitored_sources
     where enabled = 1
     order by last_checked_at nulls first
     limit 8`,
  );
  const upcoming = await db.query<{ id: string; title: string | null; expiry_date: string | null }>(
    `select id, title, expiry_date from evidence
     where publication_state = 'published' and expiry_date is not null and expiry_date >= current_date
     order by expiry_date asc limit 8`,
  );
  const pendingReview = await db.query<{ id: string; type: string; reason: string; generated_at: string }>(
    "select id, type, reason, generated_at from review_items where status = 'pending' order by generated_at desc limit 10",
  );
  return {
    counts: { tracked, visible, sources, evidence, current, historical, expired, expiring, review, matches, submissions },
    period: period[0] ?? {
      sources_checked: 0,
      new_evidence: 0,
      extracted: 0,
      extract_fail: 0,
      auto_pub: 0,
      crawler_fail: 0,
    },
    newest,
    staleSources,
    upcoming,
    pendingReview,
    aiConfigured: aiConfigured(),
  };
});

export const listAdminCompanies = createServerFn({ method: "GET" })
  .validator(z.object({ q: z.string().optional(), page: z.coerce.number().optional(), visibility: z.string().optional() }))
  .handler(async ({ data }) => {
    noStore();
    await requireAdmin();
    const db = await sql();
    const page = Math.max(1, data.page ?? 1);
    const pageSize = 30;
    const params: unknown[] = [];
    const where = ["merged_into_id is null"];
    if (data.q?.trim()) {
      params.push(`%${data.q.trim()}%`);
      where.push(`(canonical_name ilike $${params.length} or registration_number ilike $${params.length})`);
    }
    if (data.visibility) {
      params.push(data.visibility);
      where.push(`visibility = $${params.length}`);
    }
    const total = (
      await db.query<{ n: number }>(`select count(*)::int as n from entities where ${where.join(" and ")}`, params)
    )[0]?.n ?? 0;
    params.push(pageSize, (page - 1) * pageSize);
    const items = await db.query<{
      id: string;
      slug: string;
      canonical_name: string;
      visibility: string;
      automation_state: string;
      registration_number: string | null;
      updated_at: string;
    }>(
      `select id, slug, canonical_name, visibility, automation_state, registration_number, updated_at
       from entities where ${where.join(" and ")}
       order by updated_at desc
       limit $${params.length - 1} offset $${params.length}`,
      params,
    );
    return { items, total, page, pageSize };
  });

export const getAdminCompany = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    noStore();
    await requireAdmin();
    const db = await sql();
    const entity = (await db.query("select * from entities where id = $1", [data.id]))[0];
    if (!entity) throw new Error("Company not found.");
    const aliases = await db.query("select * from entity_aliases where entity_id = $1 order by created_at", [data.id]);
    const relationships = await db.query(
      `select r.*, s.canonical_name as source_name, t.canonical_name as target_name
       from entity_relationships r
       join entities s on s.id = r.source_entity_id
       join entities t on t.id = r.target_entity_id
       where r.source_entity_id = $1 or r.target_entity_id = $1`,
      [data.id],
    );
    const classifications = await db.query(
      `select ec.*, s.name as sector_name, s.slug as sector_slug
       from entity_classifications ec join sectors s on s.id = ec.sector_id
       where ec.entity_id = $1`,
      [data.id],
    );
    const sectors = await db.query("select id, slug, name from sectors order by name");
    const evidence = await db.query(
      `select e.id, e.title, e.evidence_type, e.lifecycle_state, e.review_state, e.publication_state, e.issue_date, e.expiry_date
       from evidence e
       join evidence_entity_links l on l.evidence_id = e.id
       where l.entity_id = $1
       order by e.created_at desc`,
      [data.id],
    );
    const locks = await db.query("select * from field_overrides where entity_id = $1", [data.id]);
    const notes = await db.query("select * from admin_notes where target_type = 'entity' and target_id = $1 order by created_at desc", [
      data.id,
    ]);
    const current = (await db.query("select * from entity_current_state where entity_id = $1", [data.id]))[0] ?? null;
    const merges = await db.query(
      "select * from entity_merge_events where survivor_id = $1 or absorbed_id = $1 order by created_at desc",
      [data.id],
    );
    const others = await db.query<{ id: string; canonical_name: string }>(
      "select id, canonical_name from entities where merged_into_id is null and id <> $1 order by canonical_name limit 200",
      [data.id],
    );
    return { entity, aliases, relationships, classifications, sectors, evidence, locks, notes, current, merges, others };
  });

export const createCompanyFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      csrf: z.string(),
      canonicalName: z.string().min(2),
      legalName: z.string().optional(),
      tradingName: z.string().optional(),
      registrationNumber: z.string().optional(),
      website: z.string().optional(),
      visibility: z.enum(["draft", "public", "hidden"]).optional(),
      automationState: z.enum(["automation_allowed", "review_only", "locked"]).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireAdmin();
    requireCsrf(session, data.csrf);
    const db = await sql();
    return createEntity(db, { ...data, actorId: session.adminId });
  });

export const updateCompanyFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      csrf: z.string(),
      id: z.string(),
      canonicalName: z.string().optional(),
      legalName: z.string().nullable().optional(),
      tradingName: z.string().nullable().optional(),
      registrationNumber: z.string().nullable().optional(),
      website: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      visibility: z.enum(["draft", "public", "hidden"]).optional(),
      automationState: z.enum(["automation_allowed", "review_only", "locked"]).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireAdmin();
    requireCsrf(session, data.csrf);
    const db = await sql();
    const { csrf: _c, ...rest } = data;
    await updateEntity(db, { ...rest, actorId: session.adminId });
    return { ok: true };
  });

export const addAliasFn = createServerFn({ method: "POST" })
  .validator(z.object({ csrf: z.string(), entityId: z.string(), alias: z.string(), aliasType: z.string().optional() }))
  .handler(async ({ data }) => {
    const session = await requireAdmin();
    requireCsrf(session, data.csrf);
    const db = await sql();
    await addAlias(db, { ...data, actorId: session.adminId });
    return { ok: true };
  });

export const removeAliasFn = createServerFn({ method: "POST" })
  .validator(z.object({ csrf: z.string(), aliasId: z.string() }))
  .handler(async ({ data }) => {
    const session = await requireAdmin();
    requireCsrf(session, data.csrf);
    const db = await sql();
    await removeAlias(db, data.aliasId);
    return { ok: true };
  });

export const addRelationshipFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      csrf: z.string(),
      sourceEntityId: z.string(),
      targetEntityId: z.string(),
      relationshipType: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireAdmin();
    requireCsrf(session, data.csrf);
    const db = await sql();
    await createRelationship(db, { ...data, actorId: session.adminId });
    return { ok: true };
  });

export const setClassificationFn = createServerFn({ method: "POST" })
  .validator(z.object({ csrf: z.string(), entityId: z.string(), sectorId: z.string(), remove: z.boolean().optional() }))
  .handler(async ({ data }) => {
    const session = await requireAdmin();
    requireCsrf(session, data.csrf);
    const db = await sql();
    if (data.remove) await removeClassification(db, data.entityId, data.sectorId);
    else await setClassification(db, { ...data, actorId: session.adminId });
    return { ok: true };
  });

export const lockFieldFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      csrf: z.string(),
      entityId: z.string(),
      fieldKey: z.string(),
      value: z.string().optional(),
      reason: z.string().optional(),
      unlock: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireAdmin();
    requireCsrf(session, data.csrf);
    const db = await sql();
    if (data.unlock) await unlockField(db, { entityId: data.entityId, fieldKey: data.fieldKey, actorId: session.adminId });
    else await lockField(db, { ...data, actorId: session.adminId });
    return { ok: true };
  });

export const mergeCompaniesFn = createServerFn({ method: "POST" })
  .validator(z.object({ csrf: z.string(), survivorId: z.string(), absorbedId: z.string(), notes: z.string().optional() }))
  .handler(async ({ data }) => {
    const session = await requireAdmin();
    requireCsrf(session, data.csrf);
    return withTransaction(async (db) => {
      const days = await getExpiringSoonDays(db);
      return mergeEntities(db, { ...data, actorId: session.adminId, expiringSoonDays: days });
    });
  });

export const unmergeCompaniesFn = createServerFn({ method: "POST" })
  .validator(z.object({ csrf: z.string(), mergeId: z.string() }))
  .handler(async ({ data }) => {
    const session = await requireAdmin();
    requireCsrf(session, data.csrf);
    return withTransaction(async (db) => {
      const days = await getExpiringSoonDays(db);
      return unmergeEntities(db, { mergeId: data.mergeId, actorId: session.adminId, expiringSoonDays: days });
    });
  });

export const addNoteFn = createServerFn({ method: "POST" })
  .validator(z.object({ csrf: z.string(), targetType: z.string(), targetId: z.string(), body: z.string() }))
  .handler(async ({ data }) => {
    const session = await requireAdmin();
    requireCsrf(session, data.csrf);
    const db = await sql();
    await addAdminNote(db, { ...data, actorId: session.adminId });
    return { ok: true };
  });

export const ingestEvidenceFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      csrf: z.string(),
      url: z.string().optional(),
      entityId: z.string().optional(),
      evidenceType: z.string().optional(),
      title: z.string().optional(),
      text: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireAdmin();
    requireCsrf(session, data.csrf);
    if (data.url) {
      const checked = checkFetchUrl(data.url);
      if (!checked.ok) return { ok: false as const, error: checked.reason };
    }
    const db = await sql();
    if (data.text && !data.url) {
      const bytes = new TextEncoder().encode(data.text);
      return ingestDocument(db, {
        bytes,
        mimeType: "text/plain",
        filename: "manual.txt",
        title: data.title,
        evidenceType: data.evidenceType,
        entityId: data.entityId,
        actorType: "admin",
        actorId: session.adminId,
      });
    }
    if (!data.url) return { ok: false as const, error: "Provide a URL or paste document text." };
    return ingestDocument(db, {
      url: data.url,
      title: data.title,
      evidenceType: data.evidenceType,
      entityId: data.entityId,
      actorType: "admin",
      actorId: session.adminId,
    });
  });

export const listAdminEvidence = createServerFn({ method: "GET" })
  .validator(
    z.object({
      q: z.string().optional(),
      state: z.string().optional(),
      review: z.string().optional(),
      page: z.coerce.number().optional(),
    }),
  )
  .handler(async ({ data }) => {
    noStore();
    await requireAdmin();
    const db = await sql();
    const page = Math.max(1, data.page ?? 1);
    const pageSize = 30;
    const params: unknown[] = [];
    const where = ["1=1"];
    if (data.q?.trim()) {
      params.push(`%${data.q.trim()}%`);
      where.push(`(title ilike $${params.length} or source_url ilike $${params.length} or id ilike $${params.length})`);
    }
    if (data.state) {
      params.push(data.state);
      where.push(`lifecycle_state = $${params.length}`);
    }
    if (data.review) {
      params.push(data.review);
      where.push(`review_state = $${params.length}`);
    }
    const total = (
      await db.query<{ n: number }>(`select count(*)::int as n from evidence where ${where.join(" and ")}`, params)
    )[0]?.n ?? 0;
    params.push(pageSize, (page - 1) * pageSize);
    const items = await db.query(
      `select id, title, evidence_type, source_url, lifecycle_state, review_state, publication_state,
              extraction_state, issue_date, expiry_date, content_hash, created_at
       from evidence where ${where.join(" and ")}
       order by created_at desc
       limit $${params.length - 1} offset $${params.length}`,
      params,
    );
    return { items, total, page, pageSize };
  });

export const getAdminEvidence = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    noStore();
    await requireAdmin();
    const db = await sql();
    const evidence = (await db.query("select * from evidence where id = $1", [data.id]))[0];
    if (!evidence) throw new Error("Evidence not found.");
    const claims = await workingClaims(db, data.id);
    const runs = await db.query(
      "select id, parser, model, success, error, started_at, completed_at, token_usage, raw_response from extraction_runs where evidence_id = $1 order by started_at desc",
      [data.id],
    );
    const links = await db.query(
      `select l.*, e.canonical_name, e.slug from evidence_entity_links l
       left join entities e on e.id = l.entity_id
       where l.evidence_id = $1`,
      [data.id],
    );
    const locations = await db.query("select * from evidence_source_locations where evidence_id = $1", [data.id]);
    const reviews = await db.query("select * from review_items where evidence_id = $1 order by generated_at desc", [data.id]);
    const notes = await db.query("select * from admin_notes where target_type = 'evidence' and target_id = $1 order by created_at desc", [
      data.id,
    ]);
    const companies = await db.query("select id, canonical_name from entities where merged_into_id is null order by canonical_name limit 200");
    return { evidence, claims, runs, links, locations, reviews, notes, companies, aiConfigured: aiConfigured() };
  });

export const rerunExtractFn = createServerFn({ method: "POST" })
  .validator(z.object({ csrf: z.string(), evidenceId: z.string() }))
  .handler(async ({ data }) => {
    const session = await requireAdmin();
    requireCsrf(session, data.csrf);
    const db = await sql();
    return rerunExtraction(db, data.evidenceId, session.adminId);
  });

export const relinkEvidenceFn = createServerFn({ method: "POST" })
  .validator(z.object({ csrf: z.string(), evidenceId: z.string(), entityId: z.string() }))
  .handler(async ({ data }) => {
    const session = await requireAdmin();
    requireCsrf(session, data.csrf);
    const db = await sql();
    const existing = await db.query<{ id: string }>(
      "select id from evidence_entity_links where evidence_id = $1 and entity_id = $2",
      [data.evidenceId, data.entityId],
    );
    if (!existing[0]) {
      await db.query(
        `insert into evidence_entity_links (id, evidence_id, entity_id, link_state, match_method, confidence, reason)
         values ($1,$2,$3,'confirmed','admin',1,'Relinked by administrator')`,
        [newId("lnk"), data.evidenceId, data.entityId],
      );
    } else {
      await db.query("update evidence_entity_links set link_state = 'confirmed', match_method = 'admin' where id = $1", [
        existing[0].id,
      ]);
    }
    await audit(db, {
      actorType: "admin",
      actorId: session.adminId,
      action: "evidence.relinked",
      targetType: "evidence",
      targetId: data.evidenceId,
      after: { entityId: data.entityId },
    });
    return { ok: true };
  });

export const listReviewQueue = createServerFn({ method: "GET" })
  .validator(z.object({ status: z.string().optional(), type: z.string().optional(), page: z.coerce.number().optional() }))
  .handler(async ({ data }) => {
    noStore();
    await requireAdmin();
    const db = await sql();
    const page = Math.max(1, data.page ?? 1);
    const pageSize = 30;
    const params: unknown[] = [];
    const where = ["1=1"];
    if (data.status) {
      params.push(data.status);
      where.push(`status = $${params.length}`);
    } else {
      where.push("status = 'pending'");
    }
    if (data.type) {
      params.push(data.type);
      where.push(`type = $${params.length}`);
    }
    const total = (
      await db.query<{ n: number }>(`select count(*)::int as n from review_items where ${where.join(" and ")}`, params)
    )[0]?.n ?? 0;
    params.push(pageSize, (page - 1) * pageSize);
    const items = await db.query(
      `select r.*, e.title as evidence_title, ent.canonical_name as entity_name
       from review_items r
       left join evidence e on e.id = r.evidence_id
       left join entities ent on ent.id = r.entity_id
       where ${where.join(" and ")}
       order by r.generated_at desc
       limit $${params.length - 1} offset $${params.length}`,
      params,
    );
    return { items, total, page, pageSize };
  });

export const getReviewItem = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    noStore();
    await requireAdmin();
    const db = await sql();
    const item = (await db.query("select * from review_items where id = $1", [data.id]))[0] as
      | {
          id: string;
          type: string;
          reason: string;
          severity: string;
          status: string;
          entity_id: string | null;
          evidence_id: string | null;
          payload: string | null;
          revision: number;
          generated_at: string;
        }
      | undefined;
    if (!item) throw new Error("Review item not found.");
    const evidence = item.evidence_id
      ? (await db.query("select * from evidence where id = $1", [item.evidence_id]))[0]
      : null;
    const claims = item.evidence_id ? await workingClaims(db, item.evidence_id) : [];
    const current = item.entity_id
      ? (await db.query("select * from entity_current_state where entity_id = $1", [item.entity_id]))[0]
      : null;
    const entity = item.entity_id ? (await db.query("select * from entities where id = $1", [item.entity_id]))[0] : null;
    const companies = await db.query("select id, canonical_name from entities where merged_into_id is null order by canonical_name limit 200");
    const runs = item.evidence_id
      ? await db.query(
          "select id, parser, model, success, error, raw_response, started_at from extraction_runs where evidence_id = $1 order by started_at desc",
          [item.evidence_id],
        )
      : [];
    return { item, evidence, claims, current, entity, companies, runs, aiConfigured: aiConfigured() };
  });

export const approveReviewFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      csrf: z.string(),
      reviewItemId: z.string(),
      revision: z.number(),
      entityId: z.string(),
      evidenceId: z.string(),
      edits: z.record(z.string(), z.string()).optional(),
      reason: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireAdmin();
    requireCsrf(session, data.csrf);
    return withTransaction(async (db) => {
      const days = await getExpiringSoonDays(db);
      return approveReview(db, { ...data, actorId: session.adminId, expiringSoonDays: days });
    });
  });

export const rejectReviewFn = createServerFn({ method: "POST" })
  .validator(z.object({ csrf: z.string(), reviewItemId: z.string(), revision: z.number(), reason: z.string().optional() }))
  .handler(async ({ data }) => {
    const session = await requireAdmin();
    requireCsrf(session, data.csrf);
    return withTransaction(async (db) => rejectReview(db, { ...data, actorId: session.adminId }));
  });

export const listSourcesFn = createServerFn({ method: "GET" })
  .validator(z.object({ q: z.string().optional(), health: z.string().optional() }))
  .handler(async ({ data }) => {
    noStore();
    await requireAdmin();
    const db = await sql();
    const params: unknown[] = [];
    const where = ["1=1"];
    if (data.q?.trim()) {
      params.push(`%${data.q.trim()}%`);
      where.push(`(url ilike $${params.length} or domain ilike $${params.length})`);
    }
    if (data.health === "failed") where.push("consecutive_error_count > 0");
    if (data.health === "disabled") where.push("enabled = 0");
    if (data.health === "stale") where.push("(last_checked_at is null or last_checked_at < now() - interval '14 days')");
    const items = await db.query(
      `select * from monitored_sources where ${where.join(" and ")} order by updated_at desc limit 200`,
      params,
    );
    return { items };
  });

export const getSourceFn = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    noStore();
    await requireAdmin();
    const db = await sql();
    const source = (await db.query("select * from monitored_sources where id = $1", [data.id]))[0];
    if (!source) throw new Error("Source not found.");
    const checks = await db.query("select * from source_checks where source_id = $1 order by started_at desc limit 30", [data.id]);
    const jobs = await db.query("select * from crawler_jobs where source_id = $1 order by created_at desc limit 20", [data.id]);
    const companies = await db.query("select id, canonical_name from entities where merged_into_id is null order by canonical_name limit 200");
    return { source, checks, jobs, companies };
  });

export const createSourceFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      csrf: z.string(),
      url: z.string(),
      entityId: z.string().optional(),
      sourceType: z.string().optional(),
      frequency: z.enum(["daily", "weekly", "monthly", "manual"]).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireAdmin();
    requireCsrf(session, data.csrf);
    const db = await sql();
    const id = await createSource(db, { ...data, actorId: session.adminId });
    return { ok: true, id };
  });

export const toggleSourceFn = createServerFn({ method: "POST" })
  .validator(z.object({ csrf: z.string(), sourceId: z.string(), enabled: z.boolean() }))
  .handler(async ({ data }) => {
    const session = await requireAdmin();
    requireCsrf(session, data.csrf);
    const db = await sql();
    await setSourceEnabled(db, data.sourceId, data.enabled, session.adminId);
    return { ok: true };
  });

export const crawlNowFn = createServerFn({ method: "POST" })
  .validator(z.object({ csrf: z.string(), sourceId: z.string() }))
  .handler(async ({ data }) => {
    const session = await requireAdmin();
    requireCsrf(session, data.csrf);
    const db = await sql();
    return runSourceCheck(db, data.sourceId, { type: "admin", id: session.adminId });
  });

export const listJobsFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  await requireAdmin();
  const db = await sql();
  const items = await db.query("select * from crawler_jobs order by created_at desc limit 80");
  return { items };
});

export const getJobFn = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    noStore();
    await requireAdmin();
    const db = await sql();
    const job = (await db.query("select * from crawler_jobs where id = $1", [data.id]))[0];
    if (!job) throw new Error("Job not found.");
    const events = await db.query("select * from crawler_job_events where job_id = $1 order by at", [data.id]);
    return { job, events };
  });

export const retryJobFn = createServerFn({ method: "POST" })
  .validator(z.object({ csrf: z.string(), jobId: z.string() }))
  .handler(async ({ data }) => {
    const session = await requireAdmin();
    requireCsrf(session, data.csrf);
    const db = await sql();
    const job = (await db.query<{ source_id: string | null }>("select source_id from crawler_jobs where id = $1", [data.jobId]))[0];
    if (!job?.source_id) return { ok: false as const, error: "This job has no source to retry." };
    return runSourceCheck(db, job.source_id, { type: "admin", id: session.adminId });
  });

export const listSubmissionsFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  await requireAdmin();
  const db = await sql();
  const items = await db.query("select * from submissions order by created_at desc limit 100");
  return { items };
});

export const resolveSubmissionFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      csrf: z.string(),
      id: z.string(),
      status: z.enum(["accepted", "rejected", "spam"]),
      notes: z.string().optional(),
      ingest: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireAdmin();
    requireCsrf(session, data.csrf);
    const db = await sql();
    const sub = (await db.query<{ url: string | null; company_text: string | null }>(
      "select url, company_text from submissions where id = $1",
      [data.id],
    ))[0];
    if (!sub) return { ok: false as const, error: "Submission not found." };
    let evidenceId: string | null = null;
    if (data.status === "accepted" && data.ingest && sub.url) {
      const result = await ingestDocument(db, {
        url: sub.url,
        title: sub.company_text,
        actorType: "admin",
        actorId: session.adminId,
      });
      evidenceId = result.evidenceId;
    }
    await db.query(
      "update submissions set status = $2, admin_notes = $3, linked_evidence_id = coalesce($4, linked_evidence_id), resolved_at = now() where id = $1",
      [data.id, data.status, data.notes ?? null, evidenceId],
    );
    await audit(db, {
      actorType: "admin",
      actorId: session.adminId,
      action: `submission.${data.status}`,
      targetType: "submission",
      targetId: data.id,
      reason: data.notes,
      evidenceId,
    });
    return { ok: true as const, evidenceId };
  });

export const listVerifiersAdmin = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  await requireAdmin();
  const db = await sql();
  const items = await db.query("select * from verification_agencies order by name");
  return { items };
});

export const createVerifierFn = createServerFn({ method: "POST" })
  .validator(z.object({ csrf: z.string(), name: z.string(), website: z.string().optional() }))
  .handler(async ({ data }) => {
    const session = await requireAdmin();
    requireCsrf(session, data.csrf);
    const db = await sql();
    const id = newId("agy");
    const slug = await uniqueSlug(db, "verification_agencies", slugify(data.name));
    await db.query(
      "insert into verification_agencies (id, name, normalized_name, slug, website, visibility) values ($1,$2,$3,$4,$5,'public')",
      [id, data.name.trim(), normalizeName(data.name), slug, data.website?.trim() || null],
    );
    await audit(db, {
      actorType: "admin",
      actorId: session.adminId,
      action: "verifier.created",
      targetType: "agency",
      targetId: id,
    });
    return { ok: true, id };
  });

export const getSettingsFn = createServerFn({ method: "GET" }).handler(async () => {
  noStore();
  await requireAdmin();
  const [auto, threshold, days, rule, ai] = await Promise.all([
    getAutoPublishEnabled(),
    getConfidenceThreshold(),
    getExpiringSoonDays(),
    getActiveRule(),
    Promise.resolve(aiConfigured()),
  ]);
  return { autoPublishEnabled: auto, confidenceThreshold: threshold, expiringSoonDays: days, rule, aiConfigured: ai };
});

export const saveSettingsFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      csrf: z.string(),
      autoPublishEnabled: z.boolean(),
      confidenceThreshold: z.number().min(0).max(1),
      expiringSoonDays: z.number().int().min(1).max(365),
      ruleEnabled: z.boolean(),
      config: z.object({
        officialCompanyDomain: z.boolean(),
        recognizedDocumentType: z.boolean(),
        minimumConfidence: z.number(),
        exactEntityMatch: z.boolean(),
        validDates: z.boolean(),
        noConflictingCurrentEvidence: z.boolean(),
        knownVerifier: z.boolean(),
        registrationNumberConsistency: z.boolean(),
        manualLockConflictMustBeFalse: z.boolean(),
      }),
    }),
  )
  .handler(async ({ data }) => {
    const session = await requireAdmin();
    requireCsrf(session, data.csrf);
    const db = await sql();
    await setSetting("auto_publish_enabled", data.autoPublishEnabled, session.adminId, db);
    await setSetting("confidence_threshold", data.confidenceThreshold, session.adminId, db);
    await setSetting("expiring_soon_days", data.expiringSoonDays, session.adminId, db);
    const current = await getActiveRule(db);
    await db.query(
      "insert into automation_rules (id, version, name, enabled, config, created_by) values ($1,$2,$3,$4,$5,$6)",
      [
        newId("rul"),
        current.version + 1,
        "Conservative auto-publication",
        data.ruleEnabled ? 1 : 0,
        JSON.stringify({ ...data.config, minimumConfidence: data.confidenceThreshold }),
        session.adminId,
      ],
    );
    await audit(db, {
      actorType: "admin",
      actorId: session.adminId,
      action: "automation.rule_changed",
      targetType: "settings",
      targetId: "automation",
      after: data,
    });
    return { ok: true };
  });

export const listAuditFn = createServerFn({ method: "GET" })
  .validator(z.object({ q: z.string().optional() }))
  .handler(async ({ data }) => {
    noStore();
    await requireAdmin();
    const db = await sql();
    const like = data.q?.trim() ? `%${data.q.trim()}%` : null;
    const items = await db.query(
      `select * from audit_logs
       where ($1::text is null or action ilike $1 or target_id ilike $1 or target_type ilike $1)
       order by at desc limit 150`,
      [like],
    );
    return { items };
  });

export const runMaintenanceFn = createServerFn({ method: "POST" })
  .validator(z.object({ csrf: z.string(), task: z.enum(["expiry", "due_sources"]) }))
  .handler(async ({ data }) => {
    const session = await requireAdmin();
    requireCsrf(session, data.csrf);
    const db = await sql();
    if (data.task === "expiry") return processExpiries(db);
    const jobs = await runDueSources(db);
    return { jobs };
  });
