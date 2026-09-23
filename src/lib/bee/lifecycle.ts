import { STATUS_EVIDENCE_TYPES, RECOGNIZED_DOCUMENT_TYPES, isDisclosureEvidence } from "./constants.ts";
import { isCompanyDisclosureType } from "./latest-evidence.ts";
import { canonicalFieldKey, isPublicClaimValue } from "./claim-quality.ts";
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
  lifecycle: "current" | "historical" | "superseded" | "expired" | "expiring_soon" | "disputed" | "unknown_validity";
};

export type ClassifyResult = {
  decisions: LifecycleDecision[];
  /** Live current (or expiring-soon) evidence, if one can be chosen. */
  currentEvidenceId: string | null;
  /** Evidence that should drive the entity's displayed certificate fields (may be expired). */
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

function hasPresentValidity(e: LifecycleEvidence, now: string): boolean {
  const expiry = toIsoDate(e.expiry_date);
  return Boolean(expiry && expiry >= now);
}

/**
 * Classify published evidence for a single legal entity.
 * Never looks at other entities. Status certificates compete for CURRENT
 * only when present validity is positively established (explicit expiry that
 * has not passed). Missing expiry is Validity unconfirmed, not Current.
 * Official procurement disclosures never compete for current certificate status.
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

  const disclosures = published.filter(
    (r) => isDisclosureEvidence(r.evidence_type) || isCompanyDisclosureType(r.evidence_type),
  );
  const certificateClass = published.filter(
    (r) => !isDisclosureEvidence(r.evidence_type) && !isCompanyDisclosureType(r.evidence_type),
  );

  for (const row of disclosures) {
    decisions.set(row.id, "historical");
  }

  if (!certificateClass.length) {
    return {
      decisions: [...decisions.entries()].map(([evidenceId, lifecycle]) => ({ evidenceId, lifecycle })),
      currentEvidenceId: null,
      supportingEvidenceId: null,
      disputed: false,
      reason: null,
    };
  }

  const hasStatus = certificateClass.some((r) => isStatus(r.evidence_type));
  const pool = hasStatus
    ? certificateClass.filter((r) => isStatus(r.evidence_type))
    : certificateClass.filter((r) => isRecognized(r.evidence_type));
  const effectivePool = pool.length ? pool : certificateClass;
  const competingIds = new Set(effectivePool.map((r) => r.id));

  for (const row of certificateClass) {
    if (isExpired(row, now)) decisions.set(row.id, "expired");
    else if (!hasPresentValidity(row, now) && (isStatus(row.evidence_type) || competingIds.has(row.id))) {
      // Current requires positive present validity. Missing expiry is not current,
      // including non-certificate documents that would otherwise win by fallback.
      decisions.set(row.id, "unknown_validity");
    }
  }

  const livePool = effectivePool
    .filter((r) => hasPresentValidity(r, now))
    .filter((r) => {
      const state = decisions.get(r.id);
      return state !== "expired" && state !== "unknown_validity";
    })
    .sort(sortNewestFirst);
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
    if (!current || !hasPresentValidity(current, now)) {
      if (current) decisions.set(current.id, "unknown_validity");
      currentEvidenceId = null;
    } else {
      const life = expiryStatus(current.expiry_date, "current", expiringSoonDays, now);
      decisions.set(currentEvidenceId, life === "expiring_soon" ? "expiring_soon" : "current");
      for (const row of effectivePool) {
        if (row.id === currentEvidenceId) continue;
        if (decisions.get(row.id) === "expired") continue;
        decisions.set(row.id, "superseded");
      }
    }
  }

  for (const row of certificateClass) {
    if (decisions.has(row.id)) continue;
    decisions.set(row.id, isExpired(row, now) ? "expired" : "historical");
  }

  const supportingPool = [...effectivePool].sort(sortNewestFirst);
  const supportingEvidenceId = currentEvidenceId ?? supportingPool[0]?.id ?? null;

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
  linkedName?: string | null;
  linkedAliases?: string[];
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

    let prevVal = prev ? working(prev) : null;
    let incomingVal = incoming ? incoming.normalized_value ?? incoming.raw_value : null;
    const linked = { canonicalName: input.linkedName, aliases: input.linkedAliases };
    const fieldKey = canonicalFieldKey(field);
    if (prevVal && !isPublicClaimValue(fieldKey, prevVal, linked)) prevVal = null;
    if (incomingVal && !isPublicClaimValue(fieldKey, incomingVal, linked)) incomingVal = null;

    if (field === "expiry_date" && prevVal && incomingVal && prevVal !== incomingVal) {
      const issueIncoming = extractedByField.get("issue_date");
      const issuePrev = prevByField.get("issue_date");
      const issueVal =
        (issueIncoming ? issueIncoming.normalized_value ?? issueIncoming.raw_value : null) ||
        (issuePrev ? working(issuePrev) : null);
      if (issueVal && prevVal === issueVal && incomingVal !== issueVal) {
        claims.push({
          field_key: field,
          raw_value: incoming!.raw_value,
          normalized_value: incoming!.normalized_value,
          confidence: incoming!.confidence,
          source_snippet: incoming!.locator,
          parser: "repair/v1",
          section: incoming!.warning ?? "Replaced same-day expiry with a distinct extracted expiry date.",
          edited_value: null,
          edited_by: null,
          edited_at: null,
          published_state: input.evidencePublished ? "published" : "unpublished",
          review_state: input.evidencePublished ? "approved" : "pending",
          page_number: incoming!.page,
        });
        continue;
      }
    }

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

    if (!input.evidencePublished && (field === "issue_date" || field === "expiry_date") && incoming && incomingVal) {
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
        published_state: "unpublished",
        review_state: "pending",
        page_number: incoming.page,
      });
      continue;
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

    if (prev && prevVal) {
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
