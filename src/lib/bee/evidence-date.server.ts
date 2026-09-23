import { audit } from "./audit.server.ts";
import {
  inferEvidenceDateFromSource,
  isImportTimestampDate,
  polishEvidenceTitle,
  resolveEvidenceDate,
  type DatePrecision,
  type EvidenceDateInput,
} from "./evidence-date.ts";
import { getSetting, setSetting } from "./settings.server.ts";
import type { Sql } from "./db-types.ts";

const ACTOR = "repair:evidence-dates";

type EvidenceDateRow = {
  id: string;
  title: string | null;
  source_url: string | null;
  issue_date: string | null;
  issue_date_raw: string | null;
  issue_date_precision: string | null;
  created_at: string;
  retrieved_at: string | null;
  discovered_at: string;
  evidence_type?: string;
};

function asInput(row: EvidenceDateRow): EvidenceDateInput {
  return {
    issueDate: row.issue_date,
    issueDateRaw: row.issue_date_raw,
    precision: row.issue_date_precision,
    sourceUrl: row.source_url,
    title: row.title,
    createdAt: row.created_at,
    retrievedAt: row.retrieved_at,
    discoveredAt: row.discovered_at,
  };
}

export type DateAuditBucket = "exact" | "month" | "year" | "unknown" | "import_timestamp";

export type ProcurementDateAudit = {
  audited: number;
  exact: number;
  month: number;
  year: number;
  unknown: number;
  importTimestamp: number;
  corrected: number;
  leftUnstated: number;
  titlesPolished: number;
  timelineOrderChanged: number;
  samples: Array<{
    id: string;
    title: string | null;
    sourceUrl: string | null;
    before: string | null;
    after: string | null;
    precision: string | null;
    bucket: DateAuditBucket;
  }>;
};

function bucketOf(precision: DatePrecision | null, stated: boolean): DateAuditBucket {
  if (!stated || !precision) return "unknown";
  if (precision === "day") return "exact";
  if (precision === "month") return "month";
  return "year";
}

const SELECT_SQL = `select id, title, source_url, issue_date::text as issue_date, issue_date_raw, issue_date_precision,
            created_at::text as created_at, retrieved_at::text as retrieved_at, discovered_at::text as discovered_at,
            evidence_type
     from evidence`;

async function ensureDateColumns(db: Sql) {
  await db.query(`alter table evidence add column if not exists issue_date_precision text`);
}

export async function auditProcurementEvidenceDates(db: Sql): Promise<ProcurementDateAudit> {
  await ensureDateColumns(db);
  const rows = await db.query<EvidenceDateRow>(SELECT_SQL);
  const counts: Record<DateAuditBucket, number> = {
    exact: 0,
    month: 0,
    year: 0,
    unknown: 0,
    import_timestamp: 0,
  };
  const samples: ProcurementDateAudit["samples"] = [];
  for (const row of rows) {
    const input = asInput(row);
    const wasImport = isImportTimestampDate(input) || !row.issue_date;
    const resolved = resolveEvidenceDate(input);
    const bucket =
      wasImport && (!row.issue_date || isImportTimestampDate(input))
        ? "import_timestamp"
        : bucketOf(resolved.precision, resolved.stated);
    counts[bucket] += 1;
    if (samples.length < 12) {
      samples.push({
        id: row.id,
        title: row.title,
        sourceUrl: row.source_url,
        before: row.issue_date,
        after: resolved.iso,
        precision: resolved.precision,
        bucket,
      });
    }
  }
  return {
    audited: rows.length,
    exact: counts.exact,
    month: counts.month,
    year: counts.year,
    unknown: counts.unknown,
    importTimestamp: counts.import_timestamp,
    corrected: 0,
    leftUnstated: counts.unknown,
    titlesPolished: 0,
    timelineOrderChanged: 0,
    samples,
  };
}

export async function repairProcurementEvidenceDates(db: Sql): Promise<ProcurementDateAudit> {
  await ensureDateColumns(db);
  const rows = await db.query<EvidenceDateRow>(SELECT_SQL);
  const counts: Record<DateAuditBucket, number> = {
    exact: 0,
    month: 0,
    year: 0,
    unknown: 0,
    import_timestamp: 0,
  };
  let corrected = 0;
  let titlesPolished = 0;
  let timelineOrderChanged = 0;
  let leftUnstated = 0;
  const samples: ProcurementDateAudit["samples"] = [];
  const ids: string[] = [];
  const isos: string[] = [];
  const precisions: string[] = [];
  const raws: string[] = [];
  const titles: string[] = [];

  for (const row of rows) {
    const input = asInput(row);
    const wasImport = isImportTimestampDate(input) || !row.issue_date;
    const resolved = resolveEvidenceDate(input);
    const polished =
      row.evidence_type === "government_procurement_disclosure" || !row.evidence_type
        ? polishEvidenceTitle(row.title, resolved)
        : row.title;
    const nextIso = resolved.stated ? resolved.iso : null;
    const nextPrecision = resolved.stated ? resolved.precision : null;
    const nextRaw = resolved.stated ? resolved.raw : row.issue_date_raw;
    const dateChanged =
      (row.issue_date ?? null) !== (nextIso ?? null) || (row.issue_date_precision ?? null) !== (nextPrecision ?? null);
    const titleChanged = Boolean(polished && polished !== row.title);

    if (wasImport && (!row.issue_date || isImportTimestampDate(input))) counts.import_timestamp += 1;
    else counts[bucketOf(resolved.precision, resolved.stated)] += 1;
    if (!resolved.stated) leftUnstated += 1;

    if (dateChanged || titleChanged) {
      ids.push(row.id);
      isos.push(nextIso ?? "");
      precisions.push(nextPrecision ?? "");
      raws.push(nextRaw ?? "");
      titles.push(titleChanged ? polished ?? "" : "");
      if (dateChanged) {
        corrected += 1;
        if ((row.issue_date ?? "") !== (nextIso ?? "")) timelineOrderChanged += 1;
      }
      if (titleChanged) titlesPolished += 1;
      if (samples.length < 25) {
        samples.push({
          id: row.id,
          title: polished ?? row.title,
          sourceUrl: row.source_url,
          before: row.issue_date,
          after: nextIso,
          precision: nextPrecision,
          bucket:
            wasImport && isImportTimestampDate(input)
              ? "import_timestamp"
              : bucketOf(resolved.precision, resolved.stated),
        });
      }
    }
  }

  const CHUNK = 400;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    await db.query(
      `update evidence e
          set issue_date = nullif(u.iso, '')::date,
              issue_date_precision = nullif(u.precision, ''),
              issue_date_raw = nullif(u.raw, ''),
              publication_date = coalesce(nullif(u.iso, '')::date, e.publication_date),
              title = case when u.title <> '' then u.title else e.title end,
              updated_at = now()
        from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
             as u(id, iso, precision, raw, title)
       where e.id = u.id`,
      [slice, isos.slice(i, i + CHUNK), precisions.slice(i, i + CHUNK), raws.slice(i, i + CHUNK), titles.slice(i, i + CHUNK)],
    );
    await db.query(
      `update extracted_claims c
          set normalized_value = nullif(u.iso, ''),
              raw_value = coalesce(nullif(u.raw, ''), c.raw_value)
        from unnest($1::text[], $2::text[], $3::text[]) as u(id, iso, raw)
       where c.evidence_id = u.id and c.field_key = 'issue_date'`,
      [slice, isos.slice(i, i + CHUNK), raws.slice(i, i + CHUNK)],
    );
  }

  await audit(db, {
    actorType: "system",
    actorId: ACTOR,
    action: "evidence.dates_repaired",
    targetType: "evidence",
    targetId: "procurement",
    after: { corrected, titlesPolished, leftUnstated, audited: rows.length, importTimestamp: counts.import_timestamp },
    reason: "Separated source/evidence dates from import timestamps; stored precision without inventing days.",
  });

  return {
    audited: rows.length,
    exact: counts.exact,
    month: counts.month,
    year: counts.year,
    unknown: counts.unknown,
    importTimestamp: counts.import_timestamp,
    corrected,
    leftUnstated,
    titlesPolished,
    timelineOrderChanged,
    samples,
  };
}

export async function ensureEvidenceDatesRepaired(db: Sql): Promise<ProcurementDateAudit | { skipped: true }> {
  const done = await getSetting<boolean>("evidence_dates_repaired_v1", false, db);
  if (done === true) return { skipped: true };
  const result = await repairProcurementEvidenceDates(db);
  await setSetting("evidence_dates_repaired_v1", true, ACTOR, db);
  await setSetting("evidence_dates_repaired_v1_report", result, ACTOR, db);
  return result;
}
