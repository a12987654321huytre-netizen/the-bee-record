import { toIsoDate } from "./dates.ts";
import { resolveEvidenceDate, type EvidenceDateInput } from "./evidence-date.ts";

/** Procurement-only companies need evidence dated on or after this day to stay public. */
export const PROCUREMENT_PUBLIC_MIN_DATE = "2024-01-01";

export type ProcurementDateInput = EvidenceDateInput & {
  awardDate?: string | Date | null;
};

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
 * its evidence date is 1 January 2024 or later, or it comes from a currently
 * maintained awarded-tender listing whose URL is not an archival yeared file.
 */
export function isModernProcurementEvidence(input: ProcurementDateInput): boolean {
  const resolved = resolveEvidenceDate(input);
  if (resolved.iso) return resolved.iso >= PROCUREMENT_PUBLIC_MIN_DATE;
  if (resolved.year != null) return resolved.year >= 2024;
  return !isArchivalProcurementSource(input.sourceUrl, input.title);
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

export { toIsoDate };
