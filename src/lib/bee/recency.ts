import { isCompanyDisclosureType, latestEvidenceKind, selectLatestPublicEvidence, type LatestEvidenceKind, type LatestEvidenceRow } from "./latest-evidence.ts";
import { isDisclosureEvidence, isStatusEvidence } from "./constants.ts";
import { toIsoDate } from "./dates.ts";
import { resolveEvidenceDate, type EvidenceDateInput } from "./evidence-date.ts";

/** Procurement-only companies need evidence dated on or after this day to stay public. */
export const PROCUREMENT_PUBLIC_MIN_DATE = "2024-01-01";

export type ProcurementDateInput = EvidenceDateInput & {
  awardDate?: string | Date | null;
};

export type DateEligibility = "modern" | "pre2024" | "unknown";

/**
 * Eligibility date for a public-company page.
 * Never uses created_at / discovered_at / retrieved_at / indexed_at.
 * Unknown / "Not stated in source" is not treated as 2024+.
 */
export function evidenceDateEligibility(input: ProcurementDateInput): DateEligibility {
  const resolved = resolveEvidenceDate(input);
  if (resolved.iso && resolved.iso >= PROCUREMENT_PUBLIC_MIN_DATE) return "modern";
  if (resolved.year != null && resolved.year >= 2024) return "modern";
  if (resolved.stated) return "pre2024";
  return "unknown";
}

export function inferEvidenceYear(input: ProcurementDateInput): number | null {
  return resolveEvidenceDate(input).year;
}

export function isArchivalProcurementSource(sourceUrl: string | null | undefined, title?: string | null): boolean {
  const year = inferEvidenceYear({ sourceUrl, title });
  if (year != null && year < 2024) return true;
  return false;
}

/**
 * A procurement disclosure can create or retain a public company page only when
 * its evidence date is stated and is 1 January 2024 or later.
 * Unknown date ≠ modern evidence.
 */
export function isModernProcurementEvidence(input: ProcurementDateInput): boolean {
  return evidenceDateEligibility(input) === "modern";
}

export function procurementQualifiesForPublicEntity(
  rows: ProcurementDateInput[] | null | undefined,
): boolean {
  return Boolean(rows?.some((row) => isModernProcurementEvidence(row)));
}

export function disclosureIsHistorical(input: ProcurementDateInput): boolean {
  return !isModernProcurementEvidence(input);
}

export function evidenceYearLabel(input: ProcurementDateInput): string | null {
  const year = inferEvidenceYear(input);
  return year ? String(year) : null;
}

export type EligibilityEvidence = {
  id?: string;
  type: string;
  lifecycle?: string | null;
} & ProcurementDateInput;

/**
 * Current / expiring-soon certificates qualify regardless of issue date.
 * Every other evidence type qualifies only with a stated 2024-01-01+ source date.
 */
export function evidenceQualifiesForPublicEntity(input: EligibilityEvidence): boolean {
  if (isStatusEvidence(input.type) && (input.lifecycle === "current" || input.lifecycle === "expiring_soon")) {
    return true;
  }
  return evidenceDateEligibility(input) === "modern";
}

export type EligibilityBucket =
  | "keep_qualifying_latest"
  | "keep_has_newer"
  | "unpublish_pre2024"
  | "keep_other_reason"
  | "unpublish_unknown";

export type EligibilityResult = {
  bucket: EligibilityBucket;
  qualifies: boolean;
  latestKind: LatestEvidenceKind | null;
  latestIsHistorical: boolean;
  directoryHistoricalLatest: boolean;
  qualifyingCount: number;
  unknownCount: number;
  pre2024Count: number;
  modernCount: number;
  currentCertificate: boolean;
  needsReview: boolean;
  reason: string;
};

const HISTORICAL_KINDS = new Set<LatestEvidenceKind>([
  "historical_procurement_disclosure",
  "historical_disclosure",
  "historical_certificate",
  "expired_certificate",
]);

function toLatestRow(ev: EligibilityEvidence, index: number): LatestEvidenceRow {
  return {
    id: ev.id ?? `ev-${index}`,
    evidence_type: ev.type,
    lifecycle_state: ev.lifecycle,
    issue_date: ev.issueDate,
    issue_date_precision: ev.precision,
    issue_date_raw: ev.issueDateRaw,
    source_url: ev.sourceUrl,
    title: ev.title,
    created_at: ev.createdAt,
    retrieved_at: ev.retrievedAt,
    discovered_at: ev.discoveredAt,
  };
}

/** Approximate the directory SQL rank so we can audit the “historical disclosure” filter. */
export function directoryLatestRank(ev: EligibilityEvidence): number {
  const issue = toIsoDate(ev.issueDate);
  if (isStatusEvidence(ev.type) && ev.lifecycle === "current") return 100;
  if (isStatusEvidence(ev.type) && ev.lifecycle === "expiring_soon") return 90;
  if (isCompanyDisclosureType(ev.type) && issue && issue >= PROCUREMENT_PUBLIC_MIN_DATE) return 80;
  if (isDisclosureEvidence(ev.type) && issue && issue >= PROCUREMENT_PUBLIC_MIN_DATE) return 70;
  if (isStatusEvidence(ev.type) && ev.lifecycle === "unknown_validity") return 60;
  if (isStatusEvidence(ev.type)) return 50;
  if (isDisclosureEvidence(ev.type)) return 40;
  return 30;
}

export function classifyEntityEligibility(evidence: EligibilityEvidence[] | null | undefined): EligibilityResult {
  const rows = evidence ?? [];
  let modernCount = 0;
  let pre2024Count = 0;
  let unknownCount = 0;
  let qualifyingCount = 0;
  let currentCertificate = false;

  for (const ev of rows) {
    const status = evidenceDateEligibility(ev);
    if (status === "modern") modernCount += 1;
    else if (status === "pre2024") pre2024Count += 1;
    else unknownCount += 1;
    if (evidenceQualifiesForPublicEntity(ev)) {
      qualifyingCount += 1;
      if (isStatusEvidence(ev.type) && (ev.lifecycle === "current" || ev.lifecycle === "expiring_soon")) {
        currentCertificate = true;
      }
    }
  }

  const latest = rows.length ? selectLatestPublicEvidence(rows.map(toLatestRow)) : null;
  const latestKind = latest ? latestEvidenceKind(latest) : null;
  const latestIsHistorical = Boolean(latestKind && HISTORICAL_KINDS.has(latestKind));

  const directoryLatest = rows.length
    ? [...rows].sort((a, b) => {
        const rank = directoryLatestRank(b) - directoryLatestRank(a);
        if (rank !== 0) return rank;
        const da = toIsoDate(a.issueDate) ?? "";
        const db = toIsoDate(b.issueDate) ?? "";
        if (da !== db) return db.localeCompare(da);
        return (a.id ?? "") < (b.id ?? "") ? 1 : -1;
      })[0]
    : null;
  const directoryHistoricalLatest = Boolean(
    directoryLatest &&
      (isDisclosureEvidence(directoryLatest.type) || isCompanyDisclosureType(directoryLatest.type)) &&
      evidenceDateEligibility(directoryLatest) !== "modern",
  );

  const qualifies = qualifyingCount > 0;
  const needsReview = !qualifies && unknownCount > 0;

  if (qualifies) {
    if (directoryHistoricalLatest || latestIsHistorical) {
      return {
        bucket: "keep_has_newer",
        qualifies,
        latestKind,
        latestIsHistorical,
        directoryHistoricalLatest,
        qualifyingCount,
        unknownCount,
        pre2024Count,
        modernCount,
        currentCertificate,
        needsReview: false,
        reason: "Historical record is the directory latest, but 2024+ or current-certificate evidence also exists.",
      };
    }
    return {
      bucket: "keep_qualifying_latest",
      qualifies,
      latestKind,
      latestIsHistorical,
      directoryHistoricalLatest,
      qualifyingCount,
      unknownCount,
      pre2024Count,
      modernCount,
      currentCertificate,
      needsReview: false,
      reason: currentCertificate
        ? "Current or expiring-soon certificate."
        : "Has stated 2024–2026 qualifying evidence.",
    };
  }

  if (rows.length === 0) {
    return {
      bucket: "unpublish_unknown",
      qualifies: false,
      latestKind,
      latestIsHistorical,
      directoryHistoricalLatest,
      qualifyingCount,
      unknownCount,
      pre2024Count,
      modernCount,
      currentCertificate,
      needsReview: true,
      reason: "No published evidence.",
    };
  }

  if (unknownCount > 0 && pre2024Count === 0) {
    return {
      bucket: "unpublish_unknown",
      qualifies: false,
      latestKind,
      latestIsHistorical,
      directoryHistoricalLatest,
      qualifyingCount,
      unknownCount,
      pre2024Count,
      modernCount,
      currentCertificate,
      needsReview: true,
      reason: "Only evidence has unknown / not-stated-in-source dates. Unknown date is not treated as 2024+.",
    };
  }

  return {
    bucket: "unpublish_pre2024",
    qualifies: false,
    latestKind,
    latestIsHistorical,
    directoryHistoricalLatest,
    qualifyingCount,
    unknownCount,
    pre2024Count,
    modernCount,
    currentCertificate,
    needsReview,
    reason:
      unknownCount > 0
        ? "No 2024+ qualifying evidence. Remaining records are pre-2024 or undated."
        : "Only published evidence is dated before 1 January 2024.",
  };
}

export { toIsoDate };
