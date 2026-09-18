import { RECOGNIZED_DOCUMENT_TYPES } from "./constants.ts";
import { compareIso, parseDate } from "./dates.ts";
import { normalizeName, normalizeRegistration } from "./normalize.ts";
import type { AutomationRuleConfig, CurrentState, EvidenceRow, ExtractedClaim, ValidationFlag } from "./types.ts";

export function validateClaims(input: {
  evidence: Pick<
    EvidenceRow,
    "evidence_type" | "issue_date" | "expiry_date" | "content_hash" | "mime_type" | "source_domain"
  >;
  claims: Array<Pick<ExtractedClaim, "field_key" | "normalized_value" | "raw_value" | "confidence">>;
  current?: CurrentState | null;
  entityReg?: string | null;
  entityName?: string | null;
  entityWebsite?: string | null;
  knownAgency?: boolean;
  duplicateHash?: boolean;
  sourceMissing?: boolean;
  lockedFields?: string[];
  minConfidence?: number;
}): ValidationFlag[] {
  const flags: ValidationFlag[] = [];
  const map = new Map(input.claims.map((c) => [c.field_key, c]));
  const issue = map.get("issue_date")?.normalized_value ?? input.evidence.issue_date;
  const expiry = map.get("expiry_date")?.normalized_value ?? input.evidence.expiry_date;

  if (issue) {
    const parsed = parseDate(issue);
    if (parsed.warning) flags.push({ code: "impossible_date", severity: "error", message: parsed.warning, field: "issue_date" });
  }
  if (expiry) {
    const parsed = parseDate(expiry);
    if (parsed.warning) flags.push({ code: "impossible_date", severity: "error", message: parsed.warning, field: "expiry_date" });
  }
  if (issue && expiry && compareIso(expiry, issue) < 0) {
    flags.push({
      code: "expiry_before_issue",
      severity: "error",
      message: "Expiry date is before issue date.",
      field: "expiry_date",
    });
  }

  if (input.duplicateHash) {
    flags.push({ code: "duplicate_hash", severity: "warning", message: "An identical document hash is already stored." });
  }

  const extractedRegRaw = map.get("registration_number")?.normalized_value ?? map.get("registration_number")?.raw_value;
  const extractedReg = extractedRegRaw ? normalizeRegistration(extractedRegRaw) : null;
  const entityReg = input.entityReg ? normalizeRegistration(input.entityReg) : null;
  if (extractedReg && entityReg && extractedReg !== entityReg) {
    flags.push({
      code: "registration_mismatch",
      severity: "error",
      message: "Extracted registration number does not match the linked entity.",
      field: "registration_number",
    });
  }

  const extractedNameRaw =
    map.get("legal_entity_name")?.normalized_value ??
    map.get("measured_entity")?.normalized_value ??
    map.get("legal_entity_name")?.raw_value ??
    map.get("measured_entity")?.raw_value;
  const extractedName = extractedNameRaw ? normalizeName(extractedNameRaw) : null;
  const entityName = input.entityName ? normalizeName(input.entityName) : null;
  if (extractedName && entityName && extractedName !== entityName) {
    flags.push({
      code: "company_mismatch",
      severity: "warning",
      message: "Extracted entity name does not match the linked company.",
      field: "legal_entity_name",
    });
  }

  const newLevel = map.get("bee_level")?.normalized_value;
  if (newLevel && input.current?.bee_level && newLevel !== input.current.bee_level && input.current.evidence_id) {
    flags.push({
      code: "conflicting_level",
      severity: "warning",
      message: `Extracted B-BBEE level ${newLevel} differs from published level ${input.current.bee_level}.`,
      field: "bee_level",
    });
  }

  const minC = input.minConfidence ?? 0.5;
  for (const claim of input.claims) {
    if (claim.confidence != null && claim.confidence < minC) {
      flags.push({
        code: "low_confidence",
        severity: "warning",
        message: `Low extraction confidence for ${claim.field_key}.`,
        field: claim.field_key,
      });
    }
  }

  if (!input.knownAgency && map.get("verification_agency")?.raw_value) {
    flags.push({
      code: "unknown_verifier",
      severity: "warning",
      message: "Verification agency is not in the known directory.",
      field: "verification_agency",
    });
  }

  if (input.sourceMissing) {
    flags.push({ code: "source_missing", severity: "warning", message: "Original source is no longer available." });
  }

  if (issue && input.current?.issue_date && compareIso(issue, input.current.issue_date) < 0) {
    flags.push({
      code: "older_than_current",
      severity: "warning",
      message: "Issue date is older than the currently published evidence.",
      field: "issue_date",
    });
  }

  const mime = input.evidence.mime_type ?? "";
  if (mime && !/^(application\/pdf|text\/|image\/|application\/json|application\/xml)/.test(mime)) {
    flags.push({ code: "unexpected_mime", severity: "warning", message: `Unexpected MIME type ${mime}.` });
  }

  if (RECOGNIZED_DOCUMENT_TYPES.includes(input.evidence.evidence_type as never)) {
    if (!newLevel) {
      flags.push({
        code: "missing_level",
        severity: "warning",
        message: "Recognised certificate-like document is missing a B-BBEE level.",
        field: "bee_level",
      });
    }
  }

  for (const field of input.lockedFields ?? []) {
    const incoming = map.get(field)?.normalized_value ?? map.get(field)?.raw_value;
    if (!incoming || !input.current) continue;
    const currentVal = currentField(input.current, field);
    if (currentVal && incoming !== currentVal) {
      flags.push({
        code: "manual_lock_conflict",
        severity: "error",
        message: `Field ${field} is locked and the extracted value conflicts.`,
        field,
      });
    }
  }

  return flags;
}

function currentField(state: CurrentState, field: string): string | null {
  switch (field) {
    case "bee_level":
      return state.bee_level;
    case "recognition_level":
      return state.recognition_level;
    case "scorecard_type":
      return state.scorecard_type;
    case "certificate_type":
      return state.certificate_type;
    case "issue_date":
      return state.issue_date;
    case "expiry_date":
      return state.expiry_date;
    case "registration_number":
      return state.registration_number;
    default:
      return null;
  }
}

export type AutomationEval = {
  pass: boolean;
  reasons: string[];
  ruleVersion: number;
};

export function evaluateAutomation(input: {
  enabled: boolean;
  ruleEnabled: boolean;
  ruleVersion: number;
  config: AutomationRuleConfig;
  flags: ValidationFlag[];
  officialDomain: boolean;
  recognizedType: boolean;
  exactEntityMatch: boolean;
  knownVerifier: boolean;
  minClaimConfidence: number | null;
  hasLockConflict: boolean;
  entityAutomation: "automation_allowed" | "review_only" | "locked";
}): AutomationEval {
  const reasons: string[] = [];
  if (!input.enabled) reasons.push("Site-wide auto-publication is disabled.");
  if (!input.ruleEnabled) reasons.push("The automation rule is disabled.");
  if (input.entityAutomation !== "automation_allowed") {
    reasons.push(`Entity automation state is ${input.entityAutomation}.`);
  }
  const cfg = input.config;
  if (cfg.officialCompanyDomain && !input.officialDomain) reasons.push("Source is not the official company domain.");
  if (cfg.recognizedDocumentType && !input.recognizedType) reasons.push("Document type is not a recognised primary certificate/report.");
  if (cfg.exactEntityMatch && !input.exactEntityMatch) reasons.push("Entity match is not exact.");
  if (cfg.knownVerifier && !input.knownVerifier) reasons.push("Verifier is not a known agency.");
  if (cfg.minimumConfidence > 0) {
    if (input.minClaimConfidence == null || input.minClaimConfidence < cfg.minimumConfidence) {
      reasons.push(`Extraction confidence is below ${Math.round(cfg.minimumConfidence * 100)}%.`);
    }
  }
  if (cfg.validDates && input.flags.some((f) => f.code === "impossible_date" || f.code === "expiry_before_issue")) {
    reasons.push("Dates failed validation.");
  }
  if (cfg.noConflictingCurrentEvidence && input.flags.some((f) => f.code === "conflicting_level")) {
    reasons.push("Conflicts with currently published evidence.");
  }
  if (cfg.registrationNumberConsistency && input.flags.some((f) => f.code === "registration_mismatch")) {
    reasons.push("Registration number is inconsistent.");
  }
  if (cfg.manualLockConflictMustBeFalse && input.hasLockConflict) {
    reasons.push("A locked field would be overwritten.");
  }
  if (input.flags.some((f) => f.severity === "error")) {
    reasons.push("Validation produced errors.");
  }
  return { pass: reasons.length === 0, reasons, ruleVersion: input.ruleVersion };
}
