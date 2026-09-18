const COMPANY_NOISE =
  /\b(pty|ltd|limited|inc|incorporated|proprietary|co|company|holdings|group|the)\b/g;

export function fold(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function stripPunctuation(value: string): string {
  return value.replace(/[^\p{L}\p{N}]+/gu, " ");
}

export function normalizeName(value: string): string {
  return collapseWhitespace(
    stripPunctuation(fold(value).replace(/&/g, " and ")).replace(COMPANY_NOISE, " "),
  );
}

export function normalizeAlias(value: string): string {
  return collapseWhitespace(stripPunctuation(fold(value)));
}

export function normalizeRegistration(value: string): string {
  return fold(value).replace(/[^a-z0-9]/g, "");
}

export function slugify(value: string): string {
  const base = collapseWhitespace(stripPunctuation(fold(value))).replace(/ /g, "-");
  return (base || "entity").slice(0, 80);
}

export function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function normalizeUrl(url: string): string {
  const u = new URL(url);
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) {
    u.port = "";
  }
  let path = u.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  u.pathname = path;
  return u.toString();
}

export function hostWithoutWww(hostname: string): string {
  return hostname.replace(/^www\./i, "").toLowerCase();
}

export function isOfficialDomain(sourceDomain: string | null, entityWebsite: string | null): boolean {
  if (!sourceDomain || !entityWebsite) return false;
  const entityHost = extractDomain(entityWebsite.startsWith("http") ? entityWebsite : `https://${entityWebsite}`);
  if (!entityHost) return false;
  const a = hostWithoutWww(sourceDomain);
  const b = hostWithoutWww(entityHost);
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

export function hashToHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  for (let i = 0; i < view.length; i += 1) out += view[i]!.toString(16).padStart(2, "0");
  return out;
}

export function sha256HexSyncPlaceholder(): never {
  throw new Error("Use sha256Hex from hash.ts");
}
