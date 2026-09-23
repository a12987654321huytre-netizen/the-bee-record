import { isDisclosureEvidence, isStatusEvidence } from "./constants.ts";
import { displayBeeLevel } from "./level.ts";
import { resolveEvidenceDate, type EvidenceDateInput, type ResolvedEvidenceDate } from "./evidence-date.ts";

export const COMPANY_DISCLOSURE_TYPES = [
  "company_disclosure",
  "company_webpage",
  "annual_report",
  "integrated_report",
  "esg_report",
  "sustainability_report",
  "transformation_report",
  "investor_document",
] as const;

export function isCompanyDisclosureType(type: string | null | undefined): boolean {
  return (COMPANY_DISCLOSURE_TYPES as readonly string[]).includes(type ?? "");
}

export type LatestEvidenceKind =
  | "current_certificate"
  | "expiring_soon"
  | "official_company_disclosure"
  | "official_procurement_disclosure"
  | "validity_unconfirmed"
  | "expired_certificate"
  | "historical_certificate"
  | "historical_procurement_disclosure"
  | "historical_disclosure"
  | "official_undated"
  | "other";

export const LATEST_EVIDENCE_LABELS: Record<LatestEvidenceKind, string> = {
  current_certificate: "Current certificate",
  expiring_soon: "Expiring soon",
  official_company_disclosure: "Official company disclosure",
  official_procurement_disclosure: "Official procurement disclosure",
  validity_unconfirmed: "Validity unconfirmed",
  expired_certificate: "Expired certificate",
  historical_certificate: "Historical certificate",
  historical_procurement_disclosure: "Historical procurement disclosure",
  historical_disclosure: "Historical disclosure",
  official_undated: "Official evidence — source date not stated",
  other: "Public evidence",
};

export type LatestEvidenceRow = {
  id: string;
  evidence_type: string;
  lifecycle_state?: string | null;
  issue_date?: string | Date | null;
  issue_date_precision?: string | null;
  issue_date_raw?: string | null;
  expiry_date?: string | Date | null;
  source_url?: string | null;
  title?: string | null;
  document_issuer?: string | null;
  agency_name?: string | null;
  source_domain?: string | null;
  reported_bee_level?: string | null;
  retrieved_at?: string | Date | null;
  discovered_at?: string | Date | null;
  created_at?: string | Date | null;
};

const RECENT_FROM = "2024-01-01";

export function latestEvidenceKind(row: LatestEvidenceRow, date?: ResolvedEvidenceDate): LatestEvidenceKind {
  const resolved = date ?? resolveEvidenceDate(evidenceDateInput(row));
  const recent = Boolean(resolved.iso && resolved.iso >= RECENT_FROM);
  if (isStatusEvidence(row.evidence_type)) {
    if (row.lifecycle_state === "current") return "current_certificate";
    if (row.lifecycle_state === "expiring_soon") return "expiring_soon";
    if (row.lifecycle_state === "unknown_validity") return "validity_unconfirmed";
    if (row.lifecycle_state === "expired") return "expired_certificate";
    return "historical_certificate";
  }
  if (isDisclosureEvidence(row.evidence_type)) {
    if (!resolved.stated) return "official_undated";
    return recent ? "official_procurement_disclosure" : "historical_procurement_disclosure";
  }
  if (isCompanyDisclosureType(row.evidence_type)) {
    if (!resolved.stated) return "official_undated";
    return recent ? "official_company_disclosure" : "historical_disclosure";
  }
  if (!resolved.stated) return "official_undated";
  return recent ? "official_company_disclosure" : "historical_disclosure";
}

/** Directory-summary rank. Higher wins. Chronology on the company page is independent. */
export function latestEvidenceRank(row: LatestEvidenceRow): number {
  const kind = latestEvidenceKind(row);
  switch (kind) {
    case "current_certificate":
      return 100;
    case "expiring_soon":
      return 90;
    case "official_company_disclosure":
      return 80;
    case "official_procurement_disclosure":
      return 70;
    case "validity_unconfirmed":
      return 60;
    case "expired_certificate":
    case "historical_certificate":
      return 50;
    case "historical_procurement_disclosure":
    case "historical_disclosure":
      return 40;
    case "official_undated":
      return 35;
    default:
      return 30;
  }
}

export function selectLatestPublicEvidence<T extends LatestEvidenceRow>(rows: T[]): T | null {
  if (!rows.length) return null;
  return [...rows].sort((a, b) => {
    const rank = latestEvidenceRank(b) - latestEvidenceRank(a);
    if (rank !== 0) return rank;
    const da = resolveEvidenceDate(evidenceDateInput(a)).iso ?? "";
    const db = resolveEvidenceDate(evidenceDateInput(b)).iso ?? "";
    if (da !== db) return db.localeCompare(da);
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  })[0] ?? null;
}

export function evidenceDateInput(row: LatestEvidenceRow): EvidenceDateInput {
  return {
    issueDate: row.issue_date,
    issueDateRaw: row.issue_date_raw,
    precision: row.issue_date_precision,
    sourceUrl: row.source_url,
    title: row.title,
    createdAt: row.created_at,
    retrievedAt: row.retrieved_at,
    discoveredAt: row.discovered_at,
  };
}

export function sourceOrganisationLabel(row: {
  document_issuer?: string | null;
  agency_name?: string | null;
  source_domain?: string | null;
  source_url?: string | null;
  evidence_type?: string | null;
}): string {
  if (row.agency_name?.trim()) return row.agency_name.trim();
  const issuer = row.document_issuer?.trim();
  if (issuer && !/^https?:/i.test(issuer) && !/^[a-z0-9.-]+$/i.test(issuer)) return issuer;
  if (isCompanyDisclosureType(row.evidence_type) || row.evidence_type === "company_webpage") {
    return "Official company disclosure";
  }
  if (issuer && !/^https?:/i.test(issuer)) return issuer;
  const host = row.source_domain?.replace(/^www\./, "") ?? null;
  if (host && !host.includes("/") && host.includes(".")) {
    return host;
  }
  return issuer || "Source not named";
}

export function latestEvidenceSummaryText(row: LatestEvidenceRow): string {
  const date = resolveEvidenceDate(evidenceDateInput(row));
  const kind = latestEvidenceKind(row, date);
  const label = LATEST_EVIDENCE_LABELS[kind];
  const level = displayBeeLevel(row.reported_bee_level);
  const source = sourceOrganisationLabel(row);
  const when = date.stated ? date.label : null;
  if (kind === "current_certificate" || kind === "expiring_soon") {
    const expiry = row.expiry_date ? `expires ${formatExpiry(row.expiry_date)}` : null;
    const bits = [level, label, row.agency_name ?? source, expiry ?? when].filter(Boolean);
    return bits.join(" · ");
  }
  const bits = [level, label, source, when].filter(Boolean);
  return bits.join(" · ");
}

function formatExpiry(value: string | Date | null | undefined): string {
  const iso = typeof value === "string" ? value.slice(0, 10) : value instanceof Date ? value.toISOString().slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return String(value ?? "");
  const months = MONTH_NAMES_SHORT;
  return `${Number(iso.slice(8, 10))} ${months[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

const MONTH_NAMES_SHORT = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const LATEST_EVIDENCE_SQL_RANK = `
case
  when ev.evidence_type in ('bee_certificate','sworn_affidavit') and ev.lifecycle_state = 'current' then 100
  when ev.evidence_type in ('bee_certificate','sworn_affidavit') and ev.lifecycle_state = 'expiring_soon' then 90
  when ev.evidence_type in ('company_disclosure','annual_report','integrated_report','esg_report','sustainability_report','transformation_report','investor_document')
       and ev.issue_date is not null and ev.issue_date >= '2024-01-01' then 80
  when ev.evidence_type = 'government_procurement_disclosure'
       and ev.issue_date is not null and ev.issue_date >= '2024-01-01' then 70
  when ev.evidence_type in ('bee_certificate','sworn_affidavit') and ev.lifecycle_state = 'unknown_validity' then 60
  when ev.evidence_type in ('bee_certificate','sworn_affidavit') then 50
  when ev.evidence_type = 'government_procurement_disclosure' then 40
  else 30
end`;
