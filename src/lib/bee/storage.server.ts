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

export function coerceBytes(content: unknown): Uint8Array | null {
  if (content == null) return null;
  if (content instanceof Uint8Array) {
    return content.byteLength ? content : null;
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(content)) {
    return content.byteLength ? new Uint8Array(content.buffer, content.byteOffset, content.byteLength) : null;
  }
  if (typeof content === "string") {
    const hex = content.startsWith("\\x") ? content.slice(2) : content.startsWith("0x") ? content.slice(2) : content;
    if (hex.length >= 8 && hex.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(hex)) {
      return Uint8Array.from(Buffer.from(hex, "hex"));
    }
    const encoded = new TextEncoder().encode(content);
    return encoded.byteLength ? encoded : null;
  }
  if (typeof content === "object") {
    const rec = content as { type?: string; data?: unknown; bytes?: unknown };
    if (Array.isArray(rec.data)) return Uint8Array.from(rec.data as number[]);
    if (ArrayBuffer.isView(content)) {
      const view = content as ArrayBufferView;
      return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    }
  }
  return null;
}

export async function readAsset(
  db: Sql,
  assetId: string,
): Promise<{ bytes: Uint8Array; mimeType: string | null; hash: string } | null> {
  const rows = await db.query<{ content: unknown; mime_type: string | null; content_hash: string; byte_size: number | null }>(
    "select content, mime_type, content_hash, byte_size from evidence_assets where id = $1",
    [assetId],
  );
  const row = rows[0];
  if (!row) return null;
  const bytes = coerceBytes(row.content);
  if (!bytes?.byteLength) return null;
  return { bytes, mimeType: row.mime_type, hash: row.content_hash };
}
