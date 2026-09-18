import { MAX_EVIDENCE_BYTES } from "./constants.ts";
import { sha256HexNode } from "./hash.ts";
import { newId } from "./ids.ts";
import type { Sql } from "./db-types.ts";

export async function storeAsset(
  db: Sql,
  input: { bytes: Uint8Array; mimeType: string | null },
): Promise<{ assetId: string; hash: string; byteSize: number; created: boolean }> {
  if (input.bytes.byteLength > MAX_EVIDENCE_BYTES) {
    throw new Error(`Document exceeds the ${MAX_EVIDENCE_BYTES / (1024 * 1024)} MB size limit.`);
  }
  const hash = sha256HexNode(input.bytes);
  const existing = await db.query<{ id: string; byte_size: number }>(
    "select id, byte_size from evidence_assets where content_hash = $1 limit 1",
    [hash],
  );
  if (existing[0]) {
    return { assetId: existing[0].id, hash, byteSize: existing[0].byte_size, created: false };
  }
  const id = newId("ast");
  await db.query(
    `insert into evidence_assets (id, content_hash, mime_type, byte_size, storage_backend, storage_key, content)
     values ($1,$2,$3,$4,'db',$5,$6)`,
    [id, hash, input.mimeType, input.bytes.byteLength, id, input.bytes],
  );
  return { assetId: id, hash, byteSize: input.bytes.byteLength, created: true };
}

export async function readAsset(
  db: Sql,
  assetId: string,
): Promise<{ bytes: Uint8Array; mimeType: string | null; hash: string } | null> {
  const rows = await db.query<{ content: Uint8Array | Buffer | null; mime_type: string | null; content_hash: string }>(
    "select content, mime_type, content_hash from evidence_assets where id = $1",
    [assetId],
  );
  const row = rows[0];
  if (!row || !row.content) return null;
  const bytes = row.content instanceof Uint8Array ? row.content : new Uint8Array(row.content);
  return { bytes, mimeType: row.mime_type, hash: row.content_hash };
}
