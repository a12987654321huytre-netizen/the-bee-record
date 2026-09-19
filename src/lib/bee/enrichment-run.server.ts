import { audit } from "./audit.server.ts";
import { createSource, jobEvent, runSourceCheck } from "./crawler.server.ts";
import {
  enrichmentPriorityScore,
  formatZaRegistration,
  isVerifierRegistration,
  isZaCompanyRegistration,
  queuePredicate,
} from "./enrichment.ts";
import { updateEntity } from "./entities.server.ts";
import { newId } from "./ids.ts";
import { extractDomain, normalizeRegistration } from "./normalize.ts";
import { ensureReviewItem } from "./review.server.ts";
import type { Sql } from "./db-types.ts";

const ACTOR = "admin:enrichment";

async function ensureEnrichmentTables(db: Sql) {
  await db.query(`
    create table if not exists enrichment_runs (
      id text primary key,
      job_id text references crawler_jobs (id),
      entity_id text references entities (id),
      batch_size integer not null default 25,
      status text not null default 'queued',
      attempted integer not null default 0,
      enriched integer not null default 0,
      certificates_found integer not null default 0,
      registrations_found integer not null default 0,
      domains_found integer not null default 0,
      sectors_added integer not null default 0,
      sources_added integer not null default 0,
      reviews_created integer not null default 0,
      errors integer not null default 0,
      current_company text,
      current_entity_id text,
      stop_requested integer not null default 0,
      error text,
      created_by text,
      created_at timestamptz not null default now(),
      finished_at timestamptz
    )`);
}

const NON_COMPANY_HOST = /(\.gov\.za$|\.gov$|treasury\.gov|sanas\.co\.za|irba\.co\.za|empowerlogic|aqrate|empowerdex|bee\.co\.za|cipc\.co\.za)/i;

export type EnrichmentStats = {
  attempted: number;
  enriched: number;
  certificatesFound: number;
  registrationsFound: number;
  domainsFound: number;
  sectorsAdded: number;
  sourcesAdded: number;
  reviewsCreated: number;
  errors: number;
};

export type EnrichCompanyResult = EnrichmentStats & {
  entityId: string;
  name: string;
  filled: string[];
  error?: string;
};

const EMPTY_STATS: EnrichmentStats = {
  attempted: 0,
  enriched: 0,
  certificatesFound: 0,
  registrationsFound: 0,
  domainsFound: 0,
  sectorsAdded: 0,
  sourcesAdded: 0,
  reviewsCreated: 0,
  errors: 0,
};

export function eligibleForEnrichmentPredicate(): string {
  const parts = [
    "procurement_only",
    "no_registration",
    "no_sector",
    "no_website",
    "no_current_certificate",
    "expired_certificate_only",
    "no_monitored_source",
  ]
    .map((q) => queuePredicate(q))
    .filter((p): p is string => Boolean(p));
  return `(${parts.join(" or ")})`;
}

export async function enrichmentEligibilityCounts(db: Sql) {
  await ensureEnrichmentTables(db);
  const qn = async (text: string) => (await db.query<{ n: number }>(text))[0]?.n ?? 0;
  const base = `from entities e where e.visibility = 'public' and e.merged_into_id is null`;
  const procurementOnly = await qn(`select count(*)::int as n ${base} and ${queuePredicate("procurement_only")}`);
  const missingReg = await qn(`select count(*)::int as n ${base} and ${queuePredicate("no_registration")}`);
  const missingSector = await qn(`select count(*)::int as n ${base} and ${queuePredicate("no_sector")}`);
  const missingDomain = await qn(`select count(*)::int as n ${base} and ${queuePredicate("no_website")}`);
  const noCert = await qn(`select count(*)::int as n ${base} and ${queuePredicate("no_current_certificate")}`);
  const expiredOnly = await qn(`select count(*)::int as n ${base} and ${queuePredicate("expired_certificate_only")}`);
  const noSource = await qn(`select count(*)::int as n ${base} and ${queuePredicate("no_monitored_source")}`);
  const eligible = await qn(`select count(*)::int as n ${base} and ${eligibleForEnrichmentPredicate()}`);
  const highPriority = await qn(
    `select count(*)::int as n ${base} and ${eligibleForEnrichmentPredicate()}
     and exists (
       select 1 from evidence_entity_links l
       join evidence ev on ev.id = l.evidence_id
       where l.entity_id = e.id and ev.publication_state = 'published'
         and ev.evidence_type = 'government_procurement_disclosure'
         and ev.issue_date >= '2025-01-01'
     )`,
  );
  return {
    eligible,
    highPriority,
    procurementOnly,
    missingRegistration: missingReg,
    missingSector,
    missingDomain,
    noCertificate: noCert,
    expiredCertificateOnly: expiredOnly,
    noMonitoredSource: noSource,
  };
}

export async function listEligibleCompanies(db: Sql, limit: number, entityId?: string) {
  const cap = Math.min(100, Math.max(1, limit));
  if (entityId) {
    return db.query<EligibleRow>(eligibleSelect(true) + " and e.id = $1 limit 1", [entityId]);
  }
  const rows = await db.query<EligibleRow>(eligibleSelect() + ` limit $1`, [Math.min(400, cap * 8)]);
  return rows
    .map((row) => ({
      ...row,
      score: enrichmentPriorityScore({
        evidenceCount: row.evidence_n,
        procurementCount: row.procurement_n,
        institutionCount: row.institution_n,
        latestProcurementYear: row.latest_year,
        hasWebsite: Boolean(row.website),
        hasRegistration: Boolean(row.registration_number),
        hasCertificate: row.cert_n > 0,
        hasCurrentCertificate: row.has_current,
        jseListed: row.jse,
        isGroup: row.entity_type === "group",
        hasParent: row.has_parent,
      }),
    }))
    .sort((a, b) => b.score - a.score || a.canonical_name.localeCompare(b.canonical_name))
    .slice(0, cap);
}

type EligibleRow = {
  id: string;
  slug: string;
  canonical_name: string;
  registration_number: string | null;
  website: string | null;
  entity_type: string;
  evidence_n: number;
  procurement_n: number;
  institution_n: number;
  latest_year: number | null;
  cert_n: number;
  has_current: boolean;
  jse: boolean;
  has_parent: boolean;
};

function eligibleSelect(anyCompany = false): string {
  return `select e.id, e.slug, e.canonical_name, e.registration_number, e.website, e.entity_type,
            (select count(*)::int from evidence_entity_links l join evidence ev on ev.id = l.evidence_id
             where l.entity_id = e.id and ev.publication_state = 'published') as evidence_n,
            (select count(*)::int from evidence_entity_links l join evidence ev on ev.id = l.evidence_id
             where l.entity_id = e.id and ev.publication_state = 'published'
               and ev.evidence_type = 'government_procurement_disclosure') as procurement_n,
            (select count(distinct ev.document_issuer)::int from evidence_entity_links l join evidence ev on ev.id = l.evidence_id
             where l.entity_id = e.id and ev.publication_state = 'published' and ev.document_issuer is not null) as institution_n,
            (select max(extract(year from ev.issue_date)::int) from evidence_entity_links l join evidence ev on ev.id = l.evidence_id
             where l.entity_id = e.id and ev.evidence_type = 'government_procurement_disclosure') as latest_year,
            (select count(*)::int from evidence_entity_links l join evidence ev on ev.id = l.evidence_id
             where l.entity_id = e.id and ev.publication_state = 'published'
               and ev.evidence_type in ('bee_certificate','sworn_affidavit')) as cert_n,
            exists (select 1 from entity_current_state cs
                    where cs.entity_id = e.id and cs.lifecycle_state in ('current','expiring_soon')) as has_current,
            exists (select 1 from entity_classifications c where c.entity_id = e.id and c.sector_id = 'sec_jse') as jse,
            exists (select 1 from entity_relationships r
                    where r.source_entity_id = e.id and r.relationship_type in ('parent','holding_company')) as has_parent
     from entities e
     where e.visibility = 'public' and e.merged_into_id is null
       ${anyCompany ? "" : `and ${eligibleForEnrichmentPredicate()}`}`;
}

export async function enrichCompany(
  db: Sql,
  entityId: string,
  opts?: { crawl?: boolean; actorId?: string; jobId?: string },
): Promise<EnrichCompanyResult> {
  const actorId = opts?.actorId ?? ACTOR;
  const stats: EnrichmentStats = { ...EMPTY_STATS, attempted: 1 };
  const entity = (
    await db.query<{
      id: string;
      canonical_name: string;
      registration_number: string | null;
      website: string | null;
    }>(
      "select id, canonical_name, registration_number, website from entities where id = $1 and merged_into_id is null",
      [entityId],
    )
  )[0];
  if (!entity) {
    return { ...stats, errors: 1, entityId, name: entityId, filled: [], error: "Company not found." };
  }
  const filled: string[] = [];
  try {
    const reg = await copyRegistrationIfMissing(db, entity, actorId);
    if (reg) {
      stats.registrationsFound += 1;
      filled.push(`registration:${reg}`);
    }

    const domain = await discoverOfficialDomain(db, entity, actorId);
    if (domain) {
      stats.domainsFound += 1;
      filled.push(`domain:${domain}`);
    }

    const website = (
      await db.query<{ website: string | null }>("select website from entities where id = $1", [entityId])
    )[0]?.website;

    const sourceCreated = await ensureWebsiteSource(db, entityId, website, actorId);
    if (sourceCreated) {
      stats.sourcesAdded += 1;
      filled.push(`source:${sourceCreated}`);
    }

    if (opts?.crawl !== false && website) {
      const hasCert = await db.query<{ n: number }>(
        `select count(*)::int as n from evidence_entity_links l
         join evidence ev on ev.id = l.evidence_id
         where l.entity_id = $1 and ev.publication_state = 'published'
           and ev.evidence_type in ('bee_certificate','sworn_affidavit')`,
        [entityId],
      );
      if ((hasCert[0]?.n ?? 0) === 0) {
        const sources = await db.query<{ id: string }>(
          "select id from monitored_sources where entity_id = $1 and enabled = 1 limit 1",
          [entityId],
        );
        if (sources[0]) {
          const before = await db.query<{ n: number }>(
            `select count(*)::int as n from evidence_entity_links l
             join evidence ev on ev.id = l.evidence_id
             where l.entity_id = $1 and ev.evidence_type in ('bee_certificate','sworn_affidavit')`,
            [entityId],
          );
          await runSourceCheck(db, sources[0].id, { type: "enrichment", id: actorId });
          const after = await db.query<{ n: number }>(
            `select count(*)::int as n from evidence_entity_links l
             join evidence ev on ev.id = l.evidence_id
             where l.entity_id = $1 and ev.evidence_type in ('bee_certificate','sworn_affidavit')`,
            [entityId],
          );
          const found = (after[0]?.n ?? 0) - (before[0]?.n ?? 0);
          if (found > 0) {
            stats.certificatesFound += found;
            filled.push(`certificates:${found}`);
          }
        }
      }
    }

    const verifierReview = await maybeVerifierReview(db, entityId, opts?.jobId);
    if (verifierReview) {
      stats.reviewsCreated += 1;
      filled.push("review:verifier");
    }
  } catch (err) {
    stats.errors += 1;
    return {
      ...stats,
      entityId,
      name: entity.canonical_name,
      filled,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (filled.length) stats.enriched = 1;
  await audit(db, {
    actorType: "admin",
    actorId,
    action: "entity.enriched",
    targetType: "entity",
    targetId: entityId,
    after: { filled },
    reason: filled.length ? `Enrichment filled: ${filled.join(", ")}` : "Enrichment ran; no safe updates.",
  });
  return { ...stats, entityId, name: entity.canonical_name, filled };
}

async function copyRegistrationIfMissing(
  db: Sql,
  entity: { id: string; canonical_name: string; registration_number: string | null },
  actorId: string,
): Promise<string | null> {
  if (entity.registration_number && isZaCompanyRegistration(entity.registration_number) && !isVerifierRegistration(entity.registration_number)) {
    return null;
  }
  const rows = await db.query<{ value: string | null }>(
    `select cs.registration_number as value from entity_current_state cs where cs.entity_id = $1
     union all
     select pc.value from published_claims pc where pc.entity_id = $1 and pc.field_key = 'registration_number'
     union all
     select coalesce(c.normalized_value, c.raw_value)
     from evidence_entity_links l
     join evidence ev on ev.id = l.evidence_id
     join extracted_claims c on c.evidence_id = ev.id and c.field_key = 'registration_number'
     where l.entity_id = $1 and ev.publication_state = 'published'
       and ev.evidence_type in ('bee_certificate','sworn_affidavit')`,
    [entity.id],
  );
  const values = new Set<string>();
  for (const row of rows) {
    const formatted = formatZaRegistration(row.value);
    if (!formatted || isVerifierRegistration(formatted)) continue;
    values.add(formatted);
  }
  if (values.size !== 1) {
    if (values.size > 1) {
      await ensureReviewItem(db, {
        type: "registration_number_conflict",
        reason: `Enrichment found conflicting registration numbers for ${entity.canonical_name}. Existing value was preserved.`,
        entityId: entity.id,
        payload: { values: [...values] },
      });
    }
    return null;
  }
  const registration = [...values][0]!;
  const clash = await db.query<{ id: string }>(
    `select id from entities
     where registration_number_normalized = $1 and id <> $2 and merged_into_id is null
     limit 1`,
    [normalizeRegistration(registration), entity.id],
  );
  if (clash[0]) {
    await ensureReviewItem(db, {
      type: "registration_number_conflict",
      reason: `Enrichment registration ${registration} already belongs to another entity.`,
      entityId: entity.id,
    });
    return null;
  }
  await updateEntity(db, { id: entity.id, registrationNumber: registration, actorId });
  return registration;
}

async function discoverOfficialDomain(
  db: Sql,
  entity: { id: string; website: string | null },
  actorId: string,
): Promise<string | null> {
  if (entity.website) return null;
  const rows = await db.query<{ source_domain: string | null; source_url: string | null; evidence_type: string }>(
    `select ev.source_domain, ev.source_url, ev.evidence_type
     from evidence ev
     join evidence_entity_links l on l.evidence_id = ev.id
     where l.entity_id = $1 and ev.publication_state = 'published'
       and ev.evidence_type in ('bee_certificate','sworn_affidavit','company_disclosure','annual_report','integrated_report','transformation_report','investor_document','company_webpage')
     order by ev.issue_date desc nulls last`,
    [entity.id],
  );
  for (const row of rows) {
    const host = (row.source_domain || extractDomain(row.source_url ?? "") || "").replace(/^www\./, "");
    if (!host || NON_COMPANY_HOST.test(host)) continue;
    const url = row.source_url && /^https?:/i.test(row.source_url) ? new URL(row.source_url).origin : `https://${host}`;
    await updateEntity(db, { id: entity.id, website: url, actorId });
    return url;
  }
  return null;
}

async function ensureWebsiteSource(db: Sql, entityId: string, website: string | null, actorId: string): Promise<string | null> {
  if (!website) return null;
  let url = website.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const domain = extractDomain(url);
  if (!domain) return null;
  const existing = await db.query<{ id: string }>(
    `select id from monitored_sources
     where entity_id = $1
       and domain = regexp_replace(lower(split_part(regexp_replace($2, '^https?://', ''), '/', 1)), '^www\\.', '')
     limit 1`,
    [entityId, url],
  );
  if (existing[0]) return null;
  try {
    const id = await createSource(db, {
      url,
      entityId,
      sourceType: "company_homepage",
      frequency: "monthly",
      crawlConfig: {
        urlPatterns: ["bbbee", "b-bbee", "bee", "transformation", "sustainability", "certificate", "scorecard"],
        maxLinks: 40,
        maxDepth: 1,
      },
      actorId,
    });
    return id;
  } catch {
    return null;
  }
}

async function maybeVerifierReview(db: Sql, entityId: string, jobId?: string): Promise<boolean> {
  const certs = await db.query<{ id: string }>(
    `select ev.id from evidence ev
     join evidence_entity_links l on l.evidence_id = ev.id
     where l.entity_id = $1 and ev.publication_state = 'published'
       and ev.evidence_type in ('bee_certificate','sworn_affidavit')
       and ev.verifier_agency_id is null
     limit 1`,
    [entityId],
  );
  if (!certs[0]) return false;
  await ensureReviewItem(db, {
    type: "verifier_mismatch",
    reason: "Certificate evidence has no linked verification agency after enrichment.",
    entityId,
    evidenceId: certs[0].id,
    jobId,
  });
  return true;
}

function addStats(a: EnrichmentStats, b: EnrichmentStats): EnrichmentStats {
  return {
    attempted: a.attempted + b.attempted,
    enriched: a.enriched + b.enriched,
    certificatesFound: a.certificatesFound + b.certificatesFound,
    registrationsFound: a.registrationsFound + b.registrationsFound,
    domainsFound: a.domainsFound + b.domainsFound,
    sectorsAdded: a.sectorsAdded + b.sectorsAdded,
    sourcesAdded: a.sourcesAdded + b.sourcesAdded,
    reviewsCreated: a.reviewsCreated + b.reviewsCreated,
    errors: a.errors + b.errors,
  };
}

export async function startEnrichmentRun(
  db: Sql,
  input: { batchSize: number; entityId?: string; actorId: string; crawl?: boolean },
): Promise<{ jobId: string; runId: string }> {
  await ensureEnrichmentTables(db);
  const jobId = newId("job");
  const runId = newId("enr");
  await db.query(
    `insert into crawler_jobs (id, type, state, started_at, created_by)
     values ($1,'enrichment','running',now(),$2)`,
    [jobId, input.actorId],
  );
  await db.query(
    `insert into enrichment_runs (id, job_id, entity_id, batch_size, status, created_by)
     values ($1,$2,$3,$4,'processing',$5)`,
    [runId, jobId, input.entityId ?? null, input.batchSize, input.actorId],
  );
  await jobEvent(db, jobId, "info", input.entityId ? "Single-company enrichment started." : `Enrichment pass started (batch ${input.batchSize}).`);
  return { jobId, runId };
}

export async function processEnrichmentRun(
  db: Sql,
  runId: string,
  opts?: { crawl?: boolean; timeBudgetMs?: number },
): Promise<{ status: string }> {
  const run = (
    await db.query<{
      id: string;
      job_id: string;
      entity_id: string | null;
      batch_size: number;
      attempted: number;
      status: string;
      created_by: string | null;
      stop_requested: number;
    }>("select * from enrichment_runs where id = $1", [runId])
  )[0];
  if (!run) return { status: "missing" };
  if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") return { status: run.status };

  const started = Date.now();
  const budget = opts?.timeBudgetMs ?? 45_000;
  const remaining = Math.max(0, run.batch_size - run.attempted);
  const queue = await listEligibleCompanies(db, remaining || run.batch_size, run.entity_id ?? undefined);
  const already = new Set(
    (
      await db.query<{ message: string }>(
        "select message from crawler_job_events where job_id = $1 and message like 'Enriched:%'",
        [run.job_id],
      )
    ).map((r) => r.message),
  );

  let stats: EnrichmentStats = {
    attempted: run.attempted,
    enriched: (await db.query<{ n: number }>("select enriched as n from enrichment_runs where id = $1", [runId]))[0]?.n ?? 0,
    certificatesFound: 0,
    registrationsFound: 0,
    domainsFound: 0,
    sectorsAdded: 0,
    sourcesAdded: 0,
    reviewsCreated: 0,
    errors: 0,
  };
  const live = (
    await db.query<EnrichmentStats & { enriched: number }>(
      `select attempted, enriched, certificates_found as "certificatesFound", registrations_found as "registrationsFound",
              domains_found as "domainsFound", sectors_added as "sectorsAdded", sources_added as "sourcesAdded",
              reviews_created as "reviewsCreated", errors
       from enrichment_runs where id = $1`,
      [runId],
    )
  )[0];
  if (live) stats = { ...live };

  let processedThisTick = 0;
  for (const company of queue) {
    const stop = (
      await db.query<{ stop_requested: number; status: string }>(
        "select stop_requested, status from enrichment_runs where id = $1",
        [runId],
      )
    )[0];
    if (stop?.stop_requested) {
      await finishRun(db, run, "cancelled", "Stopped after current company.");
      return { status: "cancelled" };
    }
    if (Date.now() - started > budget && processedThisTick > 0) {
      await db.query("update crawler_jobs set state = 'queued' where id = $1 and state = 'running'", [run.job_id]);
      await jobEvent(db, run.job_id, "info", "Yielding; remaining companies will continue in the background.");
      return { status: "processing" };
    }
    const marker = `Enriched:${company.id}`;
    if (already.has(marker)) continue;

    await db.query(
      `update enrichment_runs set current_company = $2, current_entity_id = $3, status = 'processing' where id = $1`,
      [runId, company.canonical_name, company.id],
    );
    const result = await enrichCompany(db, company.id, {
      crawl: opts?.crawl !== false && stats.certificatesFound < 8,
      actorId: run.created_by ?? ACTOR,
      jobId: run.job_id,
    });
    stats = addStats(stats, result);
    processedThisTick += 1;
    await db.query(
      `update enrichment_runs set
          attempted = $2, enriched = $3, certificates_found = $4, registrations_found = $5,
          domains_found = $6, sectors_added = $7, sources_added = $8, reviews_created = $9, errors = $10
       where id = $1`,
      [
        runId,
        stats.attempted,
        stats.enriched,
        stats.certificatesFound,
        stats.registrationsFound,
        stats.domainsFound,
        stats.sectorsAdded,
        stats.sourcesAdded,
        stats.reviewsCreated,
        stats.errors,
      ],
    );
    await db.query(
      "update crawler_jobs set discovered_items = $2, changed_items = $3 where id = $1",
      [run.job_id, stats.attempted, stats.enriched],
    );
    await jobEvent(db, run.job_id, result.error ? "error" : "info", marker, {
      name: result.name,
      filled: result.filled,
      error: result.error,
    });
    if (stats.attempted >= run.batch_size && !run.entity_id) break;
    if (run.entity_id) break;
  }

  await finishRun(db, run, stats.errors && !stats.enriched ? "failed" : "completed");
  return { status: "completed" };
}

async function finishRun(
  db: Sql,
  run: { id: string; job_id: string },
  status: string,
  error?: string,
) {
  await db.query(
    `update enrichment_runs
     set status = $2, current_company = null, current_entity_id = null, finished_at = now(), error = $3
     where id = $1`,
    [run.id, status, error ?? null],
  );
  await db.query(
    `update crawler_jobs set state = $2, finished_at = now(), error = $3 where id = $1`,
    [run.id === run.job_id ? run.job_id : run.job_id, status === "completed" ? "succeeded" : status === "cancelled" ? "cancelled" : status === "failed" ? "failed" : "succeeded", error ?? null],
  );
  await jobEvent(db, run.job_id, "info", `Enrichment ${status}.`);
}

export async function continueQueuedEnrichment(db: Sql): Promise<string[]> {
  const rows = await db.query<{ id: string }>(
    `select id from enrichment_runs
     where status in ('queued','processing')
     order by created_at
     limit 2`,
  );
  const ids: string[] = [];
  for (const row of rows) {
    await processEnrichmentRun(db, row.id, { timeBudgetMs: 40_000 });
    ids.push(row.id);
  }
  return ids;
}

export async function requestStopEnrichment(db: Sql, runId: string) {
  await db.query("update enrichment_runs set stop_requested = 1 where id = $1 and status in ('queued','processing')", [
    runId,
  ]);
}

export async function listEnrichmentHistory(db: Sql, limit = 20) {
  await ensureEnrichmentTables(db);
  return db.query<{
    id: string;
    job_id: string | null;
    batch_size: number;
    status: string;
    attempted: number;
    enriched: number;
    certificates_found: number;
    registrations_found: number;
    domains_found: number;
    sectors_added: number;
    reviews_created: number;
    errors: number;
    created_at: string;
    finished_at: string | null;
  }>(
    `select id, job_id, batch_size, status, attempted, enriched, certificates_found, registrations_found,
            domains_found, sectors_added, reviews_created, errors, created_at, finished_at
     from enrichment_runs
     order by created_at desc
     limit $1`,
    [limit],
  );
}
