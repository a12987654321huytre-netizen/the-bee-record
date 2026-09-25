import { timingSafeEqual } from "node:crypto";
import { sha256HexNode } from "./hash.ts";

/** SHA-256 of the one-time corpus import bearer. Token is not in git. */
export const CORPUS_IMPORT_TOKEN_SHA256 =
  "9040152a95910e520a9d047410a68eb9e6ddd57a1b0ef9b5b8048e95fd6c432b";

/** Second corpus-import bearer, same scope. Plaintext stays in gitignored .corpus-import-token. */
export const CORPUS_IMPORT_TOKEN_SHA256_BATCH =
  "d85c0f9e775e7f30b17693699926133255362424fba381cb648d576cead652ea";

/** Third corpus-import bearer (sandbox restore). Same scope as the others. */
export const CORPUS_IMPORT_TOKEN_SHA256_SCALE5K =
  "974973bacfc777101716bd1462b5b17ff2c0b3711d4594b11258ca5e265b7f22";

function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== 32 || right.length !== 32) return false;
  return timingSafeEqual(left, right);
}

function configuredImportHashes(): string[] {
  const hashes = [
    CORPUS_IMPORT_TOKEN_SHA256,
    CORPUS_IMPORT_TOKEN_SHA256_BATCH,
    CORPUS_IMPORT_TOKEN_SHA256_SCALE5K,
  ];
  const envSha = process.env.CORPUS_IMPORT_TOKEN_SHA256?.trim().toLowerCase();
  if (envSha && /^[0-9a-f]{64}$/.test(envSha)) hashes.push(envSha);
  const envRaw = process.env.CORPUS_IMPORT_TOKEN?.trim();
  if (envRaw) hashes.push(sha256HexNode(envRaw));
  return hashes;
}

export function authorizeCorpusImport(header: string | null): boolean {
  if (!header?.toLowerCase().startsWith("bearer ")) return false;
  const token = header.slice(7).trim();
  if (!token) return false;
  const cron = process.env.CRON_SECRET?.trim();
  if (cron && token === cron) return true;
  const digest = sha256HexNode(token);
  return configuredImportHashes().some((hash) => hashesEqual(digest, hash));
}
