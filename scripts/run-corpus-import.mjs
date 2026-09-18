#!/usr/bin/env node
/**
 * Posts corpus batches to the live /api/corpus-import endpoint.
 * Token is read from .corpus-import-token (gitignored).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROD = process.env.CORPUS_IMPORT_URL ?? "https://the-bee-record.vercel.app";
const tokenPath = resolve(process.cwd(), ".corpus-import-token");
const corpusPath = resolve(process.cwd(), process.argv[2] ?? "data/initial-corpus.json");

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
const batchSize = 1;

async function post(path, body) {
  const res = await fetch(`${PROD}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

console.log(`Importing ${slice.length} items to ${PROD} (offset ${start})`);
let ok = 0;
let fail = 0;
for (let i = 0; i < slice.length; i += batchSize) {
  const batch = slice.slice(i, i + batchSize);
  const name = batch[0]?.canonicalName;
  process.stdout.write(`[${start + i + 1}/${start + slice.length}] ${name} ... `);
  try {
    const out = await post("/api/corpus-import", { items: batch });
    if (out.status === 401) {
      console.log("UNAUTHORIZED — deploy may not include import route yet, or token mismatch.");
      process.exit(2);
    }
    if (!out.json?.ok) {
      fail += 1;
      console.log(`HTTP ${out.status}`, out.json?.error ?? out.json);
      continue;
    }
    const row = out.json.results?.[0];
    ok += 1;
    console.log(
      [
        row?.created ? "created" : row?.duplicateEntity ? "existing" : "ok",
        row?.published ? "published" : "unpublished",
        `ev=${row?.evidence?.length ?? 0}`,
        row?.evidence?.[0]?.error ? `err=${row.evidence[0].error}` : "",
        row?.error ?? "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  } catch (err) {
    fail += 1;
    console.log("ERROR", err instanceof Error ? err.message : err);
  }
}

const stats = await post("/api/corpus-import");
console.log("STATS", JSON.stringify(stats.json, null, 2));
console.log(`done ok=${ok} fail=${fail}`);
