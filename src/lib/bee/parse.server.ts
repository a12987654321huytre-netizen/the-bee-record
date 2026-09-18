import { extractText } from "unpdf";
import { sha256HexNode } from "./hash.ts";

export type ParsedDocument = {
  text: string;
  pages: number | null;
  kind: "html" | "text" | "pdf" | "unknown";
  normalizedHash: string;
};

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&/gi, "&")
    .replace(/"/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/</gi, "<")
    .replace(/>/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractLinks(html: string, baseUrl: string): string[] {
  const links = new Set<string>();
  const re = /<a\s[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      links.add(new URL(m[1]!, baseUrl).toString());
    } catch {
      /* ignore */
    }
  }
  return [...links];
}

export function extractAnchorHints(html: string, baseUrl: string): Array<{ url: string; text: string }> {
  const out: Array<{ url: string; text: string }> = [];
  const re = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const url = new URL(m[1]!, baseUrl).toString();
      const text = m[2]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      out.push({ url, text });
    } catch {
      /* ignore */
    }
  }
  return out;
}

function looksLikePdf(bytes: Uint8Array, mime: string, name: string): boolean {
  if (mime.includes("pdf") || /\.pdf(\b|$)/i.test(name)) return true;
  return bytes.byteLength >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

export async function parseDocument(
  bytes: Uint8Array,
  mimeType: string | null,
  filename?: string | null,
): Promise<ParsedDocument> {
  const mime = (mimeType ?? "").toLowerCase();
  const name = (filename ?? "").toLowerCase();
  if (looksLikePdf(bytes, mime, name)) {
    try {
      const result = await extractText(bytes, { mergePages: true });
      const rawText = result.text as string | string[] | undefined;
      const text = Array.isArray(rawText) ? rawText.join("\n\n") : String(rawText ?? "");
      return {
        text: text.trim(),
        pages: result.totalPages,
        kind: "pdf",
        normalizedHash: sha256HexNode(text.replace(/\s+/g, " ").trim().toLowerCase()),
      };
    } catch {
      return {
        text: "",
        pages: null,
        kind: "pdf",
        normalizedHash: sha256HexNode(""),
      };
    }
  }
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (mime.includes("html") || /<html|<body|<div/i.test(decoded.slice(0, 2000))) {
    const text = stripHtml(decoded);
    return {
      text,
      pages: null,
      kind: "html",
      normalizedHash: sha256HexNode(text.toLowerCase()),
    };
  }
  const text = decoded.replace(/\s+/g, " ").trim();
  return {
    text,
    pages: null,
    kind: "text",
    normalizedHash: sha256HexNode(text.toLowerCase()),
  };
}
