import { lookup } from "node:dns/promises";
import { DEFAULT_CRAWLER_UA, FETCH_TIMEOUT_MS, MAX_EVIDENCE_BYTES, MAX_REDIRECTS } from "./constants.ts";
import { sha256HexNode } from "./hash.ts";
import { checkFetchUrl, isBlockedResolvedAddress } from "./ssrf.ts";

const ACCEPT =
  "application/pdf,text/html,text/plain,application/xhtml+xml,image/png,image/jpeg,application/json,*/*;q=0.1";

export type FetchResult =
  | {
      ok: true;
      finalUrl: string;
      status: number;
      mimeType: string | null;
      bytes: Uint8Array;
      hash: string;
      etag: string | null;
      lastModified: string | null;
      redirected: boolean;
    }
  | { ok: false; status: number | null; reason: string; finalUrl?: string };

async function assertResolved(hostname: string) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")) {
    if (isBlockedResolvedAddress(hostname)) throw new Error("Private network addresses are not allowed.");
    return;
  }
  try {
    const results = await lookup(hostname, { all: true });
    for (const r of results) {
      if (isBlockedResolvedAddress(r.address)) throw new Error("Private network addresses are not allowed.");
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("Private")) throw err;
    throw new Error("Could not resolve that hostname.");
  }
}

export async function safeFetch(
  rawUrl: string,
  opts?: { method?: "GET" | "HEAD"; userAgent?: string; etag?: string | null; lastModified?: string | null },
): Promise<FetchResult> {
  let current = rawUrl;
  let redirected = false;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const checked = checkFetchUrl(current);
    if (!checked.ok) return { ok: false, status: null, reason: checked.reason };
    try {
      await assertResolved(checked.url.hostname);
    } catch (err) {
      return { ok: false, status: null, reason: err instanceof Error ? err.message : "Blocked URL." };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {
        "user-agent": opts?.userAgent ?? DEFAULT_CRAWLER_UA,
        accept: ACCEPT,
      };
      if (opts?.etag) headers["if-none-match"] = opts.etag;
      if (opts?.lastModified) headers["if-modified-since"] = opts.lastModified;
      const res = await fetch(checked.url, {
        method: opts?.method ?? "GET",
        redirect: "manual",
        signal: controller.signal,
        headers,
      });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get("location");
        if (!loc) return { ok: false, status: res.status, reason: "Redirect missing Location header." };
        redirected = true;
        current = new URL(loc, checked.url).toString();
        continue;
      }
      if (res.status === 304) {
        return {
          ok: true,
          finalUrl: checked.url.toString(),
          status: 304,
          mimeType: res.headers.get("content-type"),
          bytes: new Uint8Array(),
          hash: "",
          etag: res.headers.get("etag"),
          lastModified: res.headers.get("last-modified"),
          redirected,
        };
      }
      if (!res.ok) {
        return { ok: false, status: res.status, reason: `HTTP ${res.status}`, finalUrl: checked.url.toString() };
      }
      const length = Number(res.headers.get("content-length") ?? "0");
      if (length > MAX_EVIDENCE_BYTES) {
        return { ok: false, status: res.status, reason: "Response is larger than the allowed size." };
      }
      const mimeType = (res.headers.get("content-type") ?? "").split(";")[0]?.trim() || null;
      if (opts?.method === "HEAD") {
        return {
          ok: true,
          finalUrl: checked.url.toString(),
          status: res.status,
          mimeType,
          bytes: new Uint8Array(),
          hash: "",
          etag: res.headers.get("etag"),
          lastModified: res.headers.get("last-modified"),
          redirected,
        };
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > MAX_EVIDENCE_BYTES) {
        return { ok: false, status: res.status, reason: "Response is larger than the allowed size." };
      }
      return {
        ok: true,
        finalUrl: checked.url.toString(),
        status: res.status,
        mimeType,
        bytes: buf,
        hash: sha256HexNode(buf),
        etag: res.headers.get("etag"),
        lastModified: res.headers.get("last-modified"),
        redirected,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Fetch failed.";
      if (message.toLowerCase().includes("abort")) {
        return { ok: false, status: null, reason: "The source timed out." };
      }
      return { ok: false, status: null, reason: message };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, status: null, reason: "Too many redirects." };
}
