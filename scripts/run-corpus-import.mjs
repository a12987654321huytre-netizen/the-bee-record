#!/usr/bin/env node
/**
 * Posts corpus batches to the live /api/corpus-import endpoint.
 * Token is read from .corpus-import-token (gitignored).
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PROD = process.env.CORPUS_IMPORT_URL ?? "https://the-bee-record.vercel.app";
const tokenPath = resolve(process.cwd(), ".corpus-import-token");
const corpusPath = resolve(process.cwd(), process.argv[2] ?? "data/initial-corpus.json");
const logPath = resolve(process.cwd(), "data/import-log.jsonl");

const token = readFileSync(tokenPath, "utf8").trim();
const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
const items = Array.isArray(corpus) ? corpus : corpus.items;
if (!Array.isArray(items) || !items.length) {
  console.error("No corpus items.");
  process.exit(1);
}

const start = Number(process.env.CORPUS_START ?? 0);
const limit = Number(process.env.CORPUS_LIMIT ?? items.length);
const slice = items.slice(start, start + limit);
const retries = Number(process.env.CORPUS_RETRIES ?? 2);

async function post(path, body, timeoutMs = 90_000) {
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
    json = { raw: text.slice(0, 500) };
  }
  return { status: res.status, json };
}

console.log(`Importing ${slice.length} items to ${PROD} (offset ${start})`);
let ok = 0;
let fail = 0;
for (let i = 0; i < slice.length; i += 1) {
  const batch = [slice[i]];
  const name = batch[0]?.canonicalName;
  const idx = start + i + 1;
  process.stdout.write(`[${idx}/${start + slice.length}] ${name} ... `);
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      last = await post("/api/corpus-import", { items: batch });
      if (last.status === 401) {
        console.log("UNAUTHORIZED");
        process.exit(2);
      }
      if (last.status >= 500 && attempt < retries) {
        console.log(`HTTP ${last.status} retry ${attempt + 1}`);
        await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
        process.stdout.write(`[${idx}/${start + slice.length}] ${name} ... `);
        continue;
      }
      break;
    } catch (err) {
      last = { status: 0, json: { error: err instanceof Error ? err.message : String(err) } };
      if (attempt < retries) {
        console.log(`ERR retry ${attempt + 1}: ${last.json.error}`);
        await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
        process.stdout.write(`[${idx}/${start + slice.length}] ${name} ... `);
        continue;
      }
    }
  }
  const row = last?.json?.results?.[0];
  const record = {
    at: new Date().toISOString(),
    index: idx,
    name,
    status: last?.status,
    created: row?.created ?? false,
    duplicateEntity: row?.duplicateEntity ?? false,
    published: row?.published ?? false,
    evidence: row?.evidence ?? last?.json,
    error: row?.error || (!last?.json?.ok ? last?.json?.error : undefined),
  };
  appendFileSync(logPath, JSON.stringify(record) + "\n");
  if (!last?.json?.ok) {
    fail += 1;
    console.log(`HTTP ${last?.status}`, last?.json?.error ?? last?.json);
    continue;
  }
  ok += 1;
  console.log(
    [
      row?.created ? "created" : row?.duplicateEntity ? "existing" : "ok",
      row?.published ? "published" : "unpublished",
      `ev=${row?.evidence?.length ?? 0}`,
      row?.evidence?.[0]?.published ? "ev-published" : "",
      row?.evidence?.[0]?.duplicate ? "ev-dup" : "",
      row?.evidence?.[0]?.error ? `err=${row.evidence[0].error}` : "",
      row?.error ?? "",
    ]
      .filter(Boolean)
      .join(" "),
  );
}

const stats = await post("/api/corpus-import", null, 30_000);
writeFileSync(resolve(process.cwd(), "data/import-stats.json"), JSON.stringify(stats.json, null, 2));
console.log("STATS", JSON.stringify(stats.json, null, 2));
console.log(`done ok=${ok} fail=${fail}`);
