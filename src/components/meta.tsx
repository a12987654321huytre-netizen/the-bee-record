import { Link } from "@tanstack/react-router";
import { LIFECYCLE_LABELS, EVIDENCE_TYPE_LABELS, type EvidenceType } from "@/lib/bee/constants";
import { displayOrUnknown, formatEvidenceDate, formatLevel, lifecycleLabel } from "@/lib/bee/format";
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
  return <span className="font-medium tabular-nums">{formatLevel(level)}</span>;
}

export function DateCell({
  value,
  missing = "not_found",
}: {
  value: string | Date | null | undefined;
  missing?: "unknown" | "not_disclosed" | "not_found";
}) {
  if (value == null || value === "") {
    return <span className="text-muted">{displayOrUnknown(null, missing)}</span>;
  }
  return <span className="tabular-nums">{formatEvidenceDate(value)}</span>;
}

export function Unknown({ kind = "not_found" }: { kind?: "unknown" | "not_disclosed" | "not_found" }) {
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
