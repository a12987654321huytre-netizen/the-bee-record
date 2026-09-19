import { toIsoDate } from "./dates.ts";

/** Procurement-only companies need evidence dated on or after this day to stay public. */
export const PROCUREMENT_PUBLIC_MIN_DATE = "2024-01-01";

const YEAR_IN_PATH_RE = /(?:^|[^\d])((?:201[0-9]|202[0-6]))(?:[^\d]|$)/;
const BULLETIN_YEAR_RE = /\/bulletins\/(20\d{2})\//i;

export type ProcurementDateInput = {
  issueDate?: string | Date | null;
  awardDate?: string | Date | null;
  sourceUrl?: string | null;
  title?: string | null;
};

export function inferEvidenceYear(input: ProcurementDateInput): number | null {
  const iso = toIsoDate(input.issueDate) ?? toIsoDate(input.awardDate);
  if (iso && /^\d{4}-/.test(iso)) {
    const year = Number(iso.slice(0, 4));
    if (year >= 1994 && year <= 2100) return year;
  }
  const blob = `${input.sourceUrl ?? ""} ${input.title ?? ""}`;
  const bulletin = blob.match(BULLETIN_YEAR_RE);
  if (bulletin) return Number(bulletin[1]);
  const pathYear = blob.match(YEAR_IN_PATH_RE);
  if (pathYear) return Number(pathYear[1]);
  return null;
}

export function isArchivalProcurementSource(sourceUrl: string | null | undefined, title?: string | null): boolean {
  const blob = `${sourceUrl ?? ""} ${title ?? ""}`;
  if (BULLETIN_YEAR_RE.test(blob)) {
    const year = Number(blob.match(BULLETIN_YEAR_RE)?.[1] ?? "0");
    return year < 2024;
  }
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
  const iso = toIsoDate(input.issueDate) ?? toIsoDate(input.awardDate);
  if (iso && iso >= PROCUREMENT_PUBLIC_MIN_DATE) return true;
  if (iso && iso < PROCUREMENT_PUBLIC_MIN_DATE) return false;
  const year = inferEvidenceYear(input);
  if (year != null) return year >= 2024;
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
