-- BEE Record schema. Evidence is immutable; history is never overwritten.
-- All IDs are stable text keys. Company names are not identifiers.

create table if not exists admin_users (
  id text primary key,
  email text not null unique,
  name text not null,
  password_hash text not null,
  role text not null default 'administrator' check (role in ('administrator', 'reviewer')),
  disabled integer not null default 0 check (disabled in (0, 1)),
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists admin_sessions (
  id text primary key,
  admin_user_id text not null references admin_users (id),
  token_hash text not null unique,
  csrf_secret text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ip_hash text,
  user_agent text
);

create index if not exists admin_sessions_user_idx on admin_sessions (admin_user_id);
create index if not exists admin_sessions_expires_idx on admin_sessions (expires_at);

create table if not exists login_attempts (
  id text primary key,
  email_normalized text not null,
  ip_hash text,
  attempted_at timestamptz not null default now(),
  success integer not null default 0 check (success in (0, 1))
);

create index if not exists login_attempts_lookup_idx
  on login_attempts (email_normalized, attempted_at);

create table if not exists sectors (
  id text primary key,
  slug text not null unique,
  name text not null,
  description text
);

create table if not exists verification_agencies (
  id text primary key,
  name text not null,
  normalized_name text not null,
  slug text not null unique,
  legal_name text,
  website text,
  visibility text not null default 'public' check (visibility in ('draft', 'public', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agencies_normalized_idx on verification_agencies (normalized_name);

create table if not exists entities (
  id text primary key,
  canonical_name text not null,
  normalized_name text not null,
  legal_name text,
  trading_name text,
  registration_number text,
  registration_number_normalized text,
  website text,
  description text,
  country text not null default 'ZA',
  visibility text not null default 'draft' check (visibility in ('draft', 'public', 'hidden')),
  entity_type text not null default 'company'
    check (entity_type in ('company', 'group', 'agency', 'other')),
  slug text not null unique,
  automation_state text not null default 'review_only'
    check (automation_state in ('automation_allowed', 'review_only', 'locked')),
  merged_into_id text references entities (id),
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists entities_normalized_idx on entities (normalized_name);
create index if not exists entities_slug_idx on entities (slug);
create index if not exists entities_visibility_idx on entities (visibility);
create index if not exists entities_merged_idx on entities (merged_into_id);
create unique index if not exists entities_reg_norm_uq
  on entities (registration_number_normalized)
  where registration_number_normalized is not null and merged_into_id is null;

create table if not exists entity_aliases (
  id text primary key,
  entity_id text not null references entities (id),
  alias text not null,
  normalized_alias text not null,
  alias_type text not null default 'other'
    check (alias_type in ('legal', 'trading', 'former', 'group', 'brand', 'abbreviation', 'spelling', 'other')),
  evidence_id text,
  source text,
  reviewed_status text not null default 'reviewed'
    check (reviewed_status in ('pending', 'reviewed', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists entity_aliases_norm_idx on entity_aliases (normalized_alias);
create index if not exists entity_aliases_entity_idx on entity_aliases (entity_id);

create table if not exists entity_relationships (
  id text primary key,
  source_entity_id text not null references entities (id),
  target_entity_id text not null references entities (id),
  relationship_type text not null
    check (relationship_type in (
      'parent', 'subsidiary', 'holding_company', 'operating_company',
      'division', 'trading_brand', 'group_membership', 'predecessor',
      'successor', 'other'
    )),
  evidence_id text,
  confidence text not null default 'reviewed'
    check (confidence in ('candidate', 'extracted', 'reviewed', 'rejected')),
  review_state text not null default 'pending'
    check (review_state in ('pending', 'approved', 'rejected')),
  public_status text not null default 'private' check (public_status in ('public', 'private')),
  effective_from date,
  effective_to date,
  created_by text,
  created_at timestamptz not null default now(),
  check (source_entity_id <> target_entity_id)
);

create index if not exists entity_rel_source_idx on entity_relationships (source_entity_id);
create index if not exists entity_rel_target_idx on entity_relationships (target_entity_id);

create table if not exists entity_classifications (
  id text primary key,
  entity_id text not null references entities (id),
  sector_id text not null references sectors (id),
  classification_type text not null default 'sector',
  evidence_id text,
  is_public integer not null default 1 check (is_public in (0, 1)),
  created_at timestamptz not null default now(),
  unique (entity_id, sector_id, classification_type)
);

create index if not exists entity_class_sector_idx on entity_classifications (sector_id);

create table if not exists agency_aliases (
  id text primary key,
  agency_id text not null references verification_agencies (id),
  alias text not null,
  normalized_alias text not null,
  created_at timestamptz not null default now()
);

create index if not exists agency_aliases_norm_idx on agency_aliases (normalized_alias);

create table if not exists agency_accreditations (
  id text primary key,
  agency_id text not null references verification_agencies (id),
  accreditation_body text,
  accreditation_identifier text,
  status text,
  effective_from date,
  effective_to date,
  evidence_id text,
  created_at timestamptz not null default now()
);

create table if not exists signatories (
  id text primary key,
  name text not null,
  normalized_name text not null,
  agency_id text references verification_agencies (id),
  role_title text,
  created_at timestamptz not null default now()
);

create index if not exists signatories_norm_idx on signatories (normalized_name);

create table if not exists evidence_assets (
  id text primary key,
  content_hash text not null unique,
  mime_type text,
  byte_size integer not null default 0,
  storage_backend text not null default 'db' check (storage_backend in ('db', 'r2', 'none')),
  storage_key text,
  content bytea,
  created_at timestamptz not null default now()
);

create table if not exists crawler_jobs (
  id text primary key,
  type text not null,
  source_id text,
  state text not null default 'queued'
    check (state in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempt integer not null default 1,
  discovered_items integer not null default 0,
  changed_items integer not null default 0,
  retrieved_documents integer not null default 0,
  extraction_jobs_created integer not null default 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  created_by text
);

create index if not exists crawler_jobs_state_idx on crawler_jobs (state, created_at desc);
create index if not exists crawler_jobs_source_idx on crawler_jobs (source_id);

create table if not exists evidence (
  id text primary key,
  evidence_type text not null,
  title text,
  source_url text,
  discovered_url text,
  canonical_url text,
  source_domain text,
  original_filename text,
  mime_type text,
  byte_size integer,
  content_hash text,
  normalized_hash text,
  discovered_at timestamptz not null default now(),
  retrieved_at timestamptz,
  publication_date date,
  issue_date date,
  expiry_date date,
  issue_date_raw text,
  expiry_date_raw text,
  document_issuer text,
  verifier_agency_id text references verification_agencies (id),
  signatory_id text references signatories (id),
  original_source_status text not null default 'unknown'
    check (original_source_status in ('live', 'missing', 'unknown', 'redirected', 'blocked')),
  asset_id text references evidence_assets (id),
  crawler_job_id text references crawler_jobs (id),
  extraction_state text not null default 'none'
    check (extraction_state in ('none', 'pending', 'extracting', 'extracted', 'failed')),
  validation_state text not null default 'none'
    check (validation_state in ('none', 'passed', 'warnings', 'failed')),
  review_state text not null default 'none'
    check (review_state in ('none', 'required', 'in_review', 'approved', 'rejected')),
  publication_state text not null default 'unpublished'
    check (publication_state in ('unpublished', 'published')),
  lifecycle_state text not null default 'discovered'
    check (lifecycle_state in (
      'discovered', 'current', 'historical', 'superseded', 'expired',
      'expiring_soon', 'disputed'
    )),
  source_live_status text not null default 'unknown'
    check (source_live_status in ('live', 'missing', 'unknown', 'redirected')),
  public_notes text,
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists evidence_content_hash_uq
  on evidence (content_hash)
  where content_hash is not null;
create index if not exists evidence_lifecycle_idx on evidence (lifecycle_state);
create index if not exists evidence_review_idx on evidence (review_state);
create index if not exists evidence_expiry_idx on evidence (expiry_date);
create index if not exists evidence_issue_idx on evidence (issue_date);
create index if not exists evidence_domain_idx on evidence (source_domain);
create index if not exists evidence_agency_idx on evidence (verifier_agency_id);
create index if not exists evidence_publication_idx on evidence (publication_state, updated_at desc);

create table if not exists evidence_source_locations (
  id text primary key,
  evidence_id text not null references evidence (id),
  url text not null,
  discovered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (evidence_id, url)
);

create index if not exists evidence_locations_url_idx on evidence_source_locations (url);

create table if not exists evidence_entity_links (
  id text primary key,
  evidence_id text not null references evidence (id),
  entity_id text references entities (id),
  link_state text not null default 'candidate'
    check (link_state in ('candidate', 'extracted', 'confirmed', 'rejected')),
  extracted_name text,
  match_method text,
  confidence real,
  registration_match integer not null default 0 check (registration_match in (0, 1)),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists evidence_links_entity_idx on evidence_entity_links (entity_id);
create index if not exists evidence_links_evidence_idx on evidence_entity_links (evidence_id);
create unique index if not exists evidence_links_unique_confirmed
  on evidence_entity_links (evidence_id, entity_id)
  where entity_id is not null;

create table if not exists extraction_runs (
  id text primary key,
  evidence_id text not null references evidence (id),
  parser text not null,
  model text,
  model_version text,
  schema_version text not null default 'extract-v1',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  success integer not null default 0 check (success in (0, 1)),
  token_usage integer,
  raw_response text,
  validated_response text,
  error text,
  retry_count integer not null default 0
);

create index if not exists extraction_runs_evidence_idx on extraction_runs (evidence_id, started_at desc);

create table if not exists extracted_claims (
  id text primary key,
  evidence_id text not null references evidence (id),
  extraction_run_id text not null references extraction_runs (id),
  field_key text not null,
  structured_value text,
  normalized_value text,
  raw_value text,
  confidence real,
  page_number integer,
  section text,
  source_snippet text,
  parser text,
  extracted_at timestamptz not null default now(),
  validation_status text not null default 'unchecked'
    check (validation_status in ('unchecked', 'ok', 'warning', 'invalid')),
  review_state text not null default 'pending'
    check (review_state in ('pending', 'approved', 'rejected', 'edited')),
  published_state text not null default 'unpublished'
    check (published_state in ('unpublished', 'published', 'superseded')),
  reviewer_id text,
  reviewed_at timestamptz,
  edited_value text,
  edited_by text,
  edited_at timestamptz
);

create index if not exists extracted_claims_evidence_idx on extracted_claims (evidence_id);
create index if not exists extracted_claims_field_idx on extracted_claims (field_key, published_state);

create table if not exists published_claims (
  id text primary key,
  entity_id text not null references entities (id),
  field_key text not null,
  value text,
  normalized_value text,
  evidence_id text not null references evidence (id),
  claim_id text references extracted_claims (id),
  published_at timestamptz not null default now(),
  published_by text not null,
  rule_version text,
  superseded_at timestamptz,
  unique (entity_id, field_key)
);

create index if not exists published_claims_evidence_idx on published_claims (evidence_id);

create table if not exists entity_current_state (
  entity_id text primary key references entities (id),
  bee_level text,
  recognition_level text,
  scorecard_type text,
  certificate_type text,
  issue_date date,
  expiry_date date,
  verifier_agency_id text references verification_agencies (id),
  signatory_id text references signatories (id),
  registration_number text,
  evidence_id text references evidence (id),
  lifecycle_state text,
  published_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists entity_current_level_idx on entity_current_state (bee_level);
create index if not exists entity_current_expiry_idx on entity_current_state (expiry_date);
create index if not exists entity_current_agency_idx on entity_current_state (verifier_agency_id);

create table if not exists field_overrides (
  id text primary key,
  entity_id text not null references entities (id),
  field_key text not null,
  locked integer not null default 1 check (locked in (0, 1)),
  lock_reason text,
  locked_by text,
  locked_at timestamptz not null default now(),
  value text,
  unique (entity_id, field_key)
);

create table if not exists monitored_sources (
  id text primary key,
  entity_id text references entities (id),
  url text not null,
  canonical_url text,
  domain text,
  source_type text not null default 'other'
    check (source_type in (
      'company_homepage', 'transformation_page', 'procurement_page',
      'investor_relations', 'document_library', 'verification_agency',
      'accreditation_source', 'regulatory_source', 'government_source',
      'direct_evidence_url', 'other'
    )),
  enabled integer not null default 1 check (enabled in (0, 1)),
  crawl_frequency text not null default 'weekly'
    check (crawl_frequency in ('daily', 'weekly', 'monthly', 'manual')),
  crawl_config text,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_changed_at timestamptz,
  latest_http_status integer,
  latest_content_hash text,
  latest_etag text,
  latest_last_modified text,
  discovered_links_count integer not null default 0,
  error_count integer not null default 0,
  consecutive_error_count integer not null default 0,
  backoff_until timestamptz,
  last_error text,
  next_check_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sources_next_check_idx on monitored_sources (enabled, next_check_at);
create index if not exists sources_entity_idx on monitored_sources (entity_id);
create index if not exists sources_domain_idx on monitored_sources (domain);

create table if not exists source_checks (
  id text primary key,
  source_id text not null references monitored_sources (id),
  job_id text references crawler_jobs (id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  http_status integer,
  redirect_target text,
  response_type text,
  content_hash text,
  changed integer,
  links_discovered integer not null default 0,
  documents_discovered integer not null default 0,
  failure_reason text,
  retry_decision text
);

create index if not exists source_checks_source_idx on source_checks (source_id, started_at desc);

create table if not exists crawler_job_events (
  id text primary key,
  job_id text not null references crawler_jobs (id),
  at timestamptz not null default now(),
  level text not null default 'info' check (level in ('debug', 'info', 'warn', 'error')),
  message text not null,
  meta text
);

create index if not exists crawler_job_events_job_idx on crawler_job_events (job_id, at);

create table if not exists review_items (
  id text primary key,
  type text not null,
  reason text not null,
  severity text not null default 'normal'
    check (severity in ('low', 'normal', 'high', 'critical')),
  status text not null default 'pending'
    check (status in ('pending', 'in_review', 'approved', 'rejected', 'deferred')),
  entity_id text references entities (id),
  evidence_id text references evidence (id),
  job_id text references crawler_jobs (id),
  payload text,
  generated_at timestamptz not null default now(),
  reviewer_id text,
  resolved_at timestamptz,
  resolution text,
  notes text,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists review_items_status_idx on review_items (status, generated_at desc);
create index if not exists review_items_type_idx on review_items (type, status);
create unique index if not exists review_items_pending_evidence_uq
  on review_items (type, evidence_id)
  where status = 'pending' and evidence_id is not null;

create table if not exists submissions (
  id text primary key,
  type text not null
    check (type in (
      'certificate_url', 'annual_report', 'disclosure', 'correction',
      'missing_company', 'newer_evidence', 'verification', 'other'
    )),
  company_text text,
  url text,
  message text,
  disputed_field text,
  submitter_name text,
  submitter_email text,
  ip_hash text,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'spam')),
  linked_entity_id text references entities (id),
  linked_evidence_id text references evidence (id),
  admin_notes text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists submissions_status_idx on submissions (status, created_at desc);

create table if not exists automation_rules (
  id text primary key,
  version integer not null,
  name text not null,
  enabled integer not null default 0 check (enabled in (0, 1)),
  config text not null,
  created_at timestamptz not null default now(),
  created_by text
);

create unique index if not exists automation_rules_version_uq on automation_rules (version);

create table if not exists app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

create table if not exists entity_merge_events (
  id text primary key,
  survivor_id text not null references entities (id),
  absorbed_id text not null references entities (id),
  absorbed_snapshot text not null,
  created_at timestamptz not null default now(),
  created_by text,
  unmerged_at timestamptz,
  unmerged_by text,
  notes text
);

create index if not exists merge_events_survivor_idx on entity_merge_events (survivor_id);
create index if not exists merge_events_absorbed_idx on entity_merge_events (absorbed_id);

create table if not exists audit_logs (
  id text primary key,
  at timestamptz not null default now(),
  actor_type text not null,
  actor_id text,
  action text not null,
  target_type text not null,
  target_id text,
  before_state text,
  after_state text,
  reason text,
  related_evidence_id text,
  related_job_id text
);

create index if not exists audit_logs_at_idx on audit_logs (at desc);
create index if not exists audit_logs_target_idx on audit_logs (target_type, target_id);
create index if not exists audit_logs_actor_idx on audit_logs (actor_type, actor_id);

create table if not exists external_relationships (
  id text primary key,
  subject_entity_id text not null references entities (id),
  related_name text not null,
  related_entity_id text references entities (id),
  relationship_kind text not null default 'other',
  evidence_id text references evidence (id),
  is_public integer not null default 0 check (is_public in (0, 1)),
  review_state text not null default 'pending'
    check (review_state in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create table if not exists publication_events (
  id text primary key,
  entity_id text not null references entities (id),
  evidence_id text not null references evidence (id),
  event_type text not null,
  summary text not null,
  previous_evidence_id text references evidence (id),
  published_at timestamptz not null default now(),
  published_by text not null
);

create index if not exists publication_events_at_idx on publication_events (published_at desc);
create index if not exists publication_events_entity_idx on publication_events (entity_id, published_at desc);

create table if not exists admin_notes (
  id text primary key,
  target_type text not null,
  target_id text not null,
  body text not null,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists admin_notes_target_idx on admin_notes (target_type, target_id);

-- Vocabulary only (not companies, not evidence).
insert into sectors (id, slug, name, description) values
  ('sec_mining', 'mining', 'Mining', null),
  ('sec_banking', 'banking', 'Banking', null),
  ('sec_insurance', 'insurance', 'Insurance', null),
  ('sec_retail', 'retail', 'Retail', null),
  ('sec_telecoms', 'telecommunications', 'Telecommunications', null),
  ('sec_construction', 'construction', 'Construction', null),
  ('sec_logistics', 'logistics', 'Logistics', null),
  ('sec_professional', 'professional-services', 'Professional services', null),
  ('sec_government_suppliers', 'government-suppliers', 'Government suppliers', 'Only published when supported by a reviewed source.'),
  ('sec_jse', 'jse', 'JSE-listed', null)
on conflict (id) do nothing;

insert into app_settings (key, value, updated_by) values
  ('auto_publish_enabled', 'false', 'system'),
  ('confidence_threshold', '0.98', 'system'),
  ('expiring_soon_days', '90', 'system'),
  ('extraction_model', '"grok-4.5"', 'system'),
  ('crawler_user_agent', '"BEERecordBot/1.0 (public B-BBEE evidence index; +https://beerecord.example/sources)"', 'system'),
  ('bootstrap_open', 'true', 'system')
on conflict (key) do nothing;

insert into automation_rules (id, version, name, enabled, config, created_by) values
  (
    'rule_v1',
    1,
    'Conservative auto-publication',
    0,
    '{"officialCompanyDomain":true,"recognizedDocumentType":true,"minimumConfidence":0.98,"exactEntityMatch":true,"validDates":true,"noConflictingCurrentEvidence":true,"knownVerifier":false,"registrationNumberConsistency":true,"manualLockConflictMustBeFalse":true}',
    'system'
  )
on conflict (id) do nothing;
