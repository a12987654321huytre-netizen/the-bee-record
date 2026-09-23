import { collapseWhitespace, fold, normalizeName } from "./normalize.ts";
import { sha256HexNode } from "./hash.ts";
import { isDisclosureEvidence, isStatusEvidence } from "./constants.ts";
import { isVerifierRegistration, isZaCompanyRegistration } from "./enrichment.ts";
import { displayBeeLevel } from "./level.ts";
import { evidenceDateEligibility } from "./recency.ts";

const JV_RE =
  /\b(jv|j\/v|joint\s+ventures?|consortium|consortia|and\s+associates\s+jv)\b/i;
const SLASH_JV_RE = /\s\/\s.+\b(jv|consortium)\b/i;
const DIVISION_RE = /\s*(?:[-–—]|,\s*)\s*an?\s+division\s+of\s+/i;
const TRADING_AS_RE = /\s+(?:t\/a|trading\s+as|ta)\s+/i;
const URL_RE = /^https?:\/\//i;
const NOISE_NAME_RE =
  /^(n\/?a|none|tbc|tba|various|multiple|not\s+applicable|see\s+above|supplier|bidder|company|name of bidder|successful bidder)$/i;
const FRAG_START_RE =
  /^(pty\)|ltd|cc|inc|limited|tion|ing|vices|tors|prise|tions|care|school|solutions|projects|manufacturers|surveyors|recruitment|struction|sultants|sulting|plies|ments|trol|neers|gineers|neering|tium|terprise|ogies|lishers|and |of |the |for |to |new |all )\b/i;
const PARSER_DEBRIS_RE =
  /\b(contract number|description of contract|bbbee level|value of award|shall become|ruugby|completion period of weeks|logistics & contract administration|rescue & disaster management)\b|^visit\s|^municipality\s/i;
const DESC_PREFIX_RE =
  /^(supply|deliver|appointment|provision|service of|bi-annual|single |dual |hiring |lease |maintenance |repair |installation |rendering |dressing |infrastructure |the supply|request for |tender for )/i;
const CORE_STOP = new Set([
  "institute",
  "national",
  "contractors",
  "agencies",
  "solutions",
  "projects",
  "manufacturers",
  "removals",
  "surveyors",
  "recruitment",
  "school",
  "care",
  "pty",
  "ltd",
  "limited",
  "cc",
  "inc",
  "ness",
  "prise",
  "tions",
  "company",
  "enterprise",
  "trading",
  "holdings",
  "group",
  "services",
  "consulting",
  "medical",
  "surgical",
  "engineers",
  "corporate",
  "events",
  "town",
  "roads",
  "plant",
  "tiles",
  "africa",
  "centers",
  "supplies",
  "construction",
  "consultants",
  "systems",
  "sa",
]);
const FRAGMENT_STEMS = new Set([
  "struction",
  "sultants",
  "sulting",
  "plies",
  "ments",
  "trol",
  "neers",
  "gineers",
  "neering",
  "tium",
  "terprise",
  "ogies",
  "lishers",
  "ment",
  "ers",
  "suplies",
]);

export type CleanedSupplier = {
  canonicalName: string;
  tradingName: string | null;
  parentName: string | null;
  aliases: string[];
  original: string;
};

export function isJointVentureName(name: string): boolean {
  const t = collapseWhitespace(name);
  if (!t) return false;
  if (JV_RE.test(t) || SLASH_JV_RE.test(t)) return true;
  if (/\s\/\s/.test(t) && /\b(pty|ltd|limited|inc|cc)\b/i.test(t) && /\b(pty|ltd|limited|inc|cc)\b/i.test(t.split(/\s\/\s/)[1] ?? "")) {
    return true;
  }
  return false;
}

export function isMalformedCompanyName(name: string): boolean {
  const t = collapseWhitespace(name);
  if (t.length < 3 || t.length > 140) return true;
  if (URL_RE.test(t)) return true;
  if (/^\d+$/.test(t)) return true;
  if (NOISE_NAME_RE.test(t)) return true;
  if (!/[A-Za-z]/.test(t)) return true;
  if (/^(level\s*[1-8]|eme|qse|generic|gen)$/i.test(t)) return true;
  if (/^r[\s\u00a0]?\d/i.test(t)) return true;
  if (t.split(/\s+/).length > 16) return true;
  if (t[0] && t[0] === t[0].toLowerCase() && /[a-z]/.test(t[0])) return true;
  if (FRAG_START_RE.test(t)) return true;
  if (DESC_PREFIX_RE.test(t) || PARSER_DEBRIS_RE.test(t) || /\bx\s*\d+\b/i.test(t)) return true;
  if (/\bprovinces\b/i.test(t)) return true;
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length < 6) return true;
  const core = t
    .replace(/\b(pty|ltd|limited|inc|cc|proprietary)\b/gi, " ")
    .replace(/[^A-Za-z0-9& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!core || CORE_STOP.has(core.toLowerCase())) return true;
  const coreLetters = core.replace(/[^A-Za-z]/g, "");
  if (coreLetters.length < 4) return true;
  const words = core.split(" ");
  if (words.every((w) => CORE_STOP.has(w.toLowerCase()) || FRAGMENT_STEMS.has(w.toLowerCase()) || w.length < 3)) {
    return true;
  }
  const first = words[0]?.toLowerCase() ?? "";
  if (FRAGMENT_STEMS.has(first)) return true;
  if (words.length === 1 && first.length < 5) return true;
  return false;
}

/**
 * Operator imports of a real short legal name (JSE Limited, GWK Limited) with a
 * company registration. Procurement junk still fails isMalformedCompanyName.
 */
export function isImportableShortLegalName(name: string, registration?: string | null): boolean {
  if (!registration || !isZaCompanyRegistration(registration) || isVerifierRegistration(registration)) return false;
  const t = collapseWhitespace(name);
  if (!t || isJointVentureName(t)) return false;
  if (URL_RE.test(t) || NOISE_NAME_RE.test(t) || DESC_PREFIX_RE.test(t) || PARSER_DEBRIS_RE.test(t)) return false;
  if (!/\b(limited|ltd|proprietary|\(pty\))\b/i.test(t)) return false;
  const core = t
    .replace(/\b(proprietary|limited|ltd|pty|soc|inc|cc)\b/gi, " ")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!/^[A-Za-z]{2,6}$/.test(core)) return false;
  if (CORE_STOP.has(core.toLowerCase()) || FRAGMENT_STEMS.has(core.toLowerCase())) return false;
  return true;
}

export function cleanSupplierName(raw: string): CleanedSupplier {
  let original = collapseWhitespace(raw).replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"');
  original = original.replace(/[\u2013\u2014]/g, "-");
  original = original.replace(/\s+/g, " ").replace(/^[\s,.;:]+|[\s,.;:]+$/g, "");
  original = original.replace(/\s*\(\s*pty\s*\)\s*ltd\.?/gi, " (Pty) Ltd");
  original = original.replace(/\s+pty\.?\s*ltd\.?/gi, " (Pty) Ltd");
  original = original.replace(/\s+limited\.?$/i, " Limited");
  original = original.replace(/\s+ltd\.?$/i, " Ltd");
  original = original.replace(/\s+incorporated\.?$/i, " Incorporated");
  original = original.replace(/\s+inc\.?$/i, " Inc");
  original = collapseWhitespace(original);

  const aliases: string[] = [];
  let canonicalName = original;
  let tradingName: string | null = null;
  let parentName: string | null = null;

  const division = original.split(DIVISION_RE);
  if (division.length === 2 && division[0] && division[1]) {
    tradingName = collapseWhitespace(division[0]);
    canonicalName = collapseWhitespace(division[1]);
    parentName = canonicalName;
    aliases.push(tradingName);
  } else {
    const trading = original.split(TRADING_AS_RE);
    if (trading.length === 2 && trading[0] && trading[1]) {
      canonicalName = collapseWhitespace(trading[0]);
      tradingName = collapseWhitespace(trading[1]);
      aliases.push(tradingName);
    }
  }

  if (tradingName && normalizeName(tradingName) === normalizeName(canonicalName)) {
    tradingName = null;
  }

  return {
    canonicalName,
    tradingName,
    parentName,
    aliases: aliases.filter((a) => normalizeName(a) !== normalizeName(canonicalName)),
    original,
  };
}

export function procurementIdentityHash(input: {
  sourceUrl: string;
  tenderNumber?: string | null;
  canonicalName: string;
  beeLevel?: string | null;
  evidenceDate?: string | null;
}): string {
  const key = [
    "gpd:v1",
    fold(input.sourceUrl.trim()),
    fold(input.tenderNumber ?? ""),
    normalizeName(input.canonicalName),
    fold(input.beeLevel ?? ""),
    input.evidenceDate ?? "",
  ].join("|");
  return sha256HexNode(key);
}

export function disclosureInterpretation(input: {
  evidenceType?: string | null;
  lifecycle?: string | null;
  issueDate?: string | Date | null;
  sourceUrl?: string | null;
  title?: string | null;
}): string {
  if (isDisclosureEvidence(input.evidenceType)) {
    const dated = evidenceDateEligibility({
      issueDate: input.issueDate,
      sourceUrl: input.sourceUrl,
      title: input.title,
    });
    if (dated === "unknown") return "official_undated";
    return dated === "pre2024" ? "historical_procurement_disclosure" : "official_dated_disclosure";
  }
  if (input.lifecycle === "current") return "current_certificate";
  if (input.lifecycle === "expiring_soon") return "expiring_soon";
  if (input.lifecycle === "unknown_validity") return "validity_unconfirmed";
  if (input.lifecycle === "expired") return "expired_certificate";
  if (input.lifecycle === "historical" || input.lifecycle === "superseded") return "historical_certificate";
  return input.lifecycle ?? "no_current_certificate";
}

export function companyInterpretation(input: {
  currentLifecycle?: string | null;
  currentEvidenceType?: string | null;
  hasDisclosure?: boolean;
  disclosureModern?: boolean | null;
  hasCompanyDisclosure?: boolean;
}): string {
  if (input.currentEvidenceType && isDisclosureEvidence(input.currentEvidenceType)) {
    if (input.disclosureModern === false) return "historical_procurement_disclosure";
    return input.hasDisclosure ? "official_dated_disclosure" : "no_current_certificate";
  }
  if (input.currentLifecycle === "current") return "current_certificate";
  if (input.currentLifecycle === "expiring_soon") return "expiring_soon";
  if (input.currentLifecycle === "unknown_validity") return "validity_unconfirmed";
  if (input.currentLifecycle === "expired") return "expired_certificate";
  if (input.currentLifecycle === "disputed") return "disputed";
  if (input.hasDisclosure) {
    return input.disclosureModern === false
      ? "historical_procurement_disclosure"
      : "official_dated_disclosure";
  }
  if (input.hasCompanyDisclosure) return "official_company_disclosure";
  if (input.currentLifecycle === "historical" || input.currentLifecycle === "superseded") {
    return "historical_certificate";
  }
  return "no_current_certificate";
}

export function reportedLevelLabel(level: string | null | undefined): string {
  return displayBeeLevel(level) ?? "Level not stated";
}

export function isCertificateClassEvidence(type: string | null | undefined): boolean {
  return isStatusEvidence(type) || (!isDisclosureEvidence(type) && Boolean(type));
}

export type CompanySummaryInput = {
  currentLifecycle?: string | null;
  currentEvidenceType?: string | null;
  hasDisclosure?: boolean;
  disclosureModern?: boolean | null;
  hasCompanyDisclosure?: boolean;
  beeLevel?: string | null;
  disclosureLevel?: string | null;
  latestKind?: string | null;
  latestLevel?: string | null;
  latestSource?: string | null;
  latestDateLabel?: string | null;
  expiryDateLabel?: string | null;
};

export function companySummaryText(input: CompanySummaryInput): string {
  if (input.latestKind) {
    const level = displayBeeLevel(input.latestLevel ?? null);
    const kindLabel =
      INTERPRETATION_LOOKUP[input.latestKind] ??
      input.latestKind.replace(/_/g, " ");
    if (input.latestKind === "current_certificate" || input.latestKind === "expiring_soon") {
      const bits = [level, kindLabel, input.latestSource, input.expiryDateLabel ? `expires ${input.expiryDateLabel}` : input.latestDateLabel];
      return bits.filter(Boolean).join(" · ");
    }
    const bits = [level, kindLabel, input.latestSource, input.latestDateLabel];
    return bits.filter(Boolean).join(" · ");
  }
  const interpretation = companyInterpretation({
    currentLifecycle: input.currentLifecycle,
    currentEvidenceType: input.currentEvidenceType,
    hasDisclosure: input.hasDisclosure,
    disclosureModern: input.disclosureModern,
    hasCompanyDisclosure: input.hasCompanyDisclosure,
  });
  const certLevel = displayBeeLevel(input.beeLevel);
  const disclosureLevel = displayBeeLevel(input.disclosureLevel ?? null);

  if (interpretation === "current_certificate") {
    return certLevel ? `${certLevel} · Current certificate` : "Current certificate";
  }
  if (interpretation === "expiring_soon") {
    return certLevel ? `${certLevel} · Expiring soon` : "Expiring soon";
  }
  if (interpretation === "validity_unconfirmed") {
    return certLevel ? `${certLevel} · Validity unconfirmed` : "Validity unconfirmed";
  }
  if (interpretation === "expired_certificate") {
    return certLevel ? `${certLevel} · Expired certificate` : "Expired certificate";
  }
  if (interpretation === "historical_certificate") {
    return certLevel ? `${certLevel} · Historical certificate` : "Historical certificate";
  }
  if (interpretation === "disputed") return "Disputed";
  if (interpretation === "official_dated_disclosure" || interpretation === "official_procurement_disclosure") {
    return disclosureLevel ? `${disclosureLevel} · Official procurement disclosure` : "Official procurement disclosure";
  }
  if (interpretation === "historical_procurement_disclosure") {
    return disclosureLevel ? `${disclosureLevel} · Historical procurement disclosure` : "Historical procurement disclosure";
  }
  if (interpretation === "official_company_disclosure") {
    return disclosureLevel || certLevel
      ? `${disclosureLevel ?? certLevel} · Official company disclosure`
      : "Official company disclosure";
  }
  if (input.hasDisclosure) {
    return disclosureLevel ? `${disclosureLevel} · Official procurement disclosure` : "Official procurement disclosure";
  }
  return "No current certificate in corpus";
}

const INTERPRETATION_LOOKUP: Record<string, string> = {
  current_certificate: "Current certificate",
  expiring_soon: "Expiring soon",
  official_company_disclosure: "Official company disclosure",
  official_procurement_disclosure: "Official procurement disclosure",
  validity_unconfirmed: "Validity unconfirmed",
  expired_certificate: "Expired certificate",
  historical_certificate: "Historical certificate",
  historical_procurement_disclosure: "Historical procurement disclosure",
  historical_disclosure: "Historical disclosure",
  official_dated_disclosure: "Official dated disclosure",
  official_undated: "Official evidence — source date not stated",
};
