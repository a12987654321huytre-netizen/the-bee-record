#!/usr/bin/env node
/**
 * Posts procurement-disclosure corpus batches to live /api/corpus-import.
 * Token is read from .corpus-import-token (gitignored).
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PROD = process.env.CORPUS_IMPORT_URL ?? "https://the-bee-record.vercel.app";
const tokenPath = resolve(process.cwd(), ".corpus-import-token");
const corpusPath = resolve(process.cwd(), process.argv[2] ?? "data/procurement/corpus-new.json");
const logPath = resolve(process.cwd(), process.env.CORPUS_LOG ?? "data/procurement-import-log.jsonl");

const token = readFileSync(tokenPath, "utf8").trim();
const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
const items = Array.isArray(corpus) ? corpus : corpus.items;
if (!Array.isArray(items) || !items.length) {
  console.error("No corpus items.");
  process.exit(1);
}

const start = Number(process.env.CORPUS_START ?? 0);
const limit = Number(process.env.CORPUS_LIMIT ?? items.length);
const batchSize = Math.min(25, Math.max(1, Number(process.env.CORPUS_BATCH ?? 8)));
const slice = items.slice(start, start + limit);
const retries = Number(process.env.CORPUS_RETRIES ?? 2);

async function post(path, body, timeoutMs = 120_000) {
  const res = await fetch(`${PROD}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 800) };
  }
  return { status: res.status, json };
}

console.log(`Importing ${slice.length} items to ${PROD} (offset ${start}, batch ${batchSize})`);
let ok = 0;
let fail = 0;
let created = 0;
let published = 0;
let skipped = 0;

for (let i = 0; i < slice.length; i += batchSize) {
  const batch = slice.slice(i, i + batchSize).map((item) => ({
    canonicalName: item.canonicalName,
    legalName: item.legalName ?? item.canonicalName,
    aliases: item.aliases,
    procurement: (item.procurement ?? []).slice(0, 8),
    publishIfSafe: item.publishIfSafe !== false,
  }));
  const idx = start + i + 1;
  const end = start + Math.min(i + batch.length, slice.length);
  process.stdout.write(`[${idx}-${end}/${start + slice.length}] ${batch[0]?.canonicalName} … `);
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      last = await post("/api/corpus-import", { items: batch });
      if (last.status === 401) {
        console.log("UNAUTHORIZED");
        process.exit(2);
      }
      if (last.status === 400 && /unrecognized_keys|procurement/i.test(JSON.stringify(last.json ?? {}))) {
        console.log("SCHEMA", last.json?.error ?? last.json);
        process.exit(3);
      }
      if ((last.status >= 500 || last.status === 0) && attempt < retries) {
        console.log(`HTTP ${last.status} retry ${attempt + 1}`);
        await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
        process.stdout.write(`[${idx}-${end}/${start + slice.length}] retry … `);
        continue;
      }
      break;
    } catch (err) {
      last = { status: 0, json: { error: err instanceof Error ? err.message : String(err) } };
      if (attempt < retries) {
        console.log(`ERR retry ${attempt + 1}: ${last.json.error}`);
        await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
        process.stdout.write(`[${idx}-${end}/${start + slice.length}] retry … `);
        continue;
      }
    }
  }
  const record = {
    at: new Date().toISOString(),
    index: idx,
    end,
    names: batch.map((b) => b.canonicalName),
    status: last?.status,
    results: last?.json?.results ?? null,
    error: !last?.json?.ok ? last?.json?.error ?? last?.json : undefined,
  };
  appendFileSync(logPath, JSON.stringify(record) + "\n");
  if (!last?.json?.ok) {
    fail += batch.length;
    console.log(`HTTP ${last?.status}`, last?.json?.error ?? last?.json);
    continue;
  }
  const results = last.json.results ?? [];
  for (const row of results) {
    ok += 1;
    if (row.created) created += 1;
    if (row.published) published += 1;
    if (row.skipped) skipped += 1;
  }
  const sample = results[0];
  console.log(
    [
      `n=${results.length}`,
      `created=${results.filter((r) => r.created).length}`,
      `pub=${results.filter((r) => r.published).length}`,
      `skip=${results.filter((r) => r.skipped).length}`,
      sample?.error ? `err=${sample.error}` : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
}

const stats = await post("/api/corpus-import", { action: "stats" }, 30_000);
writeFileSync(resolve(process.cwd(), "data/import-stats.json"), JSON.stringify(stats.json, null, 2));
console.log("STATS", JSON.stringify(stats.json, null, 2));
console.log(`done ok=${ok} fail=${fail} created=${created} published=${published} skipped=${skipped}`);
