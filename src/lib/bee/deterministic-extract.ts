import { isVerifierRegistration } from "./enrichment.ts";
import { isPlausibleEntityName, isPlausibleSignatory } from "./claim-quality.ts";
import { addDaysIso, addMonthsIso, daysBetween, parseDate } from "./dates.ts";
import { normalizeBeeLevel } from "./level.ts";
import { normalizeName, normalizeRegistration } from "./normalize.ts";
import type { ExtractionClaim, ExtractionResult } from "./types.ts";

const ZA_REG = /\b(\d{4}\s*\/\s*\d{6}\s*\/\s*\d{2})\b/g;

const DATE_TOKEN =
  /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/\-\s]+[A-Za-z]{3,9}[/\-\s,]+\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}|\d{1,2}[/\-\s]+[A-Za-z]{3,9}[/\-\s]+\d{2}|\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4})\b/g;

const ISSUE_SPECS: Array<{ source: string; priority: number }> = [
  { source: "initial\\s+issue\\s+date", priority: 100 },
  { source: "date\\s+of\\s+issue", priority: 90 },
  { source: "date\\s+issued", priority: 88 },
  { source: "issue\\s+date", priority: 80 },
  { source: "issued\\s+on", priority: 70 },
  { source: "issued\\s+date", priority: 70 },
  { source: "certificate\\s+date", priority: 40 },
];

const EXPIRY_SPECS: Array<{ source: string; priority: number }> = [
  { source: "date\\s+of\\s+expir(?:y|ation)", priority: 90 },
  { source: "expir(?:y|ation)\\s+date", priority: 90 },
  { source: "verification\\s+expir(?:y|ation)\\s+date", priority: 90 },
  { source: "date\\s+expired", priority: 88 },
  { source: "expired\\s+date", priority: 80 },
  { source: "valid\\s+(?:until|to|through|thru)", priority: 60 },
];

const AGENCY_NOISE =
  /\b(sanas\s+accredited|bva\s*\d+|reg(?:istration)?(?:\.|\s*)(?:no\.?|number).{0,20}\d{4}\s*\/\s*\d{6}|per\s+[A-Z]|member\s*[-–]\s*verification)\b/gi;

const AGENCY_NEAR =
  /empowerlogic|aqrate|honeycomb|empowerdex|mpower\s+ratings|siyandisa|msct\s+bee|renaissance\s+sa|verification\s+networx|vos\s+quantum|bdo\s+verification|sng\s+grant|moore\s+stephens|beesure|ncca|mosela|beescore|accountants\s+on\s+site/i;

const KNOWN_AGENCIES: Array<{ name: string; pattern: RegExp; bva?: string }> = [
  { name: "EmpowerLogic (Pty) Ltd", pattern: /empower\s*logic/i, bva: "BVA018" },
  { name: "AQRate (Pty) Ltd", pattern: /\baqrate\b/i },
  { name: "Honeycomb BEE Ratings", pattern: /\bhoneycomb\b/i },
  { name: "Empowerdex (Pty) Ltd", pattern: /empowerdex/i },
  { name: "BDO Verification Services (Pty) Ltd", pattern: /bdo\s+verification\s+services/i },
  { name: "mPower Ratings", pattern: /\bm\s*power\s+ratings\b/i },
  { name: "Siyandisa Solutions", pattern: /siyandisa/i },
  { name: "MSCT BEE Services (Pty) Ltd", pattern: /\bmsct\s+bee\b/i },
  { name: "1st Verification Networx (Pty) Ltd", pattern: /1st\s+verification\s+networx|first\s+verification\s+networx/i },
  { name: "Renaissance SA Ratings", pattern: /renaissance\s+sa\s+ratings/i },
  { name: "VOS Quantum Solutions CC", pattern: /vos\s+quantum|vqs\s+quantum/i },
  { name: "Mosela Rating Agency (Pty) Ltd", pattern: /mosela\s+rating/i },
  { name: "Beescore (Pty) Ltd", pattern: /\bbeescore\b/i },
  { name: "IRBA", pattern: /\birba\b/ },
];

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

type LocatedDate = {
  raw: string;
  iso: string | null;
  warning: string | null;
  ambiguous: boolean;
  index: number;
  end: number;
};

function locateDates(text: string): LocatedDate[] {
  const out: LocatedDate[] = [];
  const re = new RegExp(DATE_TOKEN.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[0]!;
    const parsed = parseDate(raw);
    out.push({
      raw,
      iso: parsed.iso,
      warning: parsed.warning,
      ambiguous: parsed.ambiguous,
      index: m.index,
      end: m.index + raw.length,
    });
  }
  return out;
}

function resolveLocated(d: LocatedDate, assumeDmy: boolean): LocatedDate {
  if (d.iso) return d;
  if (!assumeDmy || !d.ambiguous) return d;
  const parsed = parseDate(d.raw, { assumeDmy: true });
  if (!parsed.iso) return d;
  return { ...d, iso: parsed.iso, warning: parsed.warning, ambiguous: parsed.ambiguous };
}

function nearestDate(
  dates: LocatedDate[],
  index: number,
  direction: "after" | "before" | "either",
  maxDistance = 180,
  assumeDmy = false,
): LocatedDate | null {
  let best: LocatedDate | null = null;
  let bestDist = maxDistance + 1;
  for (const original of dates) {
    const d = resolveLocated(original, assumeDmy);
    if (!d.iso) continue;
    if (direction === "after" && d.index < index) continue;
    if (direction === "before" && d.end > index) continue;
    const dist = direction === "after" ? d.index - index : direction === "before" ? index - d.end : Math.min(Math.abs(d.index - index), Math.abs(index - d.end));
    if (dist >= 0 && dist < bestDist) {
      best = d;
      bestDist = dist;
    }
  }
  return best;
}

function isBoilerplateLabel(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 90), index);
  if (/\bfrom\s+(?:the\s+)?(?:original\s+)?$/i.test(before)) return true;
  if (/\bvalid\s+for\b[\s\S]{0,50}$/i.test(before)) return true;
  if (/\bgazette\b/i.test(before.slice(-50))) return true;
  const lineStart = text.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  const lineEnd = text.indexOf("\n", index);
  const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
  if (/^\s*(?:cor\b|rev(?:ision)?\b)/i.test(line)) return true;
  return false;
}

function bestLabeledDate(
  text: string,
  dates: LocatedDate[],
  specs: Array<{ source: string; priority: number }>,
): { date: LocatedDate; index: number } | null {
  let best: { date: LocatedDate; index: number; priority: number } | null = null;
  for (const spec of specs) {
    const re = new RegExp(spec.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (isBoilerplateLabel(text, m.index)) continue;
      const after = nearestDate(dates, m.index + m[0].length, "after", 120, true);
      const before = nearestDate(dates, m.index, "before", 40, true);
      const date = after ?? before;
      if (!date?.iso) continue;
      if (!best || spec.priority > best.priority) {
        best = { date, index: m.index, priority: spec.priority };
      }
    }
  }
  return best ? { date: best.date, index: best.index } : null;
}

function pairedIssueExpiry(dates: LocatedDate[], text: string): { issue: LocatedDate; expiry: LocatedDate } | null {
  const issueHit = bestLabeledDate(text, dates, ISSUE_SPECS);
  const expiryHit = bestLabeledDate(text, dates, EXPIRY_SPECS);
  if (!issueHit || !expiryHit) return null;
  const start = Math.max(0, Math.min(issueHit.index, expiryHit.index) - 120);
  const end = Math.min(text.length, Math.max(issueHit.index, expiryHit.index) + 220);
  const nearby = dates
    .map((d) => resolveLocated(d, true))
    .filter((d) => d.iso && d.index >= start && d.index <= end);
  if (nearby.length < 2) return null;
  const unique = [...new Map(nearby.map((d) => [d.iso, d])).values()].sort((a, b) => (a.iso! < b.iso! ? -1 : 1));
  if (unique.length < 2) return null;
  for (let i = 0; i < unique.length; i += 1) {
    for (let j = i + 1; j < unique.length; j += 1) {
      const earlier = unique[i]!;
      const later = unique[j]!;
      const gap = daysBetween(earlier.iso!, later.iso!);
      if (gap != null && gap >= 300 && gap <= 400) {
        return { issue: earlier, expiry: later };
      }
    }
  }
  return null;
}

function deriveExpiryFromValidity(text: string, issueIso: string): { iso: string; raw: string; warning: string } | null {
  if (
    !/valid(?:ity)?\s+(?:for\s+)?(?:a\s+)?(?:period\s+of\s+)?(?:12\s+months|one\s+year)/i.test(text) &&
    !/period\s+of\s+validity[:\s]+12\s+months/i.test(text) &&
    !/valid\s+for\s+one\s+year\s+from\s+date\s+of\s+issue/i.test(text)
  ) {
    return null;
  }
  const plusYear = addMonthsIso(issueIso, 12);
  if (!plusYear) return null;
  const iso = addDaysIso(plusYear, -1);
  return {
    iso,
    raw: "Valid for 12 months from date of issue",
    warning: "Derived from stated 12-month validity and issue date; not printed as a calendar expiry.",
  };
}

function extractLevel(text: string): ExtractionClaim | null {
  const patterns = [
    /status\s+level\s+of\s+contributor[:\s]+(?:a\s+)?level\s*(one|two|three|four|five|six|seven|eight|[1-8])/i,
    /b-?bbee\s+status(?:\s+level)?[:\s]+(?:a\s+)?level\s*(one|two|three|four|five|six|seven|eight|[1-8])/i,
    /(?:final\s+)?b-?bbee\s+status[:\s]+(?:a\s+)?level\s*(one|two|three|four|five|six|seven|eight|[1-8])/i,
    /(?:broad[-\s]*based\s+bee\s+status\s+level|contributor\s+status)[:\s]+(?:a\s+)?level\s*(one|two|three|four|five|six|seven|eight|[1-8])/i,
    /(?:rating|status)\s+(?:was\s+)?(?:confirmed\s+)?(?:at|of|is)\s+(?:a\s+)?level\s*(one|two|three|four|five|six|seven|eight|[1-8])/i,
    /(?:achieved|acquired|retained|maintained|awarded)\s+(?:a\s+)?level\s*(one|two|three|four|five|six|seven|eight|[1-8])/i,
    /level\s*(one|two|three|four|five|six|seven|eight|[1-8])[^\n.]{0,24}contributor/i,
    /a\s+level\s*(one|two|three|four|five|six|seven|eight|[1-8])\s+contributor/i,
    /b-?bbee[^\n.]{0,40}level\s*(one|two|three|four|five|six|seven|eight|[1-8])/i,
    /\blevel\s*(one|two|three|four|five|six|seven|eight|[1-8])\s+b-?bbee/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    if (/additional\s+level|yes\s+target/i.test(m[0])) continue;
    const normalized = normalizeBeeLevel(m[1]);
    if (!normalized) continue;
    return claim("bee_level", m[0], normalized, m[0], null, 0.82);
  }
  if (/non[-\s]?compliant\s+contributor/i.test(text)) {
    return claim("bee_level", "Non-Compliant Contributor", "non-compliant", "non-compliant", null, 0.8);
  }
  return null;
}

function lineWindow(text: string, index: number): { line: string; previous: string } {
  const lineStart = text.lastIndexOf("\n", Math.max(0, index - 1));
  const start = lineStart < 0 ? 0 : lineStart + 1;
  const lineEnd = text.indexOf("\n", index);
  const end = lineEnd < 0 ? text.length : lineEnd;
  const prevEnd = start > 0 ? start - 1 : 0;
  const prevStart = prevEnd <= 0 ? 0 : text.lastIndexOf("\n", Math.max(0, prevEnd - 1)) + 1;
  return {
    line: text.slice(start, end),
    previous: text.slice(prevStart, prevEnd),
  };
}

function isAgencyOwnedRegistration(ctx: { line: string; previous: string }): boolean {
  if (/measured\s+entity|company\s+name|enterprise\s+name/i.test(`${ctx.previous} ${ctx.line}`)) {
    return false;
  }
  if (AGENCY_NEAR.test(ctx.line)) return true;
  if (AGENCY_NEAR.test(ctx.previous) && /reg(?:istration)?/i.test(ctx.line)) return true;
  if (/\b(sanas|bva\s*\d+)\b/i.test(ctx.line)) return true;
  return false;
}

function extractRegistration(text: string): ExtractionClaim | null {
  const all: Array<{ raw: string; index: number }> = [];
  const re = new RegExp(ZA_REG.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    all.push({ raw: m[1]!, index: m.index });
  }
  if (!all.length) return null;

  const annexureAt = text.search(/\bannexure\b/i);
  const includedAt = text.search(/\bentities\s+included\b/i);
  const measuredLabelAt = text.search(/(?:^|\n)\s*measured\s+entity\s*(?:\n|:)/i);
  const scored: Array<{ raw: string; score: number; labeled: boolean; index: number }> = [];
  for (const item of all) {
    if (isVerifierRegistration(item.raw)) continue;
    const ctx = lineWindow(text, item.index);
    if (isAgencyOwnedRegistration(ctx)) continue;
    const labeled = /(?:company\s+)?(?:registration(?:\s+number)?|reg(?:istration)?(?:\.|\s*)(?:no\.?|number)|enterprise\s+(?:number|registration))/i.test(
      ctx.line,
    );
    const window = text.slice(Math.max(0, item.index - 240), Math.min(text.length, item.index + 140));
    // A label on its own line or before a colon. "the measured entity" in
    // certificate boilerplate must not outrank the measured entity's number.
    const identityLabel = /(?:^|\n)\s*(?:measured\s+entity|company\s+name|enterprise\s+name|registration\s+number)\s*(?:\n|:)/i.test(
      window,
    );
    let score = 1;
    if (identityLabel) score += 6;
    if (labeled) score += 2;
    if (annexureAt >= 0 && item.index > annexureAt) score -= 8;
    if (includedAt >= 0 && item.index > includedAt) score -= 8;
    if (/\bsubsidiar/i.test(ctx.line) && !identityLabel) score -= 3;
    if (measuredLabelAt >= 0) {
      const dist = Math.abs(item.index - measuredLabelAt);
      if (dist < 250) score += 4;
      else if (dist < 700) score += 2;
    }
    scored.push({ raw: item.raw, score, labeled, index: item.index });
  }
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const best = scored[0];
  if (!best) return null;
  return claim("registration_number", best.raw, normalizeRegistration(best.raw), best.raw, null, best.labeled ? 0.9 : 0.78);
}

export function registrationAppearsInText(text: string, registration: string | null | undefined): boolean {
  if (!registration || !text) return false;
  const wanted = normalizeRegistration(registration);
  if (!wanted) return false;
  const re = new RegExp(ZA_REG.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[1]!;
    if (isVerifierRegistration(raw)) continue;
    if (normalizeRegistration(raw) === wanted) return true;
  }
  return false;
}

function cleanAgencyName(raw: string): string {
  return raw
    .replace(AGENCY_NOISE, " ")
    .replace(/\s+/g, " ")
    .replace(/^[:\-\s]+|[:\-\s]+$/g, "")
    .trim();
}

function extractAgency(text: string): ExtractionClaim | null {
  for (const known of KNOWN_AGENCIES) {
    if (known.pattern.test(text)) {
      return claim("verification_agency", known.name, normalizeName(known.name), known.name, null, 0.88);
    }
  }
  const labeled = text.match(
    /(?:^|\n)\s*(?:b-?bbee\s+)?(?:verification|rating)\s+agency[:\s]+([A-Z][^\n]{2,80})/i,
  ) ?? text.match(/(?:^|\n)\s*verified\s+by[:\s]+([A-Z][^\n]{2,80})/i);
  if (labeled?.[1]) {
    const name = cleanAgencyName(labeled[1]);
    if (isPlausibleAgencyName(name)) {
      return claim("verification_agency", name, normalizeName(name), labeled[0], null, 0.7);
    }
  }
  return null;
}

function isPlausibleAgencyName(name: string): boolean {
  if (name.length < 3 || name.length > 80) return false;
  if (/^(yes|no|n\/a|date|level)$/i.test(name)) return false;
  if (/measured entity|technical signatory|management of|broad based|gazette|scorecard|procurement/i.test(name)) {
    return false;
  }
  if (name.split(/\s+/).length > 10) return false;
  return /pty|ltd|inc|cc\b|agency|ratings|verification|empower|mosela|honeycomb|aqrate|logic|beescore|irba/i.test(name);
}

function extractBva(text: string): string | null {
  const m = text.match(/\bBVA\s*([0-9]{2,4})\b/i);
  return m ? `BVA${m[1]!.padStart(3, "0")}` : null;
}

export function extractDeterministically(text: string): ExtractionResult {
  const claims: ExtractionClaim[] = [];
  const warnings: string[] = [];
  const ambiguity: string[] = [];
  if (!text.trim()) {
    return { claims, warnings: ["No extractable text was available."], ambiguity };
  }

  const level = extractLevel(text);
  if (level) claims.push(level);

  const rec = text.match(/recognition\s*(?:level)?[:\s]+(\d{1,3}\s*%?)/i);
  if (rec) {
    const pct = rec[1]!.replace(/\s+/g, "");
    claims.push(claim("recognition_level", rec[0], pct.endsWith("%") ? pct : `${pct}%`, rec[0]));
  }

  const score = text.match(/scorecard\s*(?:type|applied|size)?[:\s]+(generic|qse|eme|specialised|specialized)[^\n]{0,20}/i);
  if (score) {
    claims.push(claim("scorecard_type", score[0], score[1]!.toLowerCase(), score[0]));
  }

  const dates = locateDates(text);
  const issueHit = bestLabeledDate(text, dates, ISSUE_SPECS);
  const expiryHit = bestLabeledDate(text, dates, EXPIRY_SPECS);
  let issue = issueHit?.date ?? null;
  let expiry = expiryHit?.date ?? null;
  const issueFromLabel = Boolean(issue?.iso);
  const expiryFromLabel = Boolean(expiry?.iso);
  if (issue?.iso && issue.iso < "2020-01-01") {
    issue = null;
  }

  if ((!issue?.iso || !expiry?.iso) || (issue?.iso && expiry?.iso && issue.iso === expiry.iso)) {
    const paired = pairedIssueExpiry(dates, text);
    if (paired) {
      if (!issue?.iso) issue = paired.issue;
      if (!expiry?.iso || expiry.iso === issue?.iso) expiry = paired.expiry;
    }
  }

  if (issue?.iso && expiry?.iso && issue.iso > expiry.iso) {
    if (issueFromLabel && expiryFromLabel) {
      expiry = null;
      warnings.push(
        "Labelled issue date is after the labelled expiry. The expiry was left unused instead of reversing the two dates.",
      );
    } else {
      const swapped = issue;
      issue = expiry;
      expiry = swapped;
      warnings.push("Issue and expiry dates were swapped because the labelled expiry was earlier than the issue date.");
    }
  }

  if (issue?.iso && expiry?.iso && issue.iso === expiry.iso) {
    expiry = null;
  }

  if (issue?.iso) {
    if (issue.warning && /Ambiguous|Interpreted/.test(issue.warning)) ambiguity.push(issue.warning);
    claims.push(claim("issue_date", issue.raw, issue.iso, issue.raw, issue.warning, issue.warning ? 0.62 : 0.86));
  }

  if (expiry?.iso) {
    if (expiry.warning && /Ambiguous|Interpreted/.test(expiry.warning)) ambiguity.push(expiry.warning);
    claims.push(claim("expiry_date", expiry.raw, expiry.iso, expiry.raw, expiry.warning, expiry.warning ? 0.62 : 0.86));
  } else if (issue?.iso) {
    const derived = deriveExpiryFromValidity(text, issue.iso);
    if (derived) {
      claims.push(
        claim(
          "expiry_date",
          derived.raw,
          derived.iso,
          derived.raw,
          derived.warning,
          0.7,
        ),
      );
    }
  }

  const reg = extractRegistration(text);
  if (reg) claims.push(reg);

  const agency = extractAgency(text);
  if (agency) {
    const bva = extractBva(text);
    const warning = bva ? `Accreditation identifier ${bva} appeared on the document.` : null;
    claims.push({ ...agency, warning: warning ?? agency.warning });
  }

  const sig = text.match(/(?:technical\s+signatory|signed\s+by|signatory)[:\s]+([A-Za-z][A-Za-z .'\-]{2,60})/i);
  if (sig) {
    const name = sig[1]!.replace(/\s+/g, " ").trim();
    if (isPlausibleSignatory(name)) {
      claims.push(claim("signatory", name, normalizeName(name), sig[0], null, 0.6));
    }
  }

  const measured = text.match(
    /(?:name\s+of\s+measured\s+entity|measured\s+entity|enterprise\s+name|company\s+name)\s*:\s*([^\n]{3,120})/i,
  );
  if (measured) {
    const name = measured[1]!.replace(/\s+/g, " ").trim();
    if (isPlausibleEntityName(name).ok) {
      claims.push(claim("measured_entity", name, normalizeName(name), measured[0], null, 0.65));
      claims.push(claim("legal_entity_name", name, normalizeName(name), measured[0], null, 0.65));
    }
  }

  const certNo = text.match(
    /(?:certificate\s+(?:number|no\.?|ref(?:erence)?)|unique\s+ref(?:erence)?\s+no\.?|verification\s+number)[:\s]+([A-Za-z0-9][A-Za-z0-9[/_\-.]{4,40})/i,
  );
  if (certNo) {
    const raw = certNo[1]!.trim();
    if (/\d/.test(raw) && !/^(version|final|draft)$/i.test(raw)) {
      claims.push(claim("certificate_number", raw, raw, certNo[0], null, 0.7));
    }
  }

  if (/sworn affidavit/i.test(text)) {
    claims.push(claim("certificate_type", "Sworn affidavit", "sworn_affidavit", "sworn affidavit", null, 0.8));
    claims.push(claim("document_type", "Sworn affidavit", "sworn_affidavit", "sworn affidavit", null, 0.8));
  } else if (/b-?bbee certificate|broad-based black economic empowerment(?:\s+\w+){0,4}\s+certificate/i.test(text)) {
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
  "scorecard",
  "form b-bbee",
  "compliance report",
  "bee certificate",
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

/** Infer a document type from URL/filename/title. Conservative — unknown stays other. */
export function inferEvidenceTypeFromUrl(url: string, title?: string | null): string {
  const blob = `${url} ${title ?? ""}`.toLowerCase();
  if (/sworn\s+affidavit|\baffidavit\b/.test(blob) && /b-?bbee|bbbee|\bbee\b/.test(blob)) {
    return "sworn_affidavit";
  }
  if (/form\s*b-?bbee\s*1|b-?bbee\s+compliance\s+report/.test(blob)) return "transformation_report";
  if (/integrated[_\s-]?report/.test(blob)) return "integrated_report";
  if (/annual[_\s-]?report/.test(blob)) return "annual_report";
  if (/sustainability[_\s-]?report/.test(blob)) return "sustainability_report";
  if (/transformation/.test(blob) && /b-?bbee|bbbee|\bbee\b/.test(blob)) return "transformation_report";
  if (
    /(b-?bbee|bbbee|bee).{0,48}(certificate|cert\b)/.test(blob) ||
    /(certificate|cert\b).{0,48}(b-?bbee|bbbee)/.test(blob)
  ) {
    return "bee_certificate";
  }
  if (/\.pdf($|\?)/i.test(url) && /\bb-?bbee\b|\bbbbee\b/.test(blob)) return "bee_certificate";
  if (/procurement/.test(blob)) return "procurement_page";
  if (/supplier/.test(blob)) return "supplier_page";
  if (/investor/.test(blob)) return "investor_document";
  return "other";
}

export { KNOWN_AGENCIES, extractBva };
