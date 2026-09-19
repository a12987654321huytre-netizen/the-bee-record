import { audit } from "./audit.server.ts";
import { looksLikeEvidence, inferEvidenceTypeFromUrl } from "./deterministic-extract.ts";
import { safeFetch } from "./fetch.server.ts";
import { sha256HexNode } from "./hash.ts";
import { newId } from "./ids.ts";
import { extractDomain, normalizeUrl } from "./normalize.ts";
import { extractAnchorHints } from "./parse.server.ts";
import { ingestDocument } from "./pipeline.server.ts";
import { jsonParse, type Sql } from "./db-types.ts";
import { checkFetchUrl } from "./ssrf.ts";

export type CrawlConfig = {
  allowedPathPrefixes: string[];
  maxDepth: number;
  allowedFileTypes: string[];
  urlPatterns: string[];
  exclusionPatterns: string[];
  maxLinks: number;
};

const DEFAULT_CONFIG: CrawlConfig = {
  allowedPathPrefixes: [],
  maxDepth: 1,
  allowedFileTypes: [".pdf", ".html", ".htm"],
  urlPatterns: [],
  exclusionPatterns: [],
  maxLinks: 40,
};

function nextCheckAt(frequency: string, from = new Date()): Date | null {
  const d = new Date(from);
  if (frequency === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (frequency === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (frequency === "monthly") d.setUTCDate(d.getUTCDate() + 30);
  else return null;
  return d;
}

function backoffUntil(consecutive: number): Date {
  const hours = consecutive <= 1 ? 1 : consecutive === 2 ? 4 : consecutive === 3 ? 12 : 24;
  return new Date(Date.now() + hours * 3600_000);
}

export async function jobEvent(
  db: Sql,
  jobId: string,
  level: "debug" | "info" | "warn" | "error",
  message: string,
  meta?: unknown,
) {
  await db.query(
    "insert into crawler_job_events (id, job_id, level, message, meta) values ($1,$2,$3,$4,$5)",
    [newId("evt"), jobId, level, message, meta ? JSON.stringify(meta) : null],
  );
}

function allowedUrl(url: string, sourceUrl: string, config: CrawlConfig): boolean {
  let parsed: URL;
  let source: URL;
  try {
    parsed = new URL(url);
    source = new URL(sourceUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.hostname.replace(/^www\./, "") !== source.hostname.replace(/^www\./, "")) return false;
  if (config.allowedPathPrefixes.length) {
    if (!config.allowedPathPrefixes.some((p) => parsed.pathname.startsWith(p))) return false;
  }
  if (config.exclusionPatterns.some((p) => url.includes(p))) return false;
  if (config.urlPatterns.length && !config.urlPatterns.some((p) => url.includes(p))) {
    const looks = looksLikeEvidence({ url }) > 0;
    if (!looks) return false;
  }
  return true;
}

export async function createSource(
  db: Sql,
  input: {
    url: string;
    entityId?: string | null;
    sourceType?: string;
    frequency?: string;
    crawlConfig?: Partial<CrawlConfig> | null;
    actorId: string;
  },
) {
  const checked = checkFetchUrl(input.url);
  if (!checked.ok) throw new Error(checked.reason);
  const canonical = normalizeUrl(checked.url.toString());
  const existing = await db.query<{ id: string }>(
    "select id from monitored_sources where canonical_url = $1 limit 1",
    [canonical],
  );
  if (existing[0]) return existing[0].id;
  const id = newId("src");
  const freq = input.frequency ?? "weekly";
  await db.query(
    `insert into monitored_sources
      (id, entity_id, url, canonical_url, domain, source_type, crawl_frequency, crawl_config, next_check_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      input.entityId ?? null,
      checked.url.toString(),
      canonical,
      extractDomain(checked.url.toString()),
      input.sourceType ?? "other",
      freq,
      JSON.stringify({ ...DEFAULT_CONFIG, ...(input.crawlConfig ?? {}) }),
      freq === "manual" ? null : new Date().toISOString(),
    ],
  );
  await audit(db, {
    actorType: "admin",
    actorId: input.actorId,
    action: "source.created",
    targetType: "source",
    targetId: id,
    after: { url: checked.url.toString() },
  });
  return id;
}

export async function setSourceEnabled(db: Sql, sourceId: string, enabled: boolean, actorId: string) {
  await db.query("update monitored_sources set enabled = $2, updated_at = now() where id = $1", [
    sourceId,
    enabled ? 1 : 0,
  ]);
  await audit(db, {
    actorType: "admin",
    actorId,
    action: enabled ? "source.enabled" : "source.disabled",
    targetType: "source",
    targetId: sourceId,
  });
}

export async function runSourceCheck(
  db: Sql,
  sourceId: string,
  actor: { type: string; id: string },
): Promise<{ jobId: string; ok: boolean }> {
  const sources = await db.query<{
    id: string;
    url: string;
    entity_id: string | null;
    crawl_config: string | null;
    crawl_frequency: string;
    latest_etag: string | null;
    latest_last_modified: string | null;
    latest_content_hash: string | null;
    consecutive_error_count: number;
    enabled: number;
  }>("select * from monitored_sources where id = $1", [sourceId]);
  const source = sources[0];
  if (!source) throw new Error("Source not found.");
  const jobId = newId("job");
  await db.query(
    `insert into crawler_jobs (id, type, source_id, state, started_at, created_by)
     values ($1,'source_check',$2,'running',now(),$3)`,
    [jobId, sourceId, actor.id],
  );
  await jobEvent(db, jobId, "info", `Checking ${source.url}`);

  const checkId = newId("chk");
  await db.query(
    "insert into source_checks (id, source_id, job_id, started_at) values ($1,$2,$3,now())",
    [checkId, sourceId, jobId],
  );

  const fetched = await safeFetch(source.url, {
    etag: source.latest_etag,
    lastModified: source.latest_last_modified,
  });

  if (!fetched.ok) {
    const consecutive = source.consecutive_error_count + 1;
    await db.query(
      `update monitored_sources set
          last_checked_at = now(), latest_http_status = $2, last_error = $3,
          error_count = error_count + 1, consecutive_error_count = $4,
          backoff_until = $5, updated_at = now()
       where id = $1`,
      [sourceId, fetched.status, fetched.reason, consecutive, backoffUntil(consecutive).toISOString()],
    );
    await db.query(
      `update source_checks set completed_at = now(), http_status = $2, failure_reason = $3, retry_decision = 'backoff'
       where id = $1`,
      [checkId, fetched.status, fetched.reason],
    );
    await db.query(
      `update crawler_jobs set state = 'failed', error = $2, finished_at = now() where id = $1`,
      [jobId, fetched.reason],
    );
    await jobEvent(db, jobId, "error", fetched.reason, { status: fetched.status });

    if (fetched.status === 404) {
      await db.query(
        `update evidence set source_live_status = 'missing', original_source_status = 'missing', updated_at = now()
         where source_url = $1 or canonical_url = $1`,
        [source.url],
      );
      await jobEvent(db, jobId, "warn", "Original source returned 404. Historical evidence was preserved.");
    }
    return { jobId, ok: false };
  }

  if (fetched.status === 304) {
    await db.query(
      `update monitored_sources set
          last_checked_at = now(), last_success_at = now(), latest_http_status = 304,
          consecutive_error_count = 0, last_error = null, backoff_until = null,
          next_check_at = $2, updated_at = now()
       where id = $1`,
      [sourceId, nextCheckAt(source.crawl_frequency)?.toISOString() ?? null],
    );
    await db.query(
      `update source_checks set completed_at = now(), http_status = 304, changed = 0 where id = $1`,
      [checkId],
    );
    await db.query(`update crawler_jobs set state = 'succeeded', finished_at = now() where id = $1`, [jobId]);
    await jobEvent(db, jobId, "info", "Not modified (HTTP 304).");
    return { jobId, ok: true };
  }

  const hash = fetched.hash || sha256HexNode(fetched.bytes);
  const changed = hash !== source.latest_content_hash;
  const config: CrawlConfig = { ...DEFAULT_CONFIG, ...jsonParse<Partial<CrawlConfig>>(source.crawl_config, {}) };
  let linksDiscovered = 0;
  let documentsDiscovered = 0;
  const mime = fetched.mimeType ?? "";

  const candidates: Array<{ url: string; title?: string }> = [];
  if (mime.includes("pdf") || source.url.toLowerCase().includes(".pdf")) {
    candidates.push({ url: fetched.finalUrl, title: source.url });
  } else {
    const html = new TextDecoder("utf-8", { fatal: false }).decode(fetched.bytes);
    const anchors = extractAnchorHints(html, fetched.finalUrl);
    linksDiscovered = anchors.length;
    for (const a of anchors.slice(0, config.maxLinks)) {
      if (!allowedUrl(a.url, source.url, config)) continue;
      const score = looksLikeEvidence({ url: a.url, text: a.text, mime });
      if (score >= 2 || /\.pdf($|\?)/i.test(a.url)) {
        candidates.push({ url: a.url, title: a.text || a.url });
      }
    }
    if (looksLikeEvidence({ url: source.url, text: html }) >= 3) {
      candidates.push({ url: fetched.finalUrl, title: "Source page" });
    }
  }

  for (const candidate of candidates) {
    documentsDiscovered += 1;
    await jobEvent(db, jobId, "info", `Retrieving candidate ${candidate.url}`);
    try {
      const result = await ingestDocument(db, {
        url: candidate.url,
        title: candidate.title,
        entityId: source.entity_id,
        actorType: actor.type,
        actorId: actor.id,
        jobId,
        sourceId,
        evidenceType: inferEvidenceTypeFromUrl(candidate.url, candidate.title),
      });
      if (result.duplicate) {
        await jobEvent(db, jobId, "info", `Duplicate document at ${candidate.url}`, { evidenceId: result.evidenceId });
      } else {
        await db.query(
          "update crawler_jobs set retrieved_documents = retrieved_documents + 1, discovered_items = discovered_items + 1 where id = $1",
          [jobId],
        );
        if (changed) {
          await db.query("update crawler_jobs set changed_items = changed_items + 1 where id = $1", [jobId]);
        }
      }
    } catch (err) {
      await jobEvent(db, jobId, "error", err instanceof Error ? err.message : "Retrieval failed", {
        url: candidate.url,
      });
    }
  }

  await db.query(
    `update monitored_sources set
        last_checked_at = now(), last_success_at = now(),
        last_changed_at = case when $2 then now() else last_changed_at end,
        latest_http_status = $3, latest_content_hash = $4, latest_etag = $5, latest_last_modified = $6,
        discovered_links_count = $7, consecutive_error_count = 0, last_error = null, backoff_until = null,
        next_check_at = $8, updated_at = now()
     where id = $1`,
    [
      sourceId,
      changed,
      fetched.status,
      hash,
      fetched.etag,
      fetched.lastModified,
      linksDiscovered,
      nextCheckAt(source.crawl_frequency)?.toISOString() ?? null,
    ],
  );
  await db.query(
    `update source_checks set
        completed_at = now(), http_status = $2, redirect_target = $3, response_type = $4,
        content_hash = $5, changed = $6, links_discovered = $7, documents_discovered = $8
     where id = $1`,
    [
      checkId,
      fetched.status,
      fetched.redirected ? fetched.finalUrl : null,
      fetched.mimeType,
      hash,
      changed ? 1 : 0,
      linksDiscovered,
      documentsDiscovered,
    ],
  );
  await db.query(`update crawler_jobs set state = 'succeeded', finished_at = now() where id = $1`, [jobId]);
  await jobEvent(db, jobId, "info", `Check complete. ${documentsDiscovered} candidate document(s).`);
  return { jobId, ok: true };
}

export async function runDueSources(db: Sql, limit = 5): Promise<string[]> {
  const due = await db.query<{ id: string }>(
    `select id from monitored_sources
     where enabled = 1
       and (backoff_until is null or backoff_until <= now())
       and (next_check_at is null or next_check_at <= now())
       and crawl_frequency <> 'manual'
     order by next_check_at nulls first
     limit $1`,
    [limit],
  );
  const jobs: string[] = [];
  for (const row of due) {
    const result = await runSourceCheck(db, row.id, { type: "system", id: "scheduler" });
    jobs.push(result.jobId);
  }
  return jobs;
}
