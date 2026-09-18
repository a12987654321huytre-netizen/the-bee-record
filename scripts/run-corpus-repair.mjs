#!/usr/bin/env node
/**
 * Reprocesses existing production evidence. Does not add companies.
 * Token is read from .corpus-import-token (gitignored).
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PROD = process.env.CORPUS_IMPORT_URL ?? "https://the-bee-record.vercel.app";
const tokenPath = resolve(process.cwd(), ".corpus-import-token");
const logPath = resolve(process.cwd(), "data/repair-log.jsonl");
const token = readFileSync(tokenPath, "utf8").trim();
const extractLimit = Number(process.env.REPAIR_LIMIT ?? 3);
const retries = Number(process.env.REPAIR_RETRIES ?? 3);

async function post(body, timeoutMs = 90_000) {
  const res = await fetch(`${PROD}/api/corpus-import`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
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

console.log(`Repairing existing evidence on ${PROD}`);
const started = await post({ action: "stats" }, 30_000);
console.log("BEFORE", JSON.stringify(started.json?.counts ?? started.json, null, 2));
appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), phase: "before", ...started }) + "\n");

const reset = await post({ action: "repair", phase: "reset" }, 60_000);
console.log("RESET", JSON.stringify({ status: reset.status, runs: reset.json?.runs, claims: reset.json?.claims, garbage: reset.json?.garbageAgencies, remaining: reset.json?.counts?.remainingExtract }));
appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), phase: "reset", ...reset }) + "\n");

let extractLoops = 0;
while (extractLoops < 150) {
  extractLoops += 1;
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      last = await post({ action: "repair", phase: "extract", repairLimit: extractLimit });
      if (last.status === 401) {
        console.log("UNAUTHORIZED");
        process.exit(2);
      }
      if (last.status >= 500 && attempt < retries) {
        console.log(`extract HTTP ${last.status} retry ${attempt + 1}`);
        await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
        continue;
      }
      break;
    } catch (err) {
      last = { status: 0, json: { error: err instanceof Error ? err.message : String(err) } };
      if (attempt < retries) {
        console.log(`extract ERR retry ${attempt + 1}: ${last.json.error}`);
        await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
        continue;
      }
    }
  }
  const remaining = last?.json?.remainingExtract ?? last?.json?.remaining ?? last?.json?.counts?.remainingExtract;
  const processed = last?.json?.processed ?? 0;
  const parsed = Array.isArray(last?.json?.results)
    ? last.json.results.filter((r) => r.parsed).length
    : "?";
  const fetched = Array.isArray(last?.json?.results)
    ? last.json.results.filter((r) => r.fetchFallback).length
    : "?";
  console.log(
    `extract[${extractLoops}] HTTP ${last?.status} processed=${processed} parsed=${parsed} fetch=${fetched} remaining=${remaining} agencies=${last?.json?.counts?.verifiers} expired=${last?.json?.counts?.expired} current=${last?.json?.counts?.current} expirySet=${last?.json?.counts?.expirySet}`,
  );
  appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), phase: "extract", ...last }) + "\n");
  if (!last?.json?.ok) {
    console.log("extract batch failed", last?.json);
    if (processed === 0 && extractLoops > 3) break;
    continue;
  }
  if (!processed || remaining === 0) break;
}

let afterId = null;
let lifeLoops = 0;
while (lifeLoops < 20) {
  lifeLoops += 1;
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      last = await post({ action: "repair", phase: "lifecycle", repairLimit: 8, afterId });
      break;
    } catch (err) {
      last = { status: 0, json: { error: err instanceof Error ? err.message : String(err) } };
      if (attempt < retries) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  afterId = last?.json?.nextAfterId ?? null;
  console.log(
    `lifecycle[${lifeLoops}] HTTP ${last?.status} processed=${last?.json?.processed} updated=${last?.json?.updated} remaining=${last?.json?.remaining} next=${afterId}`,
  );
  appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), phase: "lifecycle", ...last }) + "\n");
  if (!afterId || !last?.json?.processed) break;
}

const finished = await post({ action: "stats" }, 30_000);
writeFileSync(resolve(process.cwd(), "data/repair-stats.json"), JSON.stringify(finished.json, null, 2));
console.log("AFTER", JSON.stringify(finished.json?.counts ?? finished.json, null, 2));
console.log("done");
