/**
 * Runs on Vercel during `npm run build`, after migrations, where DATABASE_URL exists.
 * Local preview builds skip it. Each item is recorded so a later deploy does not
 * re-fetch documents that already published.
 */
import { editClaimValues } from "../src/lib/bee/claims.server.ts";
import { importCorpusItem, reprocessStoredUrls } from "../src/lib/bee/corpus-import.server.ts";
import { safeFetch } from "../src/lib/bee/fetch.server.ts";
import { FOREIGN_MEASURED_ENTITY_NAMES, MAJOR_GAP_ITEMS } from "../src/lib/bee/major-gap-packet.ts";
import { newId } from "../src/lib/bee/ids.ts";
import { applyLifecycleForEntity } from "../src/lib/bee/publication.server.ts";
import { ensureReviewItem } from "../src/lib/bee/review.server.ts";
import { getExpiringSoonDays } from "../src/lib/bee/settings.server.ts";
import { sql } from "../src/lib/bee/sql.server.ts";

const BUDGET_MS = 12 * 60 * 1000;
const CLEANUP_PASS = "cleanup-pass-20260924";
const RETRY_KEYS = [
  "media24-2026-certificate",
  "ninety-one-2026",
  "ford-2026",
  "rand-water-2025",
  "senwes-2025",
];
const TECHNICAL_KEYS = new Set(RETRY_KEYS);
const MEDIA24_URL = "https://media24.com/wp-content/uploads/2026/06/ELC14766_Media24-Group_BEE-Certificate_Final.pdf";
const JSE_INDEX = "https://group.jse.co.za/dated-document";

if (!process.env.DATABASE_URL?.trim()) {
  console.log("[major-gap] DATABASE_URL not set — skipping.");
  process.exit(0);
}

const db = await sql();
const started = Date.now();

async function record(key: string, status: string, detail: string) {
  await db.query(
    `insert into major_gap_imports (item_key, status, detail)
     values ($1, $2, $3)
     on conflict (item_key) do update
       set status = excluded.status, detail = excluded.detail, applied_at = now()`,
    [key, status, detail.slice(0, 2000)],
  );
}

type LinkedEvidence = {
  id: string;
  entity_id: string;
  evidence_type: string;
};

async function evidenceFor(fragment: string): Promise<LinkedEvidence[]> {
  return db.query<LinkedEvidence>(
    `select e.id, l.entity_id, e.evidence_type
     from evidence e
     join evidence_entity_links l on l.evidence_id = e.id
     where l.link_state in ('confirmed','extracted','candidate')
       and (e.source_url ilike $1 or e.canonical_url ilike $1 or e.discovered_url ilike $1 or e.title ilike $1)`,
    [`%${fragment}%`],
  );
}

async function ensureSuccessfulRun(evidenceId: string) {
  const rows = await db.query<{ id: string }>(
    "select id from extraction_runs where evidence_id = $1 and success = 1 limit 1",
    [evidenceId],
  );
  if (rows[0]) return;
  await db.query(
    `insert into extraction_runs (id, evidence_id, parser, schema_version, completed_at, success)
     values ($1,$2,'manual','extract-v1',now(),1)`,
    [newId("xrn"), evidenceId],
  );
}

async function correctEvidence(
  key: string,
  fragment: string,
  edits: Record<string, string>,
  columns: {
    issue: string;
    issueRaw: string;
    expiry?: string | null;
    expiryRaw?: string | null;
  },
  reason: string,
) {
  const rows = await evidenceFor(fragment);
  if (!rows.length) {
    await record(key, "missing", `No stored evidence matched ${fragment}`);
    console.log(`[major-gap] ${key} missing`);
    return;
  }
  const days = await getExpiringSoonDays(db);
  const entities = new Set<string>();
  for (const row of rows) {
    await ensureSuccessfulRun(row.id);
    await editClaimValues(db, { evidenceId: row.id, edits, actorId: "import:cleanup-20260924" });
    await db.query(
      `update evidence
         set issue_date = $2,
             issue_date_raw = $3,
             issue_date_precision = 'day',
             expiry_date = $4,
             expiry_date_raw = $5,
             updated_at = now()
       where id = $1`,
      [row.id, columns.issue, columns.issueRaw, columns.expiry ?? null, columns.expiryRaw ?? null],
    );
    await db.query(
      `insert into audit_logs
         (id, actor_type, actor_id, action, target_type, target_id, reason, related_evidence_id)
       values ($1,'import','import:cleanup-20260924','evidence.dates_corrected','evidence',$2,$3,$2)`,
      [newId("aud"), row.id, reason],
    );
    entities.add(row.entity_id);
  }
  for (const entityId of entities) {
    await applyLifecycleForEntity(db, entityId, days);
  }
  await record(key, "corrected", `${rows.length} evidence row(s). ${reason}`);
  console.log(`[major-gap] ${key} corrected ${rows.length}`);
}

async function correctKnownRecords() {
  await correctEvidence(
    "correct-stadio-dates",
    "STADIO-Group-BBBEE-Scorecard",
    { issue_date: "2025-03-27", expiry_date: "2026-03-26" },
    { issue: "2025-03-27", issueRaw: "27 March 2025", expiry: "2026-03-26", expiryRaw: "26 March 2026" },
    "STADIO SHL010523-REV7 issue 27 March 2025, expiry 26 March 2026. Expired. Not validity unconfirmed.",
  );
  await correctEvidence(
    "correct-sasria-date",
    "Sasria-Integrated-Report-2025",
    { issue_date: "2025-02-21" },
    { issue: "2025-02-21", issueRaw: "21 February 2025", expiry: null, expiryRaw: null },
    "Sasria 2025 integrated report: updated Level 8 certificate received 21 February 2025. Disclosure only, not a certificate. 5 March 2024 was the previous scorecard.",
  );
  await correctEvidence(
    "correct-bkb-gen534-image",
    "gen534-bkb-limited",
    {
      bee_level: "8",
      issue_date: "2026-03-20",
      expiry_date: "2027-03-19",
      recognition_level: "10%",
      certificate_number: "GEN534",
    },
    { issue: "2026-03-20", issueRaw: "20 March 2026", expiry: "2027-03-19", expiryRaw: "19 March 2027" },
    "BKB GEN534 image read: Level 8, issued 20 March 2026, expires 19 March 2027, recognition 10%. Registration on the certificate is 1998/012435/06.",
  );
}

async function reviewTechnical(name: string, registrationNormalized: string, reason: string) {
  const entity = await db.query<{ id: string }>(
    `select id from entities
     where registration_number_normalized = $1 and merged_into_id is null
     limit 1`,
    [registrationNormalized],
  );
  await ensureReviewItem(db, {
    type: "source_problem",
    reason,
    severity: "high",
    entityId: entity[0]?.id ?? null,
    payload: { company: name, kind: "technical_retrieval" },
  });
}

async function attemptJseRev15() {
  const key = "jse-rev15-once";
  const prior = await db.query<{ status: string }>("select status from major_gap_imports where item_key = $1", [key]);
  if (prior[0]) {
    console.log(`[major-gap] skip ${key} (${prior[0].status})`);
    return;
  }
  const page = await safeFetch(JSE_INDEX);
  if (!page.ok) {
    const detail = `JSE dated-document fetch failed: ${page.reason}`;
    await record(key, "technical_review", detail);
    await reviewTechnical("JSE Limited", "200502293906", detail);
    console.log(`[major-gap] ${key} technical_review ${detail}`);
    return;
  }
  const html = new TextDecoder().decode(page.bytes);
  const found = new Set<string>();
  for (const match of html.matchAll(/https?:\/\/[^"'\\\s<>]+/gi)) found.add(match[0].replace(/&/g, "&"));
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      found.add(new URL(match[1], JSE_INDEX).toString());
    } catch {
      /* ignore malformed hrefs */
    }
  }
  const chosen = [...found].find((url) => /jse000215/i.test(url) || (/rev15/i.test(url) && /pdf|certificate|bbbee|b-bbee/i.test(url)));
  if (!chosen || chosen.replace(/\/$/, "") === JSE_INDEX) {
    const detail = "JSE dated-document HTML had no JSE000215 / REV15 certificate file link. Not classified as no evidence.";
    await record(key, "technical_review", detail);
    await reviewTechnical("JSE Limited", "200502293906", detail);
    console.log(`[major-gap] ${key} technical_review`);
    return;
  }
  const result = await importCorpusItem(db, {
    canonicalName: "JSE Limited",
    registrationNumber: "2005/022939/06",
    website: JSE_INDEX,
    jseListed: true,
    sectorIds: ["sec_financial"],
    evidence: [{ url: chosen, evidenceType: "bee_certificate", title: "JSE Limited B-BBEE certificate JSE000215-REV15" }],
  });
  const evidenceNote = result.evidence
    .map((row) => [row.kind, row.published ? "published" : "", row.error].filter(Boolean).join(":"))
    .join(" | ");
  const detail = [chosen, result.error, evidenceNote].filter(Boolean).join(" — ");
  const status = result.published ? "published" : "technical_review";
  if (!result.published) {
    await reviewTechnical("JSE Limited", "200502293906", `JSE REV15 ingestion did not publish. ${detail}`);
  }
  await record(key, status, detail);
  console.log(`[major-gap] ${key} ${status} ${detail}`);
}

await correctKnownRecords();

const cleanup = await db.query<{ status: string }>("select status from major_gap_imports where item_key = $1", [
  CLEANUP_PASS,
]);
if (!cleanup[0]) {
  await db.query("delete from major_gap_imports where item_key = any($1::text[])", [RETRY_KEYS]);
  try {
    const repaired = await reprocessStoredUrls(db, [MEDIA24_URL]);
    console.log(`[major-gap] media24 reprocess ${JSON.stringify(repaired).slice(0, 800)}`);
  } catch (err) {
    console.log(`[major-gap] media24 reprocess error ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    await attemptJseRev15();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await record("jse-rev15-once", "technical_review", message);
    console.log(`[major-gap] jse-rev15-once technical_review ${message}`);
  }
  await record(CLEANUP_PASS, "queued", "One retry queued for Media24, Ninety One, Ford, Rand Water, Senwes, and JSE REV15.");
}

for (const item of MAJOR_GAP_ITEMS) {
  if (Date.now() - started > BUDGET_MS) {
    console.log("[major-gap] time budget reached; remaining items wait for the next deploy.");
    break;
  }
  const prior = await db.query<{ status: string }>("select status from major_gap_imports where item_key = $1", [
    item.key,
  ]);
  if (prior[0] && prior[0].status !== "error") {
    console.log(`[major-gap] skip ${item.key} (${prior[0].status})`);
    continue;
  }
  try {
    const result = await importCorpusItem(db, item.corpus);
    const evidenceNote = result.evidence
      .map((row) => [row.kind, row.published ? "published" : "", row.duplicate ? "duplicate" : "", row.error].filter(Boolean).join(":"))
      .join(" | ");
    let status = result.published ? "published" : result.skipped ? "skipped" : "held";
    if (!result.published && TECHNICAL_KEYS.has(item.key)) status = "technical_review";
    const detail = [result.error, result.skipReason, evidenceNote].filter(Boolean).join(" — ") || status;
    await record(item.key, status, detail);
    console.log(`[major-gap] ${item.key} ${status} ${detail}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const blocked = /\b(403|404|401)\b|ENOTFOUND/i.test(message);
    const status = TECHNICAL_KEYS.has(item.key) ? "technical_review" : blocked ? "blocked" : "error";
    await record(item.key, status, message);
    console.log(`[major-gap] ${item.key} ${status} ${message}`);
  }
}

const PREFIX_NOISE = [
  "YES 2 HOPE AND CARLEE CIVILS",
  "YES 4 KHABO KEDI WASTE MANAGENT",
  "YES 3 PHAMBILI CIVILS (Pty) Ltd",
  "YES 7 LEAFY SPACE (Pty) Ltd",
  "NO 7 MABERT ELECTRICAL SOLUTIONS",
  "NO 14 ALSU ONDERNEMINGS (Pty) Ltd",
];
const prefixHidden = await db.query<{ id: string; canonical_name: string }>(
  `update entities
     set visibility = 'hidden', updated_at = now()
   where merged_into_id is null
     and visibility = 'public'
     and canonical_name = any($1::text[])
   returning id, canonical_name`,
  [PREFIX_NOISE],
);
for (const row of prefixHidden) {
  await db.query(
    `insert into audit_logs
       (id, actor_type, actor_id, action, target_type, target_id, before_state, after_state, reason)
     values ($1, 'import', 'import:scale-batch-1', 'entity.hidden', 'entity', $2,
             '{"visibility":"public"}', '{"visibility":"hidden"}', $3)`,
    [
      newId("aud"),
      row.id,
      "Bidder-register row number was glued onto the supplier name. The supplier remains under the name without that prefix.",
    ],
  );
  console.log(`[major-gap] hid prefixed bidder name ${row.canonical_name}`);
}

const hidden = await db.query<{ id: string; canonical_name: string }>(
  `update entities
     set visibility = 'hidden', updated_at = now()
   where merged_into_id is null
     and visibility = 'public'
     and lower(canonical_name) = any($1::text[])
     and (
       registration_number_normalized is null
       or registration_number_normalized !~ '^[0-9]{12}$'
     )
   returning id, canonical_name`,
  [FOREIGN_MEASURED_ENTITY_NAMES.map((name) => name.toLowerCase())],
);
for (const row of hidden) {
  await db.query(
    `insert into audit_logs
       (id, actor_type, actor_id, action, target_type, target_id, before_state, after_state, reason)
     values ($1, 'import', 'import:major-gap-2026', 'entity.hidden', 'entity', $2,
             '{"visibility":"public"}', '{"visibility":"hidden"}', $3)`,
    [
      newId("aud"),
      row.id,
      "Not a South African B-BBEE measured entity. A JSE listing of a foreign company is not a South African certificate.",
    ],
  );
  console.log(`[major-gap] hid foreign issuer ${row.canonical_name}`);
}

console.log(`[major-gap] done in ${Math.round((Date.now() - started) / 1000)}s`);
