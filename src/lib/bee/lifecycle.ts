import { STATUS_EVIDENCE_TYPES, RECOGNIZED_DOCUMENT_TYPES } from "./constants.ts";
import { compareIso, expiryStatus, toIsoDate } from "./dates.ts";

export type LifecycleEvidence = {
  id: string;
  evidence_type: string;
  issue_date: string | Date | null;
  expiry_date: string | Date | null;
  discovered_at: string | Date | null;
  publication_state: string;
  bee_level?: string | null;
};

export type LifecycleDecision = {
  evidenceId: string;
  lifecycle: "current" | "historical" | "superseded" | "expired" | "expiring_soon" | "disputed";
};

export type ClassifyResult = {
  decisions: LifecycleDecision[];
  /** Live current (or expiring-soon) evidence, if one can be chosen. */
  currentEvidenceId: string | null;
  /** Evidence that should drive the entity's displayed fields (may be expired). */
  supportingEvidenceId: string | null;
  disputed: boolean;
  reason: string | null;
};

function isStatus(type: string): boolean {
  return (STATUS_EVIDENCE_TYPES as readonly string[]).includes(type);
}

function isRecognized(type: string): boolean {
  return (RECOGNIZED_DOCUMENT_TYPES as readonly string[]).includes(type);
}

function stamp(e: LifecycleEvidence): string {
  return [
    toIsoDate(e.issue_date) ?? "0000-00-00",
    toIsoDate(e.expiry_date) ?? "0000-00-00",
    toIsoDate(e.discovered_at) ?? "0000-00-00",
    e.id,
  ].join("#");
}

function sortNewestFirst(a: LifecycleEvidence, b: LifecycleEvidence): number {
  const cmp = stamp(b).localeCompare(stamp(a));
  if (cmp !== 0) return cmp;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function isExpired(e: LifecycleEvidence, now: string): boolean {
  const expiry = toIsoDate(e.expiry_date);
  return Boolean(expiry && expiry < now);
}

/**
 * Classify published evidence for a single legal entity.
 * Never looks at other entities. Status certificates compete for CURRENT;
 * older live certificates become superseded; expired certificates stay expired.
 */
export function classifyPublishedEvidence(
  rows: LifecycleEvidence[],
  now: string,
  expiringSoonDays: number,
): ClassifyResult {
  const published = rows.filter((r) => r.publication_state === "published");
  const decisions = new Map<string, LifecycleDecision["lifecycle"]>();

  if (!published.length) {
    return {
      decisions: [],
      currentEvidenceId: null,
      supportingEvidenceId: null,
      disputed: false,
      reason: null,
    };
  }

  const hasStatus = published.some((r) => isStatus(r.evidence_type));
  const pool = hasStatus
    ? published.filter((r) => isStatus(r.evidence_type))
    : published.filter((r) => isRecognized(r.evidence_type));
  const effectivePool = pool.length ? pool : published;

  for (const row of published) {
    if (isExpired(row, now)) decisions.set(row.id, "expired");
  }

  const livePool = effectivePool.filter((r) => decisions.get(r.id) !== "expired").sort(sortNewestFirst);
  let currentEvidenceId: string | null = null;
  let disputed = false;
  let reason: string | null = null;

  if (livePool.length >= 2) {
    const top = livePool[0]!;
    const next = livePool[1]!;
    const topIssue = toIsoDate(top.issue_date);
    const nextIssue = toIsoDate(next.issue_date);
    if (!topIssue && !nextIssue) {
      disputed = true;
      reason = "Multiple live certificates have no issue date; current record was not guessed.";
    } else if (topIssue && nextIssue && topIssue === nextIssue) {
      const topExpiry = toIsoDate(top.expiry_date);
      const nextExpiry = toIsoDate(next.expiry_date);
      if (topExpiry && nextExpiry && topExpiry !== nextExpiry) {
        currentEvidenceId = compareIso(topExpiry, nextExpiry) >= 0 ? top.id : next.id;
      } else if (top.bee_level && next.bee_level && top.bee_level !== next.bee_level) {
        disputed = true;
        reason = `Multiple live certificates share issue date ${topIssue} with conflicting B-BBEE levels.`;
      } else {
        disputed = true;
        reason = `Multiple live certificates share issue date ${topIssue}; current record was not guessed.`;
      }
    } else {
      currentEvidenceId = top.id;
    }
  } else if (livePool.length === 1) {
    currentEvidenceId = livePool[0]!.id;
  }

  if (disputed) {
    for (const row of livePool) decisions.set(row.id, "disputed");
    currentEvidenceId = null;
  } else if (currentEvidenceId) {
    const current = published.find((r) => r.id === currentEvidenceId);
    const life = expiryStatus(current?.expiry_date ?? null, "current", expiringSoonDays, now);
    decisions.set(currentEvidenceId, life === "expiring_soon" ? "expiring_soon" : "current");
    for (const row of effectivePool) {
      if (row.id === currentEvidenceId) continue;
      if (decisions.get(row.id) === "expired") continue;
      decisions.set(row.id, "superseded");
    }
  }

  for (const row of published) {
    if (decisions.has(row.id)) continue;
    decisions.set(row.id, isExpired(row, now) ? "expired" : "historical");
  }

  const supportingPool = [...effectivePool].sort(sortNewestFirst);
  const supportingEvidenceId = currentEvidenceId ?? supportingPool[0]?.id ?? published[0]?.id ?? null;

  return {
    decisions: [...decisions.entries()].map(([evidenceId, lifecycle]) => ({ evidenceId, lifecycle })),
    currentEvidenceId,
    supportingEvidenceId,
    disputed,
    reason,
  };
}

export function mergeRepairClaims(input: {
  previous: Array<{
    field_key: string;
    raw_value: string | null;
    normalized_value: string | null;
    structured_value?: string | null;
    edited_value: string | null;
    confidence: number | null;
    source_snippet: string | null;
    parser: string | null;
    section: string | null;
    edited_by: string | null;
    edited_at: string | null;
    published_state: string;
    review_state: string;
    page_number?: number | null;
  }>;
  extracted: Array<{
    field: string;
    raw_value: string;
    normalized_value: string | null;
    confidence: number;
    page: number | null;
    locator: string | null;
    warning: string | null;
  }>;
  lockedFields: Set<string>;
  entityReg?: string | null;
  evidencePublished?: boolean;
}): {
  claims: Array<{
    field_key: string;
    raw_value: string | null;
    normalized_value: string | null;
    confidence: number | null;
    source_snippet: string | null;
    parser: string | null;
    section: string | null;
    edited_value: string | null;
    edited_by: string | null;
    edited_at: string | null;
    published_state: string;
    review_state: string;
    page_number: number | null;
  }>;
  conflicts: Array<{ field: string; previous: string; incoming: string }>;
} {
  const prevByField = new Map(input.previous.map((c) => [c.field_key, c]));
  const extractedByField = new Map(input.extracted.map((c) => [c.field, c]));
  const fields = new Set([...prevByField.keys(), ...extractedByField.keys()]);
  const conflicts: Array<{ field: string; previous: string; incoming: string }> = [];
  const claims = [];

  const working = (row: { edited_value: string | null; normalized_value: string | null; structured_value?: string | null; raw_value: string | null }) =>
    row.edited_value?.trim() || row.normalized_value || row.structured_value || row.raw_value || null;

  for (const field of fields) {
    const prev = prevByField.get(field);
    const incoming = extractedByField.get(field);
    const locked = input.lockedFields.has(field);

    if (locked && prev) {
      claims.push({
        field_key: field,
        raw_value: prev.raw_value,
        normalized_value: prev.normalized_value,
        confidence: prev.confidence,
        source_snippet: prev.source_snippet,
        parser: prev.parser,
        section: prev.section,
        edited_value: prev.edited_value,
        edited_by: prev.edited_by,
        edited_at: prev.edited_at,
        published_state: prev.published_state,
        review_state: prev.review_state,
        page_number: prev.page_number ?? null,
      });
      if (incoming) {
        const incomingVal = incoming.normalized_value ?? incoming.raw_value;
        const prevVal = working(prev);
        if (prevVal && incomingVal && prevVal !== incomingVal) {
          conflicts.push({ field, previous: prevVal, incoming: incomingVal });
        }
      }
      continue;
    }

    if (prev?.edited_value?.trim()) {
      claims.push({
        field_key: field,
        raw_value: prev.raw_value,
        normalized_value: prev.normalized_value,
        confidence: prev.confidence,
        source_snippet: prev.source_snippet,
        parser: prev.parser,
        section: prev.section,
        edited_value: prev.edited_value,
        edited_by: prev.edited_by,
        edited_at: prev.edited_at,
        published_state: prev.published_state,
        review_state: "edited",
        page_number: prev.page_number ?? null,
      });
      continue;
    }

    const prevVal = prev ? working(prev) : null;
    const incomingVal = incoming ? incoming.normalized_value ?? incoming.raw_value : null;

    if (field === "registration_number" && input.entityReg) {
      if (incomingVal && incomingVal === input.entityReg) {
        claims.push({
          field_key: field,
          raw_value: incoming!.raw_value,
          normalized_value: incoming!.normalized_value,
          confidence: incoming!.confidence,
          source_snippet: incoming!.locator,
          parser: "repair/v1",
          section: incoming!.warning,
          edited_value: null,
          edited_by: null,
          edited_at: null,
          published_state: input.evidencePublished ? "published" : (prev?.published_state ?? "unpublished"),
          review_state: input.evidencePublished ? "approved" : "pending",
          page_number: incoming!.page,
        });
        continue;
      }
      if (prevVal && prevVal === input.entityReg) {
        claims.push({
          field_key: field,
          raw_value: prev!.raw_value,
          normalized_value: prev!.normalized_value,
          confidence: prev!.confidence,
          source_snippet: prev!.source_snippet,
          parser: prev!.parser,
          section: prev!.section,
          edited_value: prev!.edited_value,
          edited_by: prev!.edited_by,
          edited_at: prev!.edited_at,
          published_state: prev!.published_state,
          review_state: prev!.review_state,
          page_number: prev!.page_number ?? null,
        });
        if (incomingVal && incomingVal !== prevVal) {
          conflicts.push({ field, previous: prevVal, incoming: incomingVal });
        }
        continue;
      }
      if (incomingVal && incomingVal !== input.entityReg) {
        conflicts.push({ field, previous: input.entityReg, incoming: incomingVal });
        claims.push({
          field_key: field,
          raw_value: incoming!.raw_value,
          normalized_value: incoming!.normalized_value,
          confidence: incoming!.confidence,
          source_snippet: incoming!.locator,
          parser: "repair/v1",
          section: incoming!.warning ?? "Extracted registration number does not match the linked entity.",
          edited_value: null,
          edited_by: null,
          edited_at: null,
          published_state: "unpublished",
          review_state: "pending",
          page_number: incoming!.page,
        });
        continue;
      }
    }

    if (prevVal && incomingVal && prevVal !== incomingVal) {
      conflicts.push({ field, previous: prevVal, incoming: incomingVal });
      claims.push({
        field_key: field,
        raw_value: prev!.raw_value,
        normalized_value: prev!.normalized_value,
        confidence: prev!.confidence,
        source_snippet: prev!.source_snippet,
        parser: prev!.parser,
        section: prev!.section,
        edited_value: prev!.edited_value,
        edited_by: prev!.edited_by,
        edited_at: prev!.edited_at,
        published_state: prev!.published_state,
        review_state: prev!.review_state,
        page_number: prev!.page_number ?? null,
      });
      continue;
    }

    if (incoming && !prevVal) {
      claims.push({
        field_key: field,
        raw_value: incoming.raw_value,
        normalized_value: incoming.normalized_value,
        confidence: incoming.confidence,
        source_snippet: incoming.locator,
        parser: "repair/v1",
        section: incoming.warning,
        edited_value: null,
        edited_by: null,
        edited_at: null,
        published_state: input.evidencePublished ? "published" : "unpublished",
        review_state: input.evidencePublished ? "approved" : "pending",
        page_number: incoming.page,
      });
      continue;
    }

    if (prev) {
      claims.push({
        field_key: field,
        raw_value: prev.raw_value,
        normalized_value: prev.normalized_value,
        confidence: prev.confidence,
        source_snippet: prev.source_snippet,
        parser: prev.parser,
        section: prev.section,
        edited_value: prev.edited_value,
        edited_by: prev.edited_by,
        edited_at: prev.edited_at,
        published_state: prev.published_state,
        review_state: prev.review_state,
        page_number: prev.page_number ?? null,
      });
    }
  }

  return { claims, conflicts };
}
