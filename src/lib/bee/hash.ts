import { createHash } from "node:crypto";
import { hashToHex } from "./normalize.ts";

export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  if (typeof data === "string") {
    const encoded = new TextEncoder().encode(data);
    const digest = await crypto.subtle.digest("SHA-256", encoded);
    return hashToHex(digest);
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    data instanceof Uint8Array
      ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
      : data,
  );
  return hashToHex(digest);
}

export function sha256HexNode(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function ipHash(ip: string | null | undefined, salt = "bee-record"): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}
