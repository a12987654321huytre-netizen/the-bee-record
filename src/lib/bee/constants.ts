export const APP_NAME = "The BEE Record";
export const APP_TAGLINE =
  "A searchable index of publicly disclosed South African B-BBEE information, backed by certificates, affidavits, company disclosures and official procurement records.";

export const SESSION_COOKIE = "bee_admin";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_REDIRECTS = 5;
export const EXTRACTION_SCHEMA_VERSION = "extract-v1";
export const PARSER_DETERMINISTIC = "deterministic/v1";
export const PARSER_AI = "xai/grok-4.5";
export const PARSER_REPAIR = "repair/v1";
export const PARSER_SANITIZE = "repair/v3-claims";
export const PARSER_PROCUREMENT = "procurement-disclosure/v1";
export const DEFAULT_CRAWLER_UA =
  "BEERecordBot/1.0 (public B-BBEE evidence index; research bot)";

export const BEE_FIELDS = [
  "bee_level",
  "recognition_level",
  "scorecard_type",
  "certificate_type",
  "measured_entity",
  "legal_entity_name",
  "trading_name",
  "registration_number",
  "issue_date",
  "expiry_date",
  "verification_agency",
  "signatory",
  "document_type",
  "certificate_number",
] as const;

export type BeeField = (typeof BEE_FIELDS)[number];

export const DISCLOSURE_CLAIM_FIELDS = [
  "tender_number",
  "government_institution",
  "enterprise_class",
  "tender_description",
  "contract_period",
  "contract_amount",
  "procurement_outcome",
] as const;

export type DisclosureClaimField = (typeof DISCLOSURE_CLAIM_FIELDS)[number];

export const EVIDENCE_TYPES = [
  "bee_certificate",
  "sworn_affidavit",
  "annual_report",
  "integrated_report",
  "esg_report",
  "sustainability_report",
  "transformation_report",
  "procurement_page",
  "supplier_page",
  "investor_document",
  "company_disclosure",
  "company_webpage",
  "verification_agency_document",
  "accreditation_record",
  "regulatory_record",
  "government_record",
  "government_procurement_disclosure",
  "other",
] as const;

export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const REVIEW_TYPES = [
  "new_evidence",
  "conflicting_evidence",
  "uncertain_entity_match",
  "low_confidence_extraction",
  "community_submission",
  "potential_duplicate_entity",
  "verifier_mismatch",
  "registration_number_conflict",
  "invalid_dates",
  "source_problem",
  "manual_lock_conflict",
  "potentially_revoked",
  "relationship_claim",
  "consultant_relationship",
  "extraction_failed",
  "invalid_extracted_claim",
] as const;

export type ReviewType = (typeof REVIEW_TYPES)[number];

export const CLAIM_FIELD_LABELS: Record<BeeField, string> = {
  bee_level: "B-BBEE level",
  recognition_level: "Recognition level",
  scorecard_type: "Scorecard type",
  certificate_type: "Certificate / affidavit type",
  measured_entity: "Measured entity",
  legal_entity_name: "Legal entity name",
  trading_name: "Trading name",
  registration_number: "Registration number",
  issue_date: "Issue date",
  expiry_date: "Expiry date",
  verification_agency: "Verification agency",
  signatory: "Signatory",
  document_type: "Document type",
  certificate_number: "Certificate / reference number",
};

export const DISCLOSURE_FIELD_LABELS: Record<DisclosureClaimField, string> = {
  tender_number: "Tender / bid number",
  government_institution: "Government institution",
  enterprise_class: "Enterprise class",
  tender_description: "Tender description",
  contract_period: "Contract period",
  contract_amount: "Contract amount",
  procurement_outcome: "Procurement outcome",
};

export const EVIDENCE_TYPE_LABELS: Record<EvidenceType, string> = {
  bee_certificate: "B-BBEE certificate",
  sworn_affidavit: "Sworn affidavit",
  annual_report: "Annual report",
  integrated_report: "Integrated report",
  esg_report: "ESG report",
  sustainability_report: "Sustainability report",
  transformation_report: "Transformation report",
  procurement_page: "Procurement page",
  supplier_page: "Supplier page",
  investor_document: "Investor document",
  company_disclosure: "Company disclosure",
  company_webpage: "Company webpage",
  verification_agency_document: "Verification-agency document",
  accreditation_record: "Accreditation record",
  regulatory_record: "Regulatory record",
  government_record: "Government / public record",
  government_procurement_disclosure: "Official procurement disclosure",
  other: "Other public evidence",
};

export const RECOGNIZED_DOCUMENT_TYPES: EvidenceType[] = [
  "bee_certificate",
  "sworn_affidavit",
  "annual_report",
  "integrated_report",
  "transformation_report",
];

/** Documents that establish a current B-BBEE status for an entity. */
export const STATUS_EVIDENCE_TYPES: EvidenceType[] = ["bee_certificate", "sworn_affidavit"];

/** Dated public disclosures that must never be treated as a current certificate. */
export const DISCLOSURE_EVIDENCE_TYPES: EvidenceType[] = ["government_procurement_disclosure"];

export function isStatusEvidence(type: string | null | undefined): boolean {
  return (STATUS_EVIDENCE_TYPES as readonly string[]).includes(type ?? "");
}

export function isRecognizedEvidence(type: string | null | undefined): boolean {
  return (RECOGNIZED_DOCUMENT_TYPES as readonly string[]).includes(type ?? "");
}

export function isDisclosureEvidence(type: string | null | undefined): boolean {
  return (DISCLOSURE_EVIDENCE_TYPES as readonly string[]).includes(type ?? "");
}

export const LIFECYCLE_LABELS: Record<string, string> = {
  discovered: "Discovered",
  current: "Current",
  historical: "Historical",
  superseded: "Superseded",
  expired: "Expired",
  expiring_soon: "Expiring soon",
  disputed: "Disputed",
  unknown_validity: "Validity unconfirmed",
};

export const INTERPRETATION_LABELS: Record<string, string> = {
  current_certificate: "Current certificate",
  expiring_soon: "Expiring soon",
  validity_unconfirmed: "Validity unconfirmed",
  expired_certificate: "Expired certificate",
  historical_certificate: "Historical certificate",
  official_dated_disclosure: "Official dated disclosure",
  historical_procurement_disclosure: "Historical procurement disclosure",
  no_current_certificate: "No current certificate in corpus",
};

export const UNKNOWN_LABELS = {
  unknown: "Unknown",
  not_disclosed: "Not disclosed",
  not_found: "Not found in published evidence",
} as const;

export const PUBLIC_STATE_LABELS: Record<string, string> = {
  approved: "Approved",
  published: "Published",
  unpublished: "Unpublished",
  pending: "Pending",
  rejected: "Rejected",
  edited: "Edited",
  under_review: "Under review",
  in_review: "In review",
  live: "Live",
  dead: "Unreachable",
  unreachable: "Unreachable",
  unknown: "Unknown",
  discovered: "Discovered",
  current: "Current",
  historical: "Historical",
  superseded: "Superseded",
  expired: "Expired",
  expiring_soon: "Expiring soon",
  disputed: "Disputed",
  unknown_validity: "Validity unconfirmed",
  conflicting_evidence: "Conflicting evidence",
  retained: "Retained (not published as a public file URL)",
  not_stored: "Not stored",
  official_dated_disclosure: "Official dated disclosure",
  historical_procurement_disclosure: "Historical procurement disclosure",
  current_certificate: "Current certificate",
  expired_certificate: "Expired certificate",
  historical_certificate: "Historical certificate",
  no_current_certificate: "No current certificate in corpus",
};
