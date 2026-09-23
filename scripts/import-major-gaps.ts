/**
 * Runs on Vercel during `npm run build`, after migrations, where DATABASE_URL exists.
 * Local preview builds skip it. Each item is recorded so a later deploy does not
 * re-fetch documents that already published.
 */
import { importCorpusItem } from "../src/lib/bee/corpus-import.server.ts";
import { FOREIGN_MEASURED_ENTITY_NAMES, MAJOR_GAP_ITEMS } from "../src/lib/bee/major-gap-packet.ts";
import { newId } from "../src/lib/bee/ids.ts";
import { sql } from "../src/lib/bee/sql.server.ts";

const BUDGET_MS = 12 * 60 * 1000;

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
    const status = result.published ? "published" : result.skipped ? "skipped" : "held";
    const detail = [result.error, result.skipReason, evidenceNote].filter(Boolean).join(" — ") || status;
    await record(item.key, status, detail);
    console.log(`[major-gap] ${item.key} ${status} ${detail}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const blocked = /\b(403|404|401)\b|ENOTFOUND/i.test(message);
    await record(item.key, blocked ? "blocked" : "error", message);
    console.log(`[major-gap] ${item.key} ${blocked ? "blocked" : "error"} ${message}`);
  }
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
