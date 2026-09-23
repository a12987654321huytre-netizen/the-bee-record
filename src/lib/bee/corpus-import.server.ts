import { timingSafeEqual } from "node:crypto";
import { addAlias, createEntity, createRelationship, setClassification, updateEntity } from "./entities.server.ts";
import { sha256HexNode } from "./hash.ts";
import { ingestDocument, rerunExtraction } from "./pipeline.server.ts";
import { persistExtraction } from "./extract.server.ts";
import { createSource } from "./crawler.server.ts";
import { getExpiringSoonDays } from "./settings.server.ts";
import { publishEvidence } from "./publication.server.ts";
import {
  clearRepairRunsForEvidence,
  closeResolvedRegistrationReviews,
  repairOneEvidence,
} from "./repair.server.ts";
import { extractDomain, normalizeName, normalizeRegistration } from "./normalize.ts";
import { formatZaRegistration, isVerifierRegistration, isZaCompanyRegistration } from "./enrichment.ts";
import { newId } from "./ids.ts";
import { normalizeBeeLevel } from "./level.ts";
import { PARSER_PROCUREMENT } from "./constants.ts";
import { checkFetchUrl } from "./ssrf.ts";
import {
  cleanSupplierName,
  isJointVentureName,
  isMalformedCompanyName,
  isImportableShortLegalName,
  procurementIdentityHash,
} from "./disclosure.ts";
import { parseAwardDateInput, polishEvidenceTitle, inferEvidenceDateFromSource } from "./evidence-date.ts";
import { procurementQualifiesForPublicEntity } from "./recency.ts";
import type { Sql } from "./db-types.ts";
import type { ExtractionClaim } from "./types.ts";

/** SHA-256 of the one-time corpus import bearer. Token is not in git. */
export const CORPUS_IMPORT_TOKEN_SHA256 =
  "9040152a95910e520a9d047410a68eb9e6ddd57a1b0ef9b5b8048e95fd6c432b";

const ACTOR = "import:corpus-2026";

export type CorpusEvidence = {
  url: string;
  evidenceType?: string;
  title?: string;
};

export type CorpusSource = {
  url: string;
  sourceType?: string;
  frequency?: "daily" | "weekly" | "monthly" | "manual";
};

export type ProcurementDisclosureInput = {
  sourceUrl: string;
  governmentInstitution: string;
  tenderNumber?: string;
  tenderDescription?: string;
  awardDate?: string;
  beeLevel?: string;
  enterpriseClass?: string;
  contractPeriod?: string;
  contractAmount?: string;
  sourceTitle?: string;
  outcome?: "awarded" | "responded" | "unsuccessful" | "bidder_register";
};

export type CorpusItem = {
  canonicalName: string;
  legalName?: string;
  tradingName?: string;
  registrationNumber?: string;
  website?: string;
  aliases?: string[];
  sectorIds?: string[];
  jseListed?: boolean;
  parentName?: string;
  entityType?: string;
  evidence?: CorpusEvidence[];
  sources?: CorpusSource[];
  procurement?: ProcurementDisclosureInput[];
  publishIfSafe?: boolean;
  /** Explicit operator import of a pre-2024 official procurement record. Still historical, never current. */
  allowHistoricalProcurement?: boolean;
  /** Link an already published group document without copying it as this company's own certificate. */
  includedOnly?: { url: string; measuredEntityName: string };
};

export type ImportItemResult = {
  canonicalName: string;
  entityId: string | null;
  created: boolean;
  duplicateEntity: boolean;
  published: boolean;
  skipped?: boolean;
  skipReason?: string;
  evidence: Array<{
    url: string;
    evidenceId?: string;
    duplicate?: boolean;
    autoPublished?: boolean;
    published?: boolean;
    reviewItemId?: string | null;
    error?: string;
    retried?: boolean;
    kind?: string;
  }>;
  sources: Array<{ url: string; sourceId?: string; error?: string }>;
  error?: string;
};

function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== 32 || right.length !== 32) return false;
  return timingSafeEqual(left, right);
}

export function authorizeCorpusImport(header: string | null): boolean {
  if (!header?.toLowerCase().startsWith("bearer ")) return false;
  const token = header.slice(7).trim();
  if (!token) return false;
  const cron = process.env.CRON_SECRET?.trim();
  if (cron && token === cron) return true;
  return hashesEqual(sha256HexNode(token), CORPUS_IMPORT_TOKEN_SHA256);
}

async function findExistingEntity(
  db: Sql,
  input: { canonicalName: string; registrationNumber?: string | null },
): Promise<{ id: string; via: string } | null> {
  const reg = input.registrationNumber ? normalizeRegistration(input.registrationNumber) : null;
  if (reg) {
    const byReg = await db.query<{ id: string }>(
      `select id from entities
       where registration_number_normalized = $1 and merged_into_id is null
       limit 1`,
      [reg],
    );
    if (byReg[0]) return { id: byReg[0].id, via: "registration_number" };
  }
  const name = normalizeName(input.canonicalName);
  const byName = await db.query<{ id: string }>(
    `select id from entities
     where normalized_name = $1 and merged_into_id is null
     limit 1`,
    [name],
  );
  if (byName[0]) return { id: byName[0].id, via: "canonical_name" };
  const byAlias = await db.query<{ entity_id: string }>(
    `select a.entity_id from entity_aliases a
     join entities e on e.id = a.entity_id
     where a.normalized_alias = $1 and e.merged_into_id is null
     limit 1`,
    [name],
  );
  if (byAlias[0]) return { id: byAlias[0].entity_id, via: "alias" };
  return null;
}

async function findParentId(db: Sql, parentName: string): Promise<string | null> {
  const found = await findExistingEntity(db, { canonicalName: parentName });
  return found?.id ?? null;
}

async function fillMissingIdentity(db: Sql, entityId: string, item: CorpusItem): Promise<void> {
  const rows = await db.query<{
    registration_number: string | null;
    website: string | null;
    legal_name: string | null;
    trading_name: string | null;
  }>("select registration_number, website, legal_name, trading_name from entities where id = $1", [entityId]);
  const existing = rows[0];
  if (!existing) return;
  const patch: {
    id: string;
    actorId: string;
    registrationNumber?: string;
    website?: string;
    legalName?: string;
    tradingName?: string;
  } = { id: entityId, actorId: ACTOR };
  let changed = false;
  if (!existing.registration_number && item.registrationNumber && isZaCompanyRegistration(item.registrationNumber) && !isVerifierRegistration(item.registrationNumber)) {
    const formatted = formatZaRegistration(item.registrationNumber);
    if (formatted) {
      const clash = await db.query<{ id: string }>(
        `select id from entities
         where registration_number_normalized = $1 and id <> $2 and merged_into_id is null
         limit 1`,
        [normalizeRegistration(formatted), entityId],
      );
      if (!clash[0]) {
        patch.registrationNumber = formatted;
        changed = true;
      }
    }
  }
  if (!existing.website && item.website) {
    try {
      const u = new URL(item.website);
      if (u.protocol === "http:" || u.protocol === "https:") {
        patch.website = item.website;
        changed = true;
      }
    } catch {
      /* skip */
    }
  }
  if (!existing.legal_name && item.legalName?.trim()) {
    patch.legalName = item.legalName.trim();
    changed = true;
  }
  if (!existing.trading_name && item.tradingName?.trim()) {
    patch.tradingName = item.tradingName.trim();
    changed = true;
  }
  if (changed) {
    try {
      await updateEntity(db, patch);
    } catch {
      /* unique registration or concurrent edit — leave as-is */
    }
  }
}

function claim(
  field: string,
  raw: string | null | undefined,
  normalized?: string | null,
  locator?: string | null,
): ExtractionClaim | null {
  const value = raw?.trim();
  if (!value) return null;
  return {
    field: field as ExtractionClaim["field"],
    raw_value: value,
    normalized_value: normalized ?? value,
    confidence: 0.99,
    page: null,
    locator: locator ?? null,
    warning: null,
  };
}

function procurementTitle(input: {
  name: string;
  institution: string;
  tenderNumber?: string | null;
  beeLevel?: string | null;
}): string {
  const level = input.beeLevel ? `Level ${input.beeLevel} reported` : "B-BBEE level as reported";
  const tender = input.tenderNumber ? ` ${input.tenderNumber}` : "";
  return `${input.name} — ${level} in ${input.institution}${tender}`;
}

function procurementNotes(input: ProcurementDisclosureInput): string {
  const outcome =
    input.outcome === "unsuccessful"
      ? "The named bidder was recorded in an official evaluation/result table; award is not implied."
      : input.outcome === "responded"
        ? "The named bidder was recorded as having responded to this procurement."
        : "The named supplier was recorded in an official awarded-tender or bidder-result publication.";
  return [
    "Official government procurement disclosure.",
    "The B-BBEE level is exactly as reported in the source for this dated procurement.",
    "This is not a current verification certificate.",
    "No certificate number, expiry date or verification agency is inferred.",
    outcome,
  ].join(" ");
}

async function importProcurementDisclosure(
  db: Sql,
  input: {
    entityId: string;
    canonicalName: string;
    disclosure: ProcurementDisclosureInput;
    publish: boolean;
    expiringSoonDays: number;
  },
): Promise<ImportItemResult["evidence"][number]> {
  const d = input.disclosure;
  const urlCheck = checkFetchUrl(d.sourceUrl);
  if (!urlCheck.ok) {
    return { url: d.sourceUrl, kind: "procurement", error: urlCheck.reason };
  }
  const sourceUrl = urlCheck.url.toString();
  const beeLevel = normalizeBeeLevel(d.beeLevel ?? null);
  const parsedDate = parseAwardDateInput(d.awardDate ?? null);
  const inferred = parsedDate.stated
    ? parsedDate
    : inferEvidenceDateFromSource({ sourceUrl, title: d.sourceTitle ?? null, issueDateRaw: d.awardDate });
  const evidenceDate = inferred.stated ? inferred.iso : null;
  const evidencePrecision = inferred.stated ? inferred.precision : null;
  const evidenceRaw = inferred.stated ? inferred.raw : d.awardDate ?? null;
  const hash = procurementIdentityHash({
    sourceUrl,
    tenderNumber: d.tenderNumber,
    canonicalName: input.canonicalName,
    beeLevel: beeLevel ?? d.beeLevel ?? null,
    evidenceDate,
  });
  const existing = await db.query<{ id: string; publication_state: string }>(
    "select id, publication_state from evidence where content_hash = $1 limit 1",
    [hash],
  );
  if (existing[0]) {
    const links = await db.query<{ entity_id: string }>(
      "select entity_id from evidence_entity_links where evidence_id = $1",
      [existing[0].id],
    );
    if (!links.some((l) => l.entity_id === input.entityId)) {
      const id = newId("lnk");
      await db.query(
        `insert into evidence_entity_links
          (id, evidence_id, entity_id, link_state, extracted_name, match_method, confidence, registration_match, reason)
         values ($1,$2,$3,'confirmed','import',1,1,0,'Procurement disclosure linked on re-import.')`,
        [id, existing[0].id, input.entityId],
      );
    }
    if (input.publish && existing[0].publication_state !== "published") {
      const published = await publishEvidence(db, {
        evidenceId: existing[0].id,
        entityId: input.entityId,
        actorType: "import",
        actorId: ACTOR,
        reason: "Official dated procurement disclosure linked to the named legal entity.",
        expiringSoonDays: input.expiringSoonDays,
      });
      return {
        url: sourceUrl,
        evidenceId: existing[0].id,
        duplicate: true,
        published: published.ok,
        kind: "procurement",
        error: published.ok ? undefined : published.error,
      };
    }
    return {
      url: sourceUrl,
      evidenceId: existing[0].id,
      duplicate: true,
      published: existing[0].publication_state === "published",
      kind: "procurement",
    };
  }

  const evidenceId = newId("evd");
  const generated = procurementTitle({
    name: input.canonicalName,
    institution: d.governmentInstitution,
    tenderNumber: d.tenderNumber,
    beeLevel,
  });
  const title = polishEvidenceTitle(d.sourceTitle ?? generated, inferred) ?? generated;
  const domain = extractDomain(sourceUrl);
  await db.query(
    `insert into evidence (
        id, evidence_type, title, source_url, discovered_url, canonical_url, source_domain,
        mime_type, content_hash, retrieved_at, publication_date, issue_date, issue_date_raw, issue_date_precision,
        document_issuer, original_source_status, extraction_state, validation_state,
        review_state, publication_state, lifecycle_state, source_live_status, public_notes
     ) values (
        $1,'government_procurement_disclosure',$2,$3,$3,$3,$4,
        'text/html',$5,now(),$6,$6,$7,$8,
        $9,'live','extracted','passed',
        'none','unpublished','discovered','live',$10
     )`,
    [
      evidenceId,
      title,
      sourceUrl,
      domain,
      hash,
      evidenceDate,
      evidenceRaw,
      evidencePrecision,
      d.governmentInstitution,
      procurementNotes(d),
    ],
  );
  await db.query("insert into evidence_source_locations (id, evidence_id, url) values ($1,$2,$3)", [
    newId("loc"),
    evidenceId,
    sourceUrl,
  ]);
  await db.query(
    `insert into evidence_entity_links
      (id, evidence_id, entity_id, link_state, extracted_name, match_method, confidence, registration_match, reason)
     values ($1,$2,$3,'confirmed',$4,'import',1,0,$5)`,
    [
      newId("lnk"),
      evidenceId,
      input.entityId,
      input.canonicalName,
      `Official procurement disclosure from ${d.governmentInstitution}.`,
    ],
  );

  const claims = [
    claim("document_type", "government_procurement_disclosure", "government_procurement_disclosure", "evidence type"),
    claim("measured_entity", input.canonicalName, input.canonicalName, "supplier name"),
    claim("legal_entity_name", input.canonicalName, input.canonicalName, "supplier name"),
    claim("bee_level", d.beeLevel, beeLevel, "recorded B-BBEE level"),
    claim("issue_date", evidenceRaw ?? d.awardDate, evidenceDate, "award / evidence date"),
    claim("tender_number", d.tenderNumber, d.tenderNumber ?? null, "tender number"),
    claim("government_institution", d.governmentInstitution, d.governmentInstitution, "source institution"),
    claim("enterprise_class", d.enterpriseClass, d.enterpriseClass?.toUpperCase() ?? null, "enterprise class"),
    claim("tender_description", d.tenderDescription, d.tenderDescription ?? null, "tender description"),
    claim("contract_period", d.contractPeriod, d.contractPeriod ?? null, "contract period"),
    claim("contract_amount", d.contractAmount, d.contractAmount ?? null, "award amount"),
    claim("procurement_outcome", d.outcome, d.outcome ?? "awarded", "procurement outcome"),
  ].filter((c): c is ExtractionClaim => Boolean(c));

  await persistExtraction(db, {
    evidenceId,
    parser: PARSER_PROCUREMENT,
    result: { claims, warnings: [], ambiguity: [] },
    success: true,
    raw: JSON.stringify({
      kind: "government_procurement_disclosure",
      sourceUrl,
      governmentInstitution: d.governmentInstitution,
      tenderNumber: d.tenderNumber ?? null,
      evidenceDate,
    }),
  });

  if (!input.publish) {
    return { url: sourceUrl, evidenceId, published: false, kind: "procurement" };
  }
  const published = await publishEvidence(db, {
    evidenceId,
    entityId: input.entityId,
    actorType: "import",
    actorId: ACTOR,
    reason: "Official dated procurement disclosure from a government / public-body source.",
    expiringSoonDays: input.expiringSoonDays,
  });
  return {
    url: sourceUrl,
    evidenceId,
    published: published.ok,
    kind: "procurement",
    error: published.ok ? undefined : published.error,
  };
}

function reviewUnsafe(type: string | null | undefined): boolean {
  if (!type) return false;
  return (
    type === "registration_number_conflict" ||
    type === "conflicting_evidence" ||
    type === "manual_lock_conflict"
  );
}

async function pendingReviewId(db: Sql, evidenceId: string): Promise<string | null> {
  const rows = await db.query<{ id: string; type: string }>(
    `select id, type from review_items
     where evidence_id = $1 and status in ('pending', 'in_review')
     order by created_at desc
     limit 1`,
    [evidenceId],
  );
  if (!rows[0]) return null;
  if (reviewUnsafe(rows[0].type)) return null;
  return rows[0].id;
}

export async function publishLinkedEvidence(
  db: Sql,
  input: { evidenceId: string; entityId: string; expiringSoonDays: number },
): Promise<{ published: boolean; error?: string; reviewItemId?: string | null }> {
  const evidence = await db.query<{ publication_state: string; extraction_state: string; asset_id: string | null }>(
    "select publication_state, extraction_state, asset_id from evidence where id = $1",
    [input.evidenceId],
  );
  const row = evidence[0];
  if (!row) return { published: false, error: "Evidence not found." };
  if (row.publication_state === "published") return { published: true };

  if (row.extraction_state !== "extracted" && row.asset_id) {
    try {
      await rerunExtraction(db, input.evidenceId, ACTOR);
    } catch (err) {
      return { published: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  const reviewItemId = await pendingReviewId(db, input.evidenceId);
  const unsafe = await db.query<{ type: string }>(
    `select type from review_items
     where evidence_id = $1 and status in ('pending', 'in_review')
     order by created_at desc limit 1`,
    [input.evidenceId],
  );
  if (reviewUnsafe(unsafe[0]?.type)) {
    return { published: false, error: `Held for review: ${unsafe[0].type}`, reviewItemId: null };
  }

  const published = await publishEvidence(db, {
    evidenceId: input.evidenceId,
    entityId: input.entityId,
    actorType: "import",
    actorId: ACTOR,
    reviewItemId,
    reason: "Initial corpus import: official-domain evidence linked to the named legal entity.",
    expiringSoonDays: input.expiringSoonDays,
  });
  if (published.ok) return { published: true, reviewItemId };
  return { published: false, error: published.error, reviewItemId };
}

export async function retryUnpublished(db: Sql, limit = 8): Promise<{
  attempted: number;
  published: number;
  results: Array<{ evidenceId: string; entityId: string; published: boolean; error?: string }>;
}> {
  const rows = await db.query<{ evidence_id: string; entity_id: string }>(
    `select e.id as evidence_id, el.entity_id
     from evidence e
     join evidence_entity_links el on el.evidence_id = e.id
     join entities n on n.id = el.entity_id
     where e.publication_state = 'unpublished'
       and n.merged_into_id is null
     order by e.created_at asc
     limit $1`,
    [limit],
  );
  const days = await getExpiringSoonDays(db);
  const results: Array<{ evidenceId: string; entityId: string; published: boolean; error?: string }> = [];
  let published = 0;
  for (const row of rows) {
    const out = await publishLinkedEvidence(db, {
      evidenceId: row.evidence_id,
      entityId: row.entity_id,
      expiringSoonDays: days,
    });
    if (out.published) published += 1;
    results.push({
      evidenceId: row.evidence_id,
      entityId: row.entity_id,
      published: out.published,
      error: out.error,
    });
  }
  return { attempted: rows.length, published, results };
}

export async function importCorpusItem(db: Sql, item: CorpusItem): Promise<ImportItemResult> {
  const result: ImportItemResult = {
    canonicalName: item.canonicalName,
    entityId: null,
    created: false,
    duplicateEntity: false,
    published: false,
    evidence: [],
    sources: [],
  };
  const cleaned = cleanSupplierName(item.canonicalName);
  const name = cleaned.canonicalName;
  result.canonicalName = name;
  if (name.length < 2) {
    result.error = "canonicalName is required.";
    result.skipped = true;
    return result;
  }
  if (isJointVentureName(name) || isJointVentureName(item.canonicalName)) {
    result.error = "Held: joint-venture or consortium name.";
    result.skipped = true;
    result.skipReason = "jv";
    return result;
  }
  const existing = await findExistingEntity(db, {
    canonicalName: name,
    registrationNumber: item.registrationNumber,
  });
  if (isMalformedCompanyName(name) && !existing && !isImportableShortLegalName(name, item.registrationNumber)) {
    result.error = "Held: malformed supplier name.";
    result.skipped = true;
    result.skipReason = "malformed";
    return result;
  }
  const procurementRows = item.procurement ?? [];
  const procurementModern = procurementQualifiesForPublicEntity(
    procurementRows.map((row) => ({
      awardDate: row.awardDate,
      sourceUrl: row.sourceUrl,
      title: row.sourceTitle ?? row.tenderNumber,
    })),
  );
  const hasCertificateEvidence = Boolean(item.evidence?.length);
  if (!existing && procurementRows.length && !hasCertificateEvidence && !procurementModern && !item.allowHistoricalProcurement) {
    result.skipped = true;
    result.skipReason = "pre_2024_procurement";
    result.error =
      "Procurement evidence is older than 1 January 2024 and cannot create a public company page.";
    return result;
  }

  let entityId: string;
  if (existing) {
    entityId = existing.id;
    result.duplicateEntity = true;
    result.entityId = entityId;
    await fillMissingIdentity(db, entityId, item);
  } else {
    try {
      const created = await createEntity(db, {
        canonicalName: name,
        legalName: item.legalName ?? cleaned.original ?? name,
        tradingName: item.tradingName ?? cleaned.tradingName,
        registrationNumber: item.registrationNumber,
        website: item.website,
        entityType: item.entityType ?? "company",
        visibility: "draft",
        automationState: "review_only",
        actorId: ACTOR,
      });
      entityId = created.id;
      result.created = true;
      result.entityId = entityId;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const again = await findExistingEntity(db, {
        canonicalName: name,
        registrationNumber: item.registrationNumber,
      });
      if (!again) {
        result.error = message;
        return result;
      }
      entityId = again.id;
      result.duplicateEntity = true;
      result.entityId = entityId;
      await fillMissingIdentity(db, entityId, item);
    }
  }

  const extraAliases = [...(item.aliases ?? []), ...cleaned.aliases];
  if (cleaned.original && normalizeName(cleaned.original) !== normalizeName(name)) {
    extraAliases.push(cleaned.original);
  }
  for (const alias of extraAliases) {
    if (alias.trim() && normalizeName(alias) !== normalizeName(name)) {
      await addAlias(db, { entityId, alias: alias.trim(), aliasType: "other", actorId: ACTOR });
    }
  }

  const sectors = new Set(item.sectorIds ?? []);
  sectors.delete("sec_jse");
  sectors.delete("sec_government_suppliers");
  for (const sectorId of sectors) {
    try {
      await setClassification(db, { entityId, sectorId, actorId: ACTOR });
    } catch {
      // unknown sector id — skip
    }
  }
  if (item.jseListed) {
    try {
      await setClassification(db, {
        entityId,
        sectorId: "sec_jse",
        actorId: ACTOR,
        classificationType: "listing",
      });
    } catch {
      /* sector row missing */
    }
  }

  if (item.parentName?.trim() || cleaned.parentName) {
    const parentId = await findParentId(db, (item.parentName ?? cleaned.parentName)!.trim());
    if (parentId && parentId !== entityId) {
      const already = await db.query<{ id: string }>(
        `select id from entity_relationships
         where source_entity_id = $1 and target_entity_id = $2 and relationship_type = 'parent'
         limit 1`,
        [entityId, parentId],
      );
      if (!already[0]) {
        await createRelationship(db, {
          sourceEntityId: entityId,
          targetEntityId: parentId,
          relationshipType: "parent",
          publicStatus: "public",
          actorId: ACTOR,
        });
      }
    }
  }

  const sourceUrls = new Map<string, CorpusSource>();
  for (const source of item.sources ?? []) {
    if (source.url) sourceUrls.set(source.url, source);
  }
  const hasProcurement = Boolean(item.procurement?.length);
  if (!hasProcurement) {
    for (const ev of item.evidence ?? []) {
      if (ev.url && !sourceUrls.has(ev.url)) {
        sourceUrls.set(ev.url, { url: ev.url, sourceType: "direct_evidence_url", frequency: "monthly" });
      }
    }
    if (item.website && !sourceUrls.has(item.website)) {
      sourceUrls.set(item.website, { url: item.website, sourceType: "other", frequency: "monthly" });
    }
  } else {
    for (const row of item.procurement ?? []) {
      if (row.sourceUrl && !sourceUrls.has(row.sourceUrl)) {
        sourceUrls.set(row.sourceUrl, {
          url: row.sourceUrl,
          sourceType: "government_source",
          frequency: "manual",
        });
      }
    }
  }

  for (const source of sourceUrls.values()) {
    try {
      const sourceId = await createSource(db, {
        url: source.url,
        entityId,
        sourceType: source.sourceType ?? "other",
        frequency: source.frequency ?? "monthly",
        actorId: ACTOR,
      });
      result.sources.push({ url: source.url, sourceId });
    } catch (err) {
      result.sources.push({
        url: source.url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const days = await getExpiringSoonDays(db);
  const shouldPublish = item.publishIfSafe !== false;

  if (item.includedOnly?.url) {
    const parentUrl = item.includedOnly.url;
    const parents = await db.query<{ id: string; publication_state: string }>(
      `select id, publication_state from evidence
       where source_url = $1 or discovered_url = $1 or canonical_url = $1
       order by case when publication_state = 'published' then 0 else 1 end, created_at desc
       limit 1`,
      [parentUrl],
    );
    const parent = parents[0];
    if (!parent || parent.publication_state !== "published") {
      result.error = "Group document is not published yet, so this company was not linked as an included entity.";
      result.evidence.push({ url: parentUrl, kind: "included", error: result.error });
      return result;
    }
    const existingLink = await db.query<{ id: string; link_state: string }>(
      "select id, link_state from evidence_entity_links where evidence_id = $1 and entity_id = $2 limit 1",
      [parent.id, entityId],
    );
    if (!existingLink[0]) {
      await db.query(
        `insert into evidence_entity_links
          (id, evidence_id, entity_id, link_state, extracted_name, match_method, confidence, registration_match, reason)
         values ($1,$2,$3,'included',$4,'import',1,1,$5)`,
        [
          newId("lnk"),
          parent.id,
          entityId,
          name,
          `Named on the group document measured for ${item.includedOnly.measuredEntityName}. Not an independent certificate for this company.`,
        ],
      );
    }
    await db.query(
      "update entities set visibility = 'public', updated_at = now() where id = $1 and visibility in ('draft', 'hidden')",
      [entityId],
    );
    result.published = true;
    result.evidence.push({
      url: parentUrl,
      evidenceId: parent.id,
      published: true,
      kind: "included",
    });
    return result;
  }

  for (const disclosure of item.procurement ?? []) {
    try {
      const row = await importProcurementDisclosure(db, {
        entityId,
        canonicalName: name,
        disclosure,
        publish: shouldPublish,
        expiringSoonDays: days,
      });
      if (row.published) result.published = true;
      result.evidence.push(row);
    } catch (err) {
      result.evidence.push({
        url: disclosure.sourceUrl,
        kind: "procurement",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  for (const ev of item.evidence ?? []) {
    if (!ev.url) continue;
    try {
      const ingested = await ingestDocument(db, {
        url: ev.url,
        title: ev.title ?? ev.url,
        evidenceType: ev.evidenceType ?? "bee_certificate",
        entityId,
        actorType: "import",
        actorId: ACTOR,
      });
      const row: ImportItemResult["evidence"][number] = {
        url: ev.url,
        evidenceId: ingested.evidenceId,
        duplicate: ingested.duplicate,
        autoPublished: ingested.autoPublished,
        reviewItemId: ingested.reviewItemId,
      };
      if (ingested.duplicate) {
        const links = await db.query<{ entity_id: string }>(
          "select entity_id from evidence_entity_links where evidence_id = $1",
          [ingested.evidenceId],
        );
        const linkedHere = links.some((l) => l.entity_id === entityId);
        if (!linkedHere) {
          await db.query(
            `insert into evidence_entity_links
              (id, evidence_id, entity_id, link_state, extracted_name, match_method, confidence, registration_match, reason)
             values ($1,$2,$3,'confirmed',$4,'import',1,0,$5)`,
            [
              newId("lnk"),
              ingested.evidenceId,
              entityId,
              name,
              "Named legal entity is included on this already stored document.",
            ],
          );
        }
        const publishedAlready = await db.query<{ publication_state: string }>(
          "select publication_state from evidence where id = $1",
          [ingested.evidenceId],
        );
        if (publishedAlready[0]?.publication_state === "published") {
          row.published = true;
          result.published = true;
          result.evidence.push(row);
          continue;
        }
        if (shouldPublish) {
          const retried = await publishLinkedEvidence(db, {
            evidenceId: ingested.evidenceId,
            entityId,
            expiringSoonDays: days,
          });
          row.retried = true;
          row.published = retried.published;
          if (retried.published) result.published = true;
          else row.error = retried.error;
          if (retried.reviewItemId) row.reviewItemId = retried.reviewItemId;
        }
        result.evidence.push(row);
        continue;
      }
      if (ingested.autoPublished) {
        row.published = true;
        result.published = true;
      } else if (shouldPublish && !ingested.extractionFailed) {
        let unsafe = false;
        if (ingested.reviewItemId) {
          const review = await db.query<{ type: string }>(
            "select type from review_items where id = $1",
            [ingested.reviewItemId],
          );
          unsafe = reviewUnsafe(review[0]?.type);
        }
        if (!unsafe) {
          const published = await publishEvidence(db, {
            evidenceId: ingested.evidenceId,
            entityId,
            actorType: "import",
            actorId: ACTOR,
            reviewItemId: ingested.reviewItemId,
            reason: "Initial corpus import: official-domain evidence linked to the named legal entity.",
            expiringSoonDays: days,
          });
          if (published.ok) {
            row.published = true;
            result.published = true;
          } else {
            row.error = published.error;
          }
        } else {
          row.error = "Held for review due to a conflict.";
        }
      }
      result.evidence.push(row);
    } catch (err) {
      result.evidence.push({
        url: ev.url,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (result.published) {
    const canPublicize = hasCertificateEvidence || !procurementRows.length || procurementModern || Boolean(item.allowHistoricalProcurement);
    if (canPublicize) {
      await db.query(
        "update entities set visibility = 'public', updated_at = now() where id = $1 and visibility in ('draft', 'hidden')",
        [entityId],
      );
    }
  }

  return result;
}

export async function importCorpusBatch(db: Sql, items: CorpusItem[]): Promise<{
  results: ImportItemResult[];
  duplicateEntityAttempts: number;
  duplicateDocuments: number;
  published: number;
  reviewHeld: number;
}> {
  const results: ImportItemResult[] = [];
  let duplicateEntityAttempts = 0;
  let duplicateDocuments = 0;
  let published = 0;
  let reviewHeld = 0;
  for (const item of items) {
    const row = await importCorpusItem(db, item);
    results.push(row);
    if (row.duplicateEntity) duplicateEntityAttempts += 1;
    for (const ev of row.evidence) {
      if (ev.duplicate) duplicateDocuments += 1;
      if (ev.published || ev.autoPublished) published += 1;
      else if (ev.reviewItemId && !ev.published) reviewHeld += 1;
    }
  }
  return { results, duplicateEntityAttempts, duplicateDocuments, published, reviewHeld };
}

export async function reprocessStoredUrls(db: Sql, urls: string[]) {
  const unique = [...new Set(urls.map((url) => url.trim()).filter(Boolean))].slice(0, 20);
  const days = await getExpiringSoonDays(db);
  const results: Array<Record<string, unknown>> = [];
  for (const url of unique) {
    const rows = await db.query<{ id: string }>(
      `select id from evidence
       where source_url = $1 or discovered_url = $1 or canonical_url = $1
       limit 4`,
      [url],
    );
    if (!rows.length) {
      results.push({ url, found: false });
      continue;
    }
    for (const row of rows) {
      await clearRepairRunsForEvidence(db, row.id);
      const repaired = await repairOneEvidence(db, row.id);
      const named = new Set(repaired.namedRegistrations ?? []);
      const links = await db.query<{ entity_id: string; registration_number: string | null }>(
        `select e.id as entity_id, e.registration_number
         from evidence_entity_links l
         join entities e on e.id = l.entity_id
         where l.evidence_id = $1 and e.merged_into_id is null
         limit 6`,
        [row.id],
      );
      const publishes: Array<{ entityId: string; published: boolean; error?: string }> = [];
      let closed = 0;
      for (const link of links) {
        const norm = link.registration_number ? normalizeRegistration(link.registration_number) : "";
        const included = Boolean(norm && named.has(norm) && !isVerifierRegistration(norm));
        closed += await closeResolvedRegistrationReviews(db, row.id, link.registration_number, included);
        const published = await publishLinkedEvidence(db, {
          evidenceId: row.id,
          entityId: link.entity_id,
          expiringSoonDays: days,
        });
        if (published.published) {
          await db.query(
            "update entities set visibility = 'public', updated_at = now() where id = $1 and visibility in ('draft', 'hidden')",
            [link.entity_id],
          );
        }
        publishes.push({ entityId: link.entity_id, published: published.published, error: published.error });
      }
      results.push({
        url,
        found: true,
        evidenceId: row.id,
        parsed: repaired.parsed,
        textLength: repaired.textLength ?? 0,
        named: repaired.namedRegistrations ?? [],
        closed,
        repairError: repaired.error,
        publishes,
      });
    }
  }
  return { results };
}