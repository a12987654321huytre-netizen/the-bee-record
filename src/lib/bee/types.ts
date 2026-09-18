import type { BeeField, EvidenceType, ReviewType } from "./constants.ts";

export type Visibility = "draft" | "public" | "hidden";
export type AutomationState = "automation_allowed" | "review_only" | "locked";
export type EntityType = "company" | "group" | "agency" | "other";

export type EntityRow = {
  id: string;
  canonical_name: string;
  normalized_name: string;
  legal_name: string | null;
  trading_name: string | null;
  registration_number: string | null;
  registration_number_normalized: string | null;
  website: string | null;
  description: string | null;
  country: string;
  visibility: Visibility;
  entity_type: EntityType;
  slug: string;
  automation_state: AutomationState;
  merged_into_id: string | null;
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EvidenceRow = {
  id: string;
  evidence_type: EvidenceType | string;
  title: string | null;
  source_url: string | null;
  discovered_url: string | null;
  canonical_url: string | null;
  source_domain: string | null;
  original_filename: string | null;
  mime_type: string | null;
  byte_size: number | null;
  content_hash: string | null;
  normalized_hash: string | null;
  discovered_at: string;
  retrieved_at: string | null;
  publication_date: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  issue_date_raw: string | null;
  expiry_date_raw: string | null;
  document_issuer: string | null;
  verifier_agency_id: string | null;
  signatory_id: string | null;
  original_source_status: string;
  asset_id: string | null;
  crawler_job_id: string | null;
  extraction_state: string;
  validation_state: string;
  review_state: string;
  publication_state: string;
  lifecycle_state: string;
  source_live_status: string;
  public_notes: string | null;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ExtractedClaim = {
  id: string;
  evidence_id: string;
  extraction_run_id: string;
  field_key: BeeField | string;
  structured_value: string | null;
  normalized_value: string | null;
  raw_value: string | null;
  confidence: number | null;
  page_number: number | null;
  section: string | null;
  source_snippet: string | null;
  parser: string | null;
  extracted_at: string;
  validation_status: string;
  review_state: string;
  published_state: string;
  reviewer_id: string | null;
  reviewed_at: string | null;
  edited_value: string | null;
  edited_by: string | null;
  edited_at: string | null;
};

export type CurrentState = {
  entity_id: string;
  bee_level: string | null;
  recognition_level: string | null;
  scorecard_type: string | null;
  certificate_type: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  verifier_agency_id: string | null;
  signatory_id: string | null;
  registration_number: string | null;
  evidence_id: string | null;
  lifecycle_state: string | null;
  published_at: string | null;
  updated_at: string;
};

export type AutomationRuleConfig = {
  officialCompanyDomain: boolean;
  recognizedDocumentType: boolean;
  minimumConfidence: number;
  exactEntityMatch: boolean;
  validDates: boolean;
  noConflictingCurrentEvidence: boolean;
  knownVerifier: boolean;
  registrationNumberConsistency: boolean;
  manualLockConflictMustBeFalse: boolean;
};

export type ExtractionClaim = {
  field: BeeField;
  raw_value: string;
  normalized_value: string | null;
  confidence: number;
  page: number | null;
  locator: string | null;
  warning: string | null;
};

export type ExtractionResult = {
  claims: ExtractionClaim[];
  warnings: string[];
  ambiguity: string[];
};

export type ValidationFlag = {
  code: string;
  severity: "warning" | "error";
  message: string;
  field?: string;
};

export type AdminSession = {
  sessionId: string;
  adminId: string;
  email: string;
  name: string;
  role: "administrator" | "reviewer";
  csrf: string;
};

export type PageResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};
