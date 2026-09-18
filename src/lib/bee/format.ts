import { LIFECYCLE_LABELS, PUBLIC_STATE_LABELS, UNKNOWN_LABELS, EVIDENCE_TYPE_LABELS, type EvidenceType } from "./constants.ts";
import { formatDisplayDate } from "./dates.ts";
import { displayBeeLevel } from "./level.ts";

export function unknown(kind: keyof typeof UNKNOWN_LABELS = "not_found"): string {
  return UNKNOWN_LABELS[kind];
}

export function displayOrUnknown(
  value: string | null | undefined,
  kind: keyof typeof UNKNOWN_LABELS = "not_found",
): string {
  const v = value?.trim();
  return v ? v : unknown(kind);
}

export function publicStateLabel(value: string | null | undefined, missing: keyof typeof UNKNOWN_LABELS = "not_found"): string {
  const v = value?.trim();
  if (!v) return unknown(missing);
  if (LIFECYCLE_LABELS[v]) return LIFECYCLE_LABELS[v];
  if (PUBLIC_STATE_LABELS[v]) return PUBLIC_STATE_LABELS[v];
  if (EVIDENCE_TYPE_LABELS[v as EvidenceType]) return EVIDENCE_TYPE_LABELS[v as EvidenceType];
  if (!/[_\-]/.test(v)) return v;
  return v
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function lifecycleLabel(state: string | null | undefined): string {
  if (!state) return unknown("unknown");
  return LIFECYCLE_LABELS[state] ?? publicStateLabel(state, "unknown");
}

export function formatLevel(level: string | null | undefined): string {
  return displayBeeLevel(level) ?? unknown("not_found");
}

export function formatWhen(iso: string | Date | null | undefined): string {
  if (iso == null || iso === "") return unknown("unknown");
  const s = iso instanceof Date ? iso.toISOString() : String(iso);
  if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) return formatDisplayDate(s.slice(0, 10));
  return s;
}

export function formatEvidenceDate(iso: string | Date | null | undefined): string {
  if (iso == null || iso === "") return unknown("not_found");
  return formatWhen(iso);
}

export function formatScorecard(value: string | null | undefined): string {
  const v = value?.trim();
  if (!v) return unknown("not_found");
  if (/^(generic|qse|eme|specialised|specialized)$/i.test(v)) {
    return v.toLowerCase() === "eme" || v.toLowerCase() === "qse" ? v.toUpperCase() : v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
  }
  return v;
}

export function shortId(id: string): string {
  const parts = id.split("_");
  const rest = parts.slice(1).join("_");
  return rest ? `${parts[0]}_${rest.slice(0, 8)}` : id.slice(0, 12);
}

export function truncate(value: string, n = 80): string {
  if (value.length <= n) return value;
  return `${value.slice(0, n - 1)}…`;
}

export function relativeTime(iso: string | Date | null | undefined, now = Date.now()): string {
  if (iso == null || iso === "") return unknown("unknown");
  const t = iso instanceof Date ? iso.getTime() : new Date(iso).getTime();
  if (Number.isNaN(t)) return String(iso);
  const diff = now - t;
  const minutes = Math.round(diff / 60000);
  if (Math.abs(minutes) < 1) return "just now";
  if (Math.abs(minutes) < 60) return `${Math.abs(minutes)}m ${minutes < 0 ? "from now" : "ago"}`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return `${Math.abs(hours)}h ${hours < 0 ? "from now" : "ago"}`;
  const days = Math.round(hours / 24);
  return `${Math.abs(days)}d ${days < 0 ? "from now" : "ago"}`;
}
