import { audit } from "./audit.server.ts";
import { jsonText, type Sql } from "./db-types.ts";
import { newId } from "./ids.ts";
import {
  classifyEntityEligibility,
  type EligibilityBucket,
  type EligibilityEvidence,
  type EligibilityResult,
} from "./recency.ts";

const ACTOR = "import:recency-corrected-dates-2026";

export type StaleEntityRow = {
  id: string;
  slug: string;
  canonical_name: string;
  evidence: Array<{
    id: string;
    type: string;
    lifecycle?: string | null;
    issue_date: string | Date | null;
    issue_date_raw?: string | null;
    issue_date_precision?: string | null;
    source_url: string | null;
    title: string | null;
    created_at?: string | Date | null;
    retrieved_at?: string | Date | null;
    discovered_at?: string | Date | null;
  }>;
};

export type ClassifiedEntity = StaleEntityRow & {
  eligibility: EligibilityResult;
};

function asEligibilityEvidence(ev: StaleEntityRow["evidence"][number]): EligibilityEvidence {
  return {
    id: ev.id,
    type: ev.type,
    lifecycle: ev.lifecycle,
    issueDate: ev.issue_date,
    issueDateRaw: ev.issue_date_raw,
    precision: ev.issue_date_precision,
    sourceUrl: ev.source_url,
    title: ev.title,
    createdAt: ev.created_at,
    retrievedAt: ev.retrieved_at,
    discoveredAt: ev.discovered_at,
  };
}

export function entityLacksQualifyingEvidence(row: StaleEntityRow): boolean {
  return !classifyEntityEligibility(row.evidence.map(asEligibilityEvidence)).qualifies;
}

/** @deprecated name kept for the recency API; now means “no 2024+ qualifying evidence”. */
export function entityIsStaleProcurementOnly(row: StaleEntityRow): boolean {
  return entityLacksQualifyingEvidence(row);
}

function parseEvidence(value: StaleEntityRow["evidence"] | string | null): StaleEntityRow["evidence"] {
  if (!value) return [];
  const rows = typeof value === "string" ? (JSON.parse(value) as StaleEntityRow["evidence"]) : value;
  return (rows ?? []).filter((ev) => ev && ev.id);
}

export async function listPublishedEntitiesWithEvidence(db: Sql): Promise<StaleEntityRow[]> {
  const rows = await db.query<{
    id: string;
    slug: string;
    canonical_name: string;
    evidence: StaleEntityRow["evidence"] | string | null;
  }>(
    `select e.id, e.slug, e.canonical_name,
            coalesce(json_agg(json_build_object(
              'id', ev.id,
              'type', ev.evidence_type,
              'lifecycle', ev.lifecycle_state,
              'issue_date', ev.issue_date,
              'issue_date_raw', ev.issue_date_raw,
              'issue_date_precision', ev.issue_date_precision,
              'source_url', ev.source_url,
              'title', ev.title,
              'created_at', ev.created_at,
              'retrieved_at', ev.retrieved_at,
              'discovered_at', ev.discovered_at
            ) order by ev.id) filter (where ev.id is not null), '[]'::json) as evidence
     from entities e
     left join evidence_entity_links l on l.entity_id = e.id and l.link_state in ('confirmed','extracted')
     left join evidence ev on ev.id = l.evidence_id and ev.publication_state = 'published'
     where e.visibility = 'public' and e.merged_into_id is null
     group by e.id, e.slug, e.canonical_name`,
  );
  return rows.map((row) => ({
    ...row,
    evidence: parseEvidence(row.evidence),
  }));
}

export function classifyPublishedEntities(rows: StaleEntityRow[]): ClassifiedEntity[] {
  return rows.map((row) => ({
    ...row,
    eligibility: classifyEntityEligibility(row.evidence.map(asEligibilityEvidence)),
  }));
}

export async function listStaleProcurementEntities(db: Sql): Promise<StaleEntityRow[]> {
  const rows = await listPublishedEntitiesWithEvidence(db);
  return classifyPublishedEntities(rows)
    .filter((row) => !row.eligibility.qualifies)
    .map(({ eligibility: _e, ...row }) => row);
}

function sampleRow(row: ClassifiedEntity) {
  const first = row.evidence[0];
  return {
    id: row.id,
    slug: row.slug,
    canonical_name: row.canonical_name,
    bucket: row.eligibility.bucket,
    latestKind: row.eligibility.latestKind,
    directoryHistoricalLatest: row.eligibility.directoryHistoricalLatest,
    qualifyingCount: row.eligibility.qualifyingCount,
    unknownCount: row.eligibility.unknownCount,
    pre2024Count: row.eligibility.pre2024Count,
    modernCount: row.eligibility.modernCount,
    currentCertificate: row.eligibility.currentCertificate,
    reason: row.eligibility.reason,
    evidenceTitle: first?.title ?? null,
    evidenceUrl: first?.source_url ?? null,
    evidenceDate: first?.issue_date ?? null,
  };
}

export type RecencyAuditReport = {
  published: number;
  audited: number;
  historicalLatest: number;
  keepHasNewer: number;
  unpublishPre2024: number;
  unpublishUnknown: number;
  keepOtherReason: number;
  keepQualifyingLatest: number;
  unpublished: number;
  remaining: number;
  dryRun: boolean;
  historicalEvidenceRetained: number;
  amaza: ReturnType<typeof sampleRow> | { found: false; slugSearch: string };
  samples: ReturnType<typeof sampleRow>[];
  unpublishedNames: string[];
  keepHasNewerSamples: ReturnType<typeof sampleRow>[];
  previousCleanup: {
    reliedOnIncorrectDates: true;
    usedStoredIssueDateIncludingImportTimestamps: true;
    usedCmsFolderYears: true;
    treatedUnknownDateAsModern: true;
    note: string;
  };
};

function emptyCounts(): Record<EligibilityBucket, number> {
  return {
    keep_qualifying_latest: 0,
    keep_has_newer: 0,
    unpublish_pre2024: 0,
    keep_other_reason: 0,
    unpublish_unknown: 0,
  };
}

function buildReport(
  classified: ClassifiedEntity[],
  unpublished: ClassifiedEntity[],
  dryRun: boolean,
): RecencyAuditReport {
  const counts = emptyCounts();
  let historicalLatest = 0;
  let historicalEvidenceRetained = 0;
  for (const row of classified) {
    counts[row.eligibility.bucket] += 1;
    if (row.eligibility.directoryHistoricalLatest) historicalLatest += 1;
    historicalEvidenceRetained += row.evidence.length;
  }
  const ineligible = classified.filter((row) => !row.eligibility.qualifies);
  const amaza = classified.find((row) => /amaza/i.test(row.slug) || /amaza/i.test(row.canonical_name));
  const keepHasNewer = classified.filter((row) => row.eligibility.bucket === "keep_has_newer");
  return {
    published: classified.length,
    audited: classified.length,
    historicalLatest,
    keepHasNewer: counts.keep_has_newer,
    unpublishPre2024: counts.unpublish_pre2024,
    unpublishUnknown: counts.unpublish_unknown,
    keepOtherReason: counts.keep_other_reason,
    keepQualifyingLatest: counts.keep_qualifying_latest,
    unpublished: dryRun ? 0 : unpublished.length,
    remaining: ineligible.length - (dryRun ? 0 : unpublished.length),
    dryRun,
    historicalEvidenceRetained,
    amaza: amaza ? sampleRow(amaza) : { found: false, slugSearch: "amaza" },
    samples: ineligible.slice(0, 40).map(sampleRow),
    unpublishedNames: unpublished.map((row) => row.canonical_name),
    keepHasNewerSamples: keepHasNewer.slice(0, 20).map(sampleRow),
    previousCleanup: {
      reliedOnIncorrectDates: true,
      usedStoredIssueDateIncludingImportTimestamps: true,
      usedCmsFolderYears: true,
      treatedUnknownDateAsModern: true,
      note:
        "The 343-company stale cleanup (commit 0f0ea3a) used stored issue_date (often the import/discovered timestamp) and YEAR_IN_PATH_RE, which treated CMS folders such as file=2024-01/ as 2024 even when the document was July 2023. Unknown dates were treated as modern if the URL was not an archival bulletin. This pass recalculates from corrected source dates; unknown ≠ 2024+.",
    },
  };
}

export async function auditPublicRecency(db: Sql): Promise<RecencyAuditReport> {
  const classified = classifyPublishedEntities(await listPublishedEntitiesWithEvidence(db));
  const ineligible = classified.filter((row) => !row.eligibility.qualifies);
  return buildReport(classified, ineligible, true);
}

async function insertAuditBatch(db: Sql, rows: ClassifiedEntity[]) {
  if (!rows.length) return;
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const ids = slice.map(() => newId("aud"));
    const targetIds = slice.map((row) => row.id);
    const buckets = slice.map((row) => row.eligibility.bucket);
    const reasons = slice.map((row) =>
      row.eligibility.bucket === "unpublish_unknown"
        ? "Public page withdrawn: only evidence is undated (Not stated in source). Unknown date is not treated as 2024+. Entity, evidence and provenance were kept."
        : "Public page withdrawn: no qualifying evidence dated 1 January 2024 or later. Historical records were kept.",
    );
    await db.query(
      `insert into audit_logs
         (id, actor_type, actor_id, action, target_type, target_id, before_state, after_state, reason)
       select u.id, 'import', $4, 'entity.unpublished', 'entity', u.target_id,
              $5, json_build_object('visibility','hidden','bucket', u.bucket)::text, u.reason
         from unnest($1::text[], $2::text[], $3::text[], $6::text[]) as u(id, target_id, reason, bucket)`,
      [ids, targetIds, reasons, ACTOR, jsonText({ visibility: "public" }), buckets],
    );
  }
}

async function insertUnknownDateReviews(db: Sql, rows: ClassifiedEntity[]) {
  const unknown = rows.filter((row) => row.eligibility.needsReview);
  if (!unknown.length) return 0;
  const CHUNK = 200;
  let inserted = 0;
  for (let i = 0; i < unknown.length; i += CHUNK) {
    const slice = unknown.slice(i, i + CHUNK);
    const ids = slice.map(() => newId("rvw"));
    const entityIds = slice.map((row) => row.id);
    const evidenceIds = slice.map((row) => row.evidence.find((ev) => ev.id)?.id ?? null);
    const reasons = slice.map(
      (row) =>
        `Unpublished after corrected-date recency audit: ${row.eligibility.reason} Re-publish only if 2024–2026 qualifying evidence is found.`,
    );
    const payloads = slice.map((row) =>
      jsonText({
        bucket: row.eligibility.bucket,
        unknownCount: row.eligibility.unknownCount,
        pre2024Count: row.eligibility.pre2024Count,
        slug: row.slug,
      }),
    );
    await db.query(
      `insert into review_items (id, type, reason, severity, entity_id, evidence_id, payload)
       select u.id, 'invalid_dates', u.reason, 'normal', u.entity_id, nullif(u.evidence_id, ''), u.payload
         from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
              as u(id, reason, entity_id, evidence_id, payload)
       on conflict do nothing`,
      [ids, reasons, entityIds, evidenceIds.map((id) => id ?? ""), payloads],
    );
    inserted += slice.length;
  }
  return inserted;
}

export async function unpublishStaleProcurementEntities(
  db: Sql,
  input: { limit?: number; dryRun?: boolean } = {},
): Promise<RecencyAuditReport & { reviewsOpened: number }> {
  const classified = classifyPublishedEntities(await listPublishedEntitiesWithEvidence(db));
  const ineligible = classified.filter((row) => !row.eligibility.qualifies);
  const limit = input.limit ? Math.max(1, Math.min(input.limit, ineligible.length || 1)) : ineligible.length;
  const batch = ineligible.slice(0, input.limit ? limit : ineligible.length);
  let reviewsOpened = 0;
  if (!input.dryRun && batch.length) {
    const ids = batch.map((row) => row.id);
    await db.query(
      `update entities
          set visibility = 'hidden', updated_at = now()
        where id = any($1::text[]) and visibility = 'public'`,
      [ids],
    );
    await insertAuditBatch(db, batch);
    reviewsOpened = await insertUnknownDateReviews(db, batch);
  }
  return {
    ...buildReport(classified, input.dryRun ? [] : batch, Boolean(input.dryRun)),
    remaining: input.dryRun ? ineligible.length : Math.max(0, ineligible.length - batch.length),
    unpublished: input.dryRun ? 0 : batch.length,
    reviewsOpened: input.dryRun ? 0 : reviewsOpened,
  };
}
