import { BEE_FIELDS, type BeeField } from "./constants.ts";
import { collapseWhitespace, normalizeName } from "./normalize.ts";

const FIELD_ALIASES: Record<string, BeeField> = {
  bbbee_level: "bee_level",
  b_bbee_level: "bee_level",
  bbb_ee_level: "bee_level",
  "b-bbee-level": "bee_level",
  "b-bbee_level": "bee_level",
  beelevel: "bee_level",
  status_level: "bee_level",
  recognition: "recognition_level",
  recognition_percentage: "recognition_level",
  procurement_recognition: "recognition_level",
  scorecard: "scorecard_type",
  scorecard_applied: "scorecard_type",
  sector_code: "scorecard_type",
  sector: "scorecard_type",
  verifier: "verification_agency",
  verification_agency_name: "verification_agency",
  rating_agency: "verification_agency",
  agency: "verification_agency",
  technical_signatory: "signatory",
  signed_by: "signatory",
  cert_number: "certificate_number",
  certificate_no: "certificate_number",
  certificate_ref: "certificate_number",
  reference_number: "certificate_number",
  unique_ref_no: "certificate_number",
  company_registration: "registration_number",
  registration: "registration_number",
  enterprise_number: "registration_number",
  entity_name: "legal_entity_name",
  company_name: "legal_entity_name",
  name_of_measured_entity: "measured_entity",
  enterprise_name: "measured_entity",
  date_of_issue: "issue_date",
  date_issued: "issue_date",
  valid_until: "expiry_date",
  date_of_expiry: "expiry_date",
  certificate_expiry_date: "expiry_date",
};

const CERTIFICATE_PROSE =
  /measured against|codes of good practice|broad[-\s]*based black|this certificate|independent and impartial|verification of the bbb?ee status|has been issued|has been determined|gazette|scorecard|procurement recognition|empowering supplier|management of the measured entity|and is an|contributor status|discounting principle|verification certificate policy|for enquiries|amended codes|generic codes gazetted|participated in y\.?e\.?s|black designated groups|black military veterans/i;

const NAME_STARTERS =
  /^(measured|issued|verified|this|a consolidated|broad|codes|the result|independent|according|in terms|valid for|expiry|issue date|level)/i;

const USELESS_LOCATOR = /measured against|codes of good practice|and is an|management of|gazette dated|has been issued in terms/i;

export type LinkedEntityHint = {
  canonicalName?: string | null;
  aliases?: string[];
  registration?: string | null;
};

export function canonicalFieldKey(field: string): BeeField | string {
  const key = field.trim().toLowerCase().replace(/\s+/g, "_");
  if ((BEE_FIELDS as readonly string[]).includes(key)) return key as BeeField;
  return FIELD_ALIASES[key] ?? key;
}

export function isCanonicalBeeField(field: string): field is BeeField {
  return (BEE_FIELDS as readonly string[]).includes(field);
}

export function isPlausibleEntityName(
  raw: string | null | undefined,
  linked?: LinkedEntityHint,
): { ok: boolean; reason: string | null } {
  const name = collapseWhitespace(raw ?? "");
  if (!name) return { ok: false, reason: "empty" };
  if (name.length < 3) return { ok: false, reason: "too short" };
  if (name.length > 100) return { ok: false, reason: "too long" };
  const words = name.split(/\s+/);
  if (words.length > 12) return { ok: false, reason: "prose" };
  if (CERTIFICATE_PROSE.test(name)) return { ok: false, reason: "certificate prose" };
  if (NAME_STARTERS.test(name)) return { ok: false, reason: "sentence fragment" };
  if (/^(the )?(measured entity|legal entity|company name|enterprise name|verification agency)$/i.test(name)) {
    return { ok: false, reason: "heading" };
  }
  if (/[,:;]$/.test(name)) return { ok: false, reason: "truncated" };
  if (!/[A-Za-z]/.test(name)) return { ok: false, reason: "not a name" };
  if (/^(and is an|by the management|of the measured)$/i.test(name)) return { ok: false, reason: "fragment" };

  if (linked?.canonicalName) {
    const n = normalizeName(name);
    const c = normalizeName(linked.canonicalName);
    const aliasHit = (linked.aliases ?? []).some((a) => normalizeName(a) === n);
    if (n && c && !aliasHit && !looksLikeCompanyName(name)) {
      const nTokens = new Set(n.split(" ").filter((t) => t.length > 2));
      const cTokens = new Set(c.split(" ").filter((t) => t.length > 2));
      const overlap = [...nTokens].filter((t) => cTokens.has(t));
      if (nTokens.size && cTokens.size && overlap.length === 0) {
        return { ok: false, reason: "does not match linked entity" };
      }
    }
  }
  return { ok: true, reason: null };
}

export function looksLikeCompanyName(name: string): boolean {
  if (/\b(pty|ltd|limited|inc|incorporated|cc|holdings|group|company|n\.v\.|plc)\b/i.test(name)) return true;
  const words = collapseWhitespace(name).split(/\s+/);
  if (words.length < 2 || words.length > 8) return false;
  return words.every((w) => /^[A-Z0-9]/.test(w) || /^(and|of|the|for|&)$/i.test(w));
}

export function isPlausibleSignatory(raw: string | null | undefined): boolean {
  const name = collapseWhitespace(raw ?? "");
  if (name.length < 4 || name.length > 60) return false;
  if (CERTIFICATE_PROSE.test(name)) return false;
  if (/^(per|as|date|expiry|signatory|technical|yes|no)\b/i.test(name)) return false;
  const words = name.split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  return /^[A-Za-z][A-Za-z .'\-]+$/.test(name);
}

export function isPlausibleCertificateNumber(raw: string | null | undefined): boolean {
  const value = collapseWhitespace(raw ?? "");
  if (value.length < 4 || value.length > 40) return false;
  if (!/\d/.test(value)) return false;
  if (/^(version|final|draft|certificate|number|unique)$/i.test(value)) return false;
  return true;
}

export function publicLocator(snippet: string | null | undefined): string | null {
  const s = collapseWhitespace(snippet ?? "");
  if (!s) return null;
  if (s.length > 72) return null;
  if (USELESS_LOCATOR.test(s)) return null;
  if (/^page\s*\d+/i.test(s)) return s;
  if (CERTIFICATE_PROSE.test(s) && !/^(measured entity|legal entity|b-?bbee status|registration)/i.test(s)) {
    return null;
  }
  return s;
}

export function isPublicClaimValue(
  field: string,
  value: string | null | undefined,
  linked?: LinkedEntityHint,
): boolean {
  const v = collapseWhitespace(value ?? "");
  if (!v) return false;
  const key = canonicalFieldKey(field);
  if (key === "legal_entity_name" || key === "measured_entity" || key === "trading_name") {
    return isPlausibleEntityName(v, linked).ok;
  }
  if (key === "signatory") return isPlausibleSignatory(v);
  if (key === "certificate_number") return isPlausibleCertificateNumber(v);
  if (key === "verification_agency") {
    if (CERTIFICATE_PROSE.test(v)) return false;
    if (/^per\s/i.test(v)) return false;
    if (/certificate|incorporates following/i.test(v) && !/pty|ltd|agency|ratings|verification/i.test(v)) return false;
    return v.length >= 3 && v.length <= 120;
  }
  return true;
}

export const PUBLIC_BBBEE_FIELDS: BeeField[] = [
  "bee_level",
  "recognition_level",
  "measured_entity",
  "legal_entity_name",
  "registration_number",
  "scorecard_type",
  "certificate_number",
];

export const PUBLIC_CORE_FIELDS = new Set<string>([
  "bee_level",
  "recognition_level",
  "measured_entity",
  "legal_entity_name",
  "registration_number",
  "scorecard_type",
  "certificate_number",
  "issue_date",
  "expiry_date",
  "verification_agency",
  "signatory",
  "certificate_type",
  "document_type",
  "trading_name",
]);

export function extraPublicFields(fieldKeys: string[]): string[] {
  const seen = new Set<string>();
  const extra: string[] = [];
  for (const raw of fieldKeys) {
    const key = canonicalFieldKey(raw);
    if (PUBLIC_CORE_FIELDS.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    extra.push(key);
  }
  return extra;
}
