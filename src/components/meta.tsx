import { Link } from "@tanstack/react-router";
import { LIFECYCLE_LABELS, EVIDENCE_TYPE_LABELS, type EvidenceType } from "@/lib/bee/constants";
import { displayOrUnknown, formatEvidenceDate, formatLevel, lifecycleLabel } from "@/lib/bee/format";
import { companySummaryText } from "@/lib/bee/disclosure";
import {
  evidenceDateInput,
  latestEvidenceKind,
  LATEST_EVIDENCE_LABELS,
  sourceOrganisationLabel,
  type LatestEvidenceRow,
} from "@/lib/bee/latest-evidence";
import { resolveEvidenceDate } from "@/lib/bee/evidence-date";
import { Status } from "./ui";

export function lifecycleTone(state: string | null | undefined): "neutral" | "current" | "expired" | "warn" | "review" {
  if (state === "current" || state === "current_certificate") return "current";
  if (state === "expired" || state === "disputed" || state === "expired_certificate") return "expired";
  if (
    state === "expiring_soon" ||
    state === "superseded" ||
    state === "unknown_validity" ||
    state === "validity_unconfirmed"
  ) {
    return "warn";
  }
  if (state === "discovered") return "review";
  return "neutral";
}

export function LifecycleBadge({ state }: { state: string | null | undefined }) {
  return <Status tone={lifecycleTone(state)}>{lifecycleLabel(state)}</Status>;
}

export function EvidenceTypeLabel({ type }: { type: string }) {
  return <>{EVIDENCE_TYPE_LABELS[type as EvidenceType] ?? type}</>;
}

export function LevelCell({ level }: { level: string | null | undefined }) {
  if (!level) return <span className="text-muted">{displayOrUnknown(null, "not_stated")}</span>;
  return <span className="font-medium tabular-nums">{formatLevel(level)}</span>;
}

export function CompanySummary({
  currentLifecycle,
  currentEvidenceType,
  hasDisclosure,
  disclosureModern,
  beeLevel,
  disclosureLevel,
  latestKind,
  latestLevel,
  latestSource,
  latestDateLabel,
  expiryDateLabel,
}: {
  currentLifecycle?: string | null;
  currentEvidenceType?: string | null;
  hasDisclosure?: boolean;
  disclosureModern?: boolean | null;
  beeLevel?: string | null;
  disclosureLevel?: string | null;
  latestKind?: string | null;
  latestLevel?: string | null;
  latestSource?: string | null;
  latestDateLabel?: string | null;
  expiryDateLabel?: string | null;
}) {
  return (
    <span className="text-sm">
      {companySummaryText({
        currentLifecycle,
        currentEvidenceType,
        hasDisclosure,
        disclosureModern,
        beeLevel,
        disclosureLevel,
        latestKind,
        latestLevel,
        latestSource,
        latestDateLabel,
        expiryDateLabel,
      })}
    </span>
  );
}

export function DateCell({
  value,
  precision,
  raw,
  missing = "not_found",
}: {
  value: string | Date | null | undefined;
  precision?: string | null;
  raw?: string | null;
  missing?: "unknown" | "not_disclosed" | "not_found" | "not_stated" | "not_yet";
}) {
  if ((value == null || value === "") && !raw) {
    return <span className="text-muted">{displayOrUnknown(null, missing)}</span>;
  }
  return (
    <span className="tabular-nums">
      {formatEvidenceDate(value, precision, raw)}
    </span>
  );
}

export function latestFromDirectoryRow(row: {
  latest_evidence_id?: string | null;
  latest_evidence_type?: string | null;
  latest_lifecycle?: string | null;
  latest_level?: string | null;
  latest_date?: string | null;
  latest_date_precision?: string | null;
  latest_date_raw?: string | null;
  latest_title?: string | null;
  latest_url?: string | null;
  latest_issuer?: string | null;
  latest_agency?: string | null;
  latest_expiry?: string | null;
  latest_domain?: string | null;
  latest_created_at?: string | Date | null;
  latest_retrieved_at?: string | Date | null;
  latest_discovered_at?: string | Date | null;
  bee_level?: string | null;
  expiry_date?: string | null;
  lifecycle_state?: string | null;
  agency_name?: string | null;
  current_evidence_type?: string | null;
  disclosure_level?: string | null;
  disclosure_date?: string | null;
  disclosure_url?: string | null;
  disclosure_title?: string | null;
}): {
  kind: string;
  label: string;
  level: string | null;
  date: ReturnType<typeof resolveEvidenceDate>;
  source: string;
  sourceUrl: string | null;
  expiry: string | null;
} {
  const rowLike: LatestEvidenceRow = {
    id: row.latest_evidence_id ?? "",
    evidence_type: row.latest_evidence_type ?? row.current_evidence_type ?? "other",
    lifecycle_state: row.latest_lifecycle ?? row.lifecycle_state,
    issue_date: row.latest_date ?? row.disclosure_date,
    issue_date_precision: row.latest_date_precision,
    issue_date_raw: row.latest_date_raw,
    expiry_date: row.latest_expiry ?? row.expiry_date,
    source_url: row.latest_url ?? row.disclosure_url,
    title: row.latest_title ?? row.disclosure_title,
    document_issuer: row.latest_issuer,
    agency_name: row.latest_agency ?? row.agency_name,
    source_domain: row.latest_domain,
    reported_bee_level: row.latest_level ?? row.disclosure_level ?? row.bee_level,
    created_at: row.latest_created_at,
    retrieved_at: row.latest_retrieved_at,
    discovered_at: row.latest_discovered_at,
  };
  const date = resolveEvidenceDate(evidenceDateInput(rowLike));
  const kind = latestEvidenceKind(rowLike, date);
  return {
    kind,
    label: LATEST_EVIDENCE_LABELS[kind],
    level: rowLike.reported_bee_level ?? null,
    date,
    source: sourceOrganisationLabel(rowLike),
    sourceUrl: rowLike.source_url ?? null,
    expiry: rowLike.expiry_date ? String(rowLike.expiry_date).slice(0, 10) : null,
  };
}

export function Unknown({ kind = "not_found" }: { kind?: "unknown" | "not_disclosed" | "not_found" | "not_stated" | "not_yet" }) {
  return <span className="text-muted">{displayOrUnknown(null, kind)}</span>;
}

export function Pagination({
  page,
  pageSize,
  total,
  href,
}: {
  page: number;
  pageSize: number;
  total: number;
  href: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-6 flex items-center gap-3 text-sm">
      {page > 1 ? (
        <Link to={href(page - 1)} className="underline underline-offset-4">
          Previous
        </Link>
      ) : (
        <span className="text-muted">Previous</span>
      )}
      <span className="text-muted tabular-nums">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Link to={href(page + 1)} className="underline underline-offset-4">
          Next
        </Link>
      ) : (
        <span className="text-muted">Next</span>
      )}
    </nav>
  );
}

export { LIFECYCLE_LABELS };
