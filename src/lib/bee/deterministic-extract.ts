import { parseDate } from "./dates.ts";
import { normalizeBeeLevel } from "./level.ts";
import { normalizeName, normalizeRegistration } from "./normalize.ts";
import type { ExtractionClaim, ExtractionResult } from "./types.ts";

const ZA_REG = /\b(\d{4}\s*\/\s*\d{6}\s*\/\s*\d{2})\b/;
const LEVEL =
  /b-?bbee[^\n.]{0,40}level\s*(one|two|three|four|five|six|seven|eight|[1-8])|level\s*(one|two|three|four|five|six|seven|eight|[1-8])[^\n.]{0,20}contributor/i;
const RECOGNITION = /recognition\s*(?:level)?[:\s]+(\d{1,3}\s*%?)/i;
const SCORECARD = /scorecard\s*(?:type)?[:\s]+(generic|qse|eme|specialised|specialized)[^\n]{0,20}/i;
const ISSUE = /(?:issued?|issue date|date of issue)[:\s]+([0-9]{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]+\s+\d{4})/i;
const EXPIRY =
  /(?:expir(?:y|es|ation)|valid until|valid to)[:\s]+([0-9]{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]+\s+\d{4})/i;
const AGENCY =
  /(?:verification agency|verified by|b-?bbee verification agency)[:\s]+([A-Za-z0-9][^\n]{2,80})/i;
const SIGNATORY = /(?:technical signatory|signed by|signatory)[:\s]+([A-Za-z][^\n]{2,60})/i;
const MEASURED = /(?:measured entity|name of measured entity)[:\s]+([^\n]{3,120})/i;

function claim(
  field: ExtractionClaim["field"],
  raw: string,
  normalized: string | null,
  locator: string,
  warning: string | null = null,
  confidence = 0.72,
): ExtractionClaim {
  return {
    field,
    raw_value: raw.trim(),
    normalized_value: normalized,
    confidence,
    page: null,
    locator,
    warning,
  };
}

export function extractDeterministically(text: string): ExtractionResult {
  const claims: ExtractionClaim[] = [];
  const warnings: string[] = [];
  const ambiguity: string[] = [];
  if (!text.trim()) {
    return { claims, warnings: ["No extractable text was available."], ambiguity };
  }

  const levelMatch = text.match(LEVEL);
  const levelRaw = levelMatch?.[1] ?? levelMatch?.[2];
  if (levelRaw) {
    const normalized = normalizeBeeLevel(levelRaw);
    claims.push(claim("bee_level", levelMatch![0]!, normalized, levelMatch![0]!));
  }

  const rec = text.match(RECOGNITION);
  if (rec) {
    const pct = rec[1]!.replace(/\s+/g, "");
    claims.push(claim("recognition_level", rec[0], pct.endsWith("%") ? pct : `${pct}%`, rec[0]));
  }

  const score = text.match(SCORECARD);
  if (score) {
    claims.push(claim("scorecard_type", score[0], score[1]!.toLowerCase(), score[0]));
  }

  const issue = text.match(ISSUE);
  if (issue) {
    const parsed = parseDate(issue[1]);
    if (parsed.ambiguous) ambiguity.push(parsed.warning ?? "Ambiguous issue date.");
    claims.push(claim("issue_date", issue[1]!, parsed.iso, issue[0], parsed.warning));
  }

  const expiry = text.match(EXPIRY);
  if (expiry) {
    const parsed = parseDate(expiry[1]);
    if (parsed.ambiguous) ambiguity.push(parsed.warning ?? "Ambiguous expiry date.");
    claims.push(claim("expiry_date", expiry[1]!, parsed.iso, expiry[0], parsed.warning));
  }

  const reg = text.match(ZA_REG);
  if (reg) {
    claims.push(claim("registration_number", reg[1]!, normalizeRegistration(reg[1]!), reg[1]!, null, 0.9));
  }

  const agency = text.match(AGENCY);
  if (agency) {
    const name = agency[1]!.replace(/\s+/g, " ").trim();
    claims.push(claim("verification_agency", name, normalizeName(name), agency[0], null, 0.6));
  }

  const sig = text.match(SIGNATORY);
  if (sig) {
    const name = sig[1]!.replace(/\s+/g, " ").trim();
    claims.push(claim("signatory", name, normalizeName(name), sig[0], null, 0.55));
  }

  const measured = text.match(MEASURED);
  if (measured) {
    const name = measured[1]!.replace(/\s+/g, " ").trim();
    claims.push(claim("measured_entity", name, normalizeName(name), measured[0], null, 0.65));
    claims.push(claim("legal_entity_name", name, normalizeName(name), measured[0], null, 0.65));
  }

  if (/sworn affidavit/i.test(text)) {
    claims.push(claim("certificate_type", "Sworn affidavit", "sworn_affidavit", "sworn affidavit", null, 0.8));
    claims.push(claim("document_type", "Sworn affidavit", "sworn_affidavit", "sworn affidavit", null, 0.8));
  } else if (/b-?bbee certificate|broad-based black economic empowerment certificate/i.test(text)) {
    claims.push(claim("certificate_type", "B-BBEE certificate", "bee_certificate", "certificate", null, 0.8));
    claims.push(claim("document_type", "B-BBEE certificate", "bee_certificate", "certificate", null, 0.8));
  }

  if (!claims.length) warnings.push("Deterministic parser found no structured B-BBEE fields.");
  return { claims, warnings, ambiguity };
}

export const DOCUMENT_HINTS = [
  "bee",
  "b-bbee",
  "bbbee",
  "certificate",
  "affidavit",
  "transformation",
  "annual report",
  "integrated report",
  "supplier",
  "procurement",
  "sustainability",
];

export function looksLikeEvidence(input: { url: string; text?: string; mime?: string }): number {
  const blob = `${input.url} ${input.text ?? ""} ${input.mime ?? ""}`.toLowerCase();
  let score = 0;
  for (const hint of DOCUMENT_HINTS) {
    if (blob.includes(hint)) score += 1;
  }
  if (/\.pdf($|\?)/i.test(input.url) || input.mime === "application/pdf") score += 2;
  return score;
}
