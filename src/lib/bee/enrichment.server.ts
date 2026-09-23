import { audit } from "./audit.server.ts";
import { createSource } from "./crawler.server.ts";
import { EXTRA_SECTORS, formatZaRegistration, isVerifierRegistration, isZaCompanyRegistration, queuePredicate } from "./enrichment.ts";
import { addAlias, createRelationship, setClassification, updateEntity } from "./entities.server.ts";
import { isJointVentureName, isMalformedCompanyName } from "./disclosure.ts";
import { extractDomain, normalizeName, normalizeRegistration } from "./normalize.ts";
import { mergeEntities } from "./merge.server.ts";
import { repairCorpusStats } from "./repair.server.ts";
import { closeReview } from "./review.server.ts";
import { getExpiringSoonDays } from "./settings.server.ts";
import type { Sql } from "./db-types.ts";

const ACTOR = "import:corpus-2026";

async function qn(db: Sql, text: string, params: unknown[] = []): Promise<number> {
  return (await db.query<{ n: number }>(text, params))[0]?.n ?? 0;
}

export async function findEntityByNameOrReg(
  db: Sql,
  input: { canonicalName: string; registrationNumber?: string | null },
): Promise<{ id: string; via: string; canonical_name: string; visibility: string } | null> {
  const reg = input.registrationNumber ? normalizeRegistration(input.registrationNumber) : null;
  if (reg) {
    const byReg = await db.query<{ id: string; canonical_name: string; visibility: string }>(
      `select id, canonical_name, visibility from entities
       where registration_number_normalized = $1 and merged_into_id is null
       limit 1`,
      [reg],
    );
    if (byReg[0]) return { ...byReg[0], via: "registration_number" };
  }
  const name = normalizeName(input.canonicalName);
  const byName = await db.query<{ id: string; canonical_name: string; visibility: string }>(
    `select id, canonical_name, visibility from entities
     where normalized_name = $1 and merged_into_id is null
     limit 1`,
    [name],
  );
  if (byName[0]) return { ...byName[0], via: "canonical_name" };
  const byAlias = await db.query<{ id: string; canonical_name: string; visibility: string }>(
    `select e.id, e.canonical_name, e.visibility
     from entity_aliases a
     join entities e on e.id = a.entity_id
     where a.normalized_alias = $1 and e.merged_into_id is null
     limit 1`,
    [name],
  );
  if (byAlias[0]) return { ...byAlias[0], via: "alias" };
  return null;
}

export async function ensureExtraSectors(db: Sql): Promise<{ added: number; existing: number }> {
  let added = 0;
  let existing = 0;
  for (const s of EXTRA_SECTORS) {
    const already = await db.query<{ id: string }>(
      "select id from sectors where id = $1 or slug = $2 limit 1",
      [s.id, s.slug],
    );
    if (already[0]) {
      existing += 1;
      continue;
    }
    await db.query("insert into sectors (id, slug, name) values ($1,$2,$3)", [s.id, s.slug, s.name]);
    added += 1;
  }
  return { added, existing };
}

export async function auditEnrichment(db: Sql) {
  const counts = await repairCorpusStats(db);
  const published = counts.published;

  const withCurrent = await qn(
    db,
    `select count(*)::int as n from entities e
     join entity_current_state cs on cs.entity_id = e.id
     where e.visibility = 'public' and e.merged_into_id is null
       and cs.lifecycle_state in ('current','expiring_soon')`,
  );
  const withExpiring = await qn(
    db,
    `select count(*)::int as n from entities e
     join entity_current_state cs on cs.entity_id = e.id
     where e.visibility = 'public' and e.merged_into_id is null
       and cs.lifecycle_state = 'expiring_soon'`,
  );
  const expiredOnly = await qn(
    db,
    `select count(*)::int as n from entities e
     where e.visibility = 'public' and e.merged_into_id is null
       and exists (
         select 1 from evidence_entity_links l
         join evidence ev on ev.id = l.evidence_id
         where l.entity_id = e.id and ev.publication_state = 'published'
           and ev.evidence_type in ('bee_certificate','sworn_affidavit')
           and ev.lifecycle_state = 'expired'
       )
       and not exists (
         select 1 from evidence_entity_links l
         join evidence ev on ev.id = l.evidence_id
         where l.entity_id = e.id and ev.publication_state = 'published'
           and ev.evidence_type in ('bee_certificate','sworn_affidavit')
           and ev.lifecycle_state in ('current','expiring_soon')
       )`,
  );
  const unknownValidityCert = await qn(
    db,
    `select count(*)::int as n from entities e
     where e.visibility = 'public' and e.merged_into_id is null
       and exists (
         select 1 from evidence_entity_links l
         join evidence ev on ev.id = l.evidence_id
         where l.entity_id = e.id and ev.publication_state = 'published'
           and ev.evidence_type in ('bee_certificate','sworn_affidavit')
           and ev.lifecycle_state = 'unknown_validity'
       )`,
  );
  const certificateBacked = await qn(
    db,
    `select count(*)::int as n from entities e
     where e.visibility = 'public' and e.merged_into_id is null
       and exists (
         select 1 from evidence_entity_links l
         join evidence ev on ev.id = l.evidence_id
         where l.entity_id = e.id and ev.publication_state = 'published'
           and ev.evidence_type in ('bee_certificate','sworn_affidavit')
       )`,
  );
  const procurementOnly = await qn(
    db,
    `select count(*)::int as n from entities e
     where e.visibility = 'public' and e.merged_into_id is null
       and exists (
         select 1 from evidence_entity_links l
         join evidence ev on ev.id = l.evidence_id
         where l.entity_id = e.id and ev.publication_state = 'published'
           and ev.evidence_type = 'government_procurement_disclosure'
       )
       and not exists (
         select 1 from evidence_entity_links l
         join evidence ev on ev.id = l.evidence_id
         where l.entity_id = e.id and ev.publication_state = 'published'
           and ev.evidence_type in ('bee_certificate','sworn_affidavit')
       )`,
  );
  const disclosureOnly = await qn(
    db,
    `select count(*)::int as n from entities e
     where e.visibility = 'public' and e.merged_into_id is null
       and exists (
         select 1 from evidence_entity_links l
         join evidence ev on ev.id = l.evidence_id
         where l.entity_id = e.id and ev.publication_state = 'published'
           and ev.evidence_type in ('company_disclosure','company_webpage','annual_report','integrated_report','transformation_report')
       )
       and not exists (
         select 1 from evidence_entity_links l
         join evidence ev on ev.id = l.evidence_id
         where l.entity_id = e.id and ev.publication_state = 'published'
           and ev.evidence_type in ('bee_certificate','sworn_affidavit','government_procurement_disclosure')
       )`,
  );
  const multipleTypes = await qn(
    db,
    `select count(*)::int as n from entities e
     where e.visibility = 'public' and e.merged_into_id is null
       and (
         select count(distinct ev.evidence_type) from evidence_entity_links l
         join evidence ev on ev.id = l.evidence_id
         where l.entity_id = e.id and ev.publication_state = 'published'
       ) >= 2`,
  );
  const missingReg = await qn(
    db,
    `select count(*)::int as n from entities e
     where e.visibility = 'public' and e.merged_into_id is null
       and (e.registration_number is null or btrim(e.registration_number) = '')`,
  );
  const missingSector = await qn(
    db,
    `select count(*)::int as n from entities e
     where e.visibility = 'public' and e.merged_into_id is null
       and not exists (
         select 1 from entity_classifications c
         where c.entity_id = e.id and c.is_public = 1 and c.classification_type = 'sector'
           and c.sector_id not in ('sec_jse', 'sec_government_suppliers')
       )`,
  );
  const missingWebsite = await qn(
    db,
    `select count(*)::int as n from entities e
     where e.visibility = 'public' and e.merged_into_id is null
       and (e.website is null or btrim(e.website) = '')`,
  );
  const missingParent = await qn(
    db,
    `select count(*)::int as n from entities e
     where e.visibility = 'public' and e.merged_into_id is null
       and not exists (
         select 1 from entity_relationships r
         where r.source_entity_id = e.id and r.relationship_type = 'parent'
       )`,
  );
  const missingCertificate = await qn(
    db,
    `select count(*)::int as n from entities e
     where e.visibility = 'public' and e.merged_into_id is null
       and not exists (
         select 1 from evidence_entity_links l
         join evidence ev on ev.id = l.evidence_id
         where l.entity_id = e.id and ev.publication_state = 'published'
           and ev.evidence_type in ('bee_certificate','sworn_affidavit')
       )`,
  );
  const missingVerifier = await qn(
    db,
    `select count(*)::int as n from entities e
     where e.visibility = 'public' and e.merged_into_id is null
       and not exists (
         select 1 from evidence_entity_links l
         join evidence ev on ev.id = l.evidence_id
         where l.entity_id = e.id and ev.verifier_agency_id is not null
       )`,
  );
  const withMonitoredSource = await qn(
    db,
    `select count(distinct e.id)::int as n from entities e
     join monitored_sources s on s.entity_id = e.id
     where e.visibility = 'public' and e.merged_into_id is null`,
  );
  const withOfficialDomainSource = await qn(
    db,
    `select count(distinct e.id)::int as n from entities e
     join monitored_sources s on s.entity_id = e.id
     where e.visibility = 'public' and e.merged_into_id is null
       and e.website is not null
       and s.domain = regexp_replace(lower(split_part(regexp_replace(e.website, '^https?://', ''), '/', 1)), '^www\\.', '')`,
  );
  const evidencePerCompany = published
    ? Number(
        (
          await db.query<{ avg: string }>(
            `select coalesce(avg(n),0)::numeric(10,2) as avg from (
               select count(l.id)::float as n
               from entities e
               left join evidence_entity_links l on l.entity_id = e.id
               left join evidence ev on ev.id = l.evidence_id and ev.publication_state = 'published'
               where e.visibility = 'public' and e.merged_into_id is null
               group by e.id
             ) t`,
          )
        )[0]?.avg ?? "0",
      )
    : 0;

  const reviewBreakdown = await db.query<{ type: string; n: number }>(
    `select type, count(*)::int as n from review_items where status = 'pending' group by type order by n desc`,
  );
  const reviewSamples: Array<{
    id: string;
    type: string;
    reason: string;
    entity_name: string | null;
    evidence_title: string | null;
    publication_state: string | null;
    evidence_type: string | null;
    visibility: string | null;
  }> = [];
  for (const row of reviewBreakdown) {
    const samples = await db.query<{
      id: string;
      type: string;
      reason: string;
      entity_name: string | null;
      evidence_title: string | null;
      publication_state: string | null;
      evidence_type: string | null;
      visibility: string | null;
    }>(
      `select r.id, r.type, r.reason, ent.canonical_name as entity_name, e.title as evidence_title,
              e.publication_state, e.evidence_type, ent.visibility
       from review_items r
       left join evidence e on e.id = r.evidence_id
       left join entities ent on ent.id = r.entity_id
       where r.status = 'pending' and r.type = $1
       order by r.generated_at desc
       limit 8`,
      [row.type],
    );
    reviewSamples.push(...samples);
  }
  const duplicateNameGroups = await db.query<{ normalized_name: string; n: number; names: string }>(
    `select normalized_name, count(*)::int as n,
            string_agg(canonical_name, ' | ' order by canonical_name) as names
     from entities
     where merged_into_id is null
     group by normalized_name
     having count(*) > 1
     order by count(*) desc
     limit 40`,
  );
  const queues: Record<string, number> = {};
  for (const queue of [
    "procurement_only",
    "no_registration",
    "no_sector",
    "no_website",
    "no_current_certificate",
    "expired_certificate_only",
    "certificate_enrichment",
    "identity_enrichment",
    "monitoring_setup",
    "expiry_replacement",
  ]) {
    const pred = queuePredicate(queue);
    if (!pred) continue;
    queues[queue] = await qn(
      db,
      `select count(*)::int as n from entities e
       where e.merged_into_id is null and e.visibility = 'public' and ${pred}`,
    );
  }

  return {
    ok: true,
    counts,
    enrichment: {
      published,
      withCurrentCertificate: withCurrent,
      withExpiringCertificate: withExpiring,
      expiredCertificateOnly: expiredOnly,
      unknownValidityCertificate: unknownValidityCert,
      certificateBacked,
      procurementOnly,
      disclosureOnly,
      multipleEvidenceTypes: multipleTypes,
      missingRegistration: missingReg,
      missingSector,
      missingWebsite,
      missingParent,
      missingCertificate,
      missingVerifier,
      withMonitoredSource,
      withOfficialDomainSource,
      averageEvidencePerCompany: evidencePerCompany,
    },
    reviews: {
      pending: counts.review,
      byType: reviewBreakdown,
      samples: reviewSamples,
    },
    duplicateNameGroups,
    queues,
    copiedRegistrations: await db.query<{ target_id: string | null; after_state: string | null; at: string }>(
      `select target_id, after_state, at from audit_logs
       where action = 'entity.registration_copied'
       order by at desc
       limit 40`,
    ),
  };
}

export async function closeStalePublishedReviews(
  db: Sql,
  opts?: { limit?: number; dryRun?: boolean },
): Promise<{ closed: number; remaining: number; samples: Array<{ id: string; type: string; reason: string }> }> {
  const limit = Math.min(200, opts?.limit ?? 80);
  const rows = await db.query<{ id: string; type: string; reason: string }>(
    `select r.id, r.type, r.reason
     from review_items r
     join evidence e on e.id = r.evidence_id
     where r.status = 'pending'
       and r.type = 'new_evidence'
       and e.publication_state = 'published'
     order by r.generated_at
     limit $1`,
    [limit],
  );
  if (!opts?.dryRun) {
    for (const row of rows) {
      await closeReview(db, {
        reviewItemId: row.id,
        actorId: ACTOR,
        status: "approved",
        resolution: "Evidence already published; leftover new_evidence review closed.",
      });
    }
  }
  const remaining = await qn(
    db,
    `select count(*)::int as n from review_items r
     join evidence e on e.id = r.evidence_id
     where r.status = 'pending' and r.type = 'new_evidence' and e.publication_state = 'published'`,
  );
  return { closed: opts?.dryRun ? 0 : rows.length, remaining, samples: rows.slice(0, 20) };
}

export async function closeSucceededExtractionReviews(
  db: Sql,
  opts?: { limit?: number; dryRun?: boolean },
): Promise<{ closed: number }> {
  const limit = Math.min(100, opts?.limit ?? 40);
  const rows = await db.query<{ id: string }>(
    `select r.id
     from review_items r
     join evidence e on e.id = r.evidence_id
     where r.status = 'pending'
       and r.type = 'extraction_failed'
       and exists (
         select 1 from extraction_runs x
         where x.evidence_id = e.id and x.success = 1
       )
     limit $1`,
    [limit],
  );
  if (!opts?.dryRun) {
    for (const row of rows) {
      await closeReview(db, {
        reviewItemId: row.id,
        actorId: ACTOR,
        status: "approved",
        resolution: "A later extraction run succeeded for this evidence.",
      });
    }
  }
  return { closed: opts?.dryRun ? 0 : rows.length };
}

export async function closeSuppressedClaimReviews(
  db: Sql,
  opts?: { limit?: number; dryRun?: boolean },
): Promise<{ closed: number; samples: Array<{ id: string; reason: string }> }> {
  const limit = Math.min(200, opts?.limit ?? 120);
  const rows = await db.query<{ id: string; reason: string }>(
    `select id, reason from review_items
     where status = 'pending'
       and type = 'invalid_extracted_claim'
       and reason ilike '%suppressed and not shown%'
     order by generated_at
     limit $1`,
    [limit],
  );
  if (!opts?.dryRun) {
    for (const row of rows) {
      await closeReview(db, {
        reviewItemId: row.id,
        actorId: ACTOR,
        status: "approved",
        resolution: "Malformed extracted claim was already suppressed and not published.",
      });
    }
  }
  return { closed: opts?.dryRun ? 0 : rows.length, samples: rows.slice(0, 15) };
}

export async function closeRepairKeptConflicts(
  db: Sql,
  opts?: { limit?: number; dryRun?: boolean },
): Promise<{ closed: number; skippedLevel: number; samples: Array<{ id: string; reason: string }> }> {
  const limit = Math.min(200, opts?.limit ?? 80);
  const rows = await db.query<{ id: string; reason: string }>(
    `select id, reason from review_items
     where status = 'pending'
       and type = 'conflicting_evidence'
       and reason ilike 'Repair extracted a different%'
       and reason ilike '%Stored value was kept%'
     order by generated_at
     limit $1`,
    [limit],
  );
  let closed = 0;
  let skippedLevel = 0;
  const samples: Array<{ id: string; reason: string }> = [];
  for (const row of rows) {
    if (/bee_level|b-bbee level/i.test(row.reason)) {
      skippedLevel += 1;
      continue;
    }
    if (samples.length < 15) samples.push(row);
    if (!opts?.dryRun) {
      await closeReview(db, {
        reviewItemId: row.id,
        actorId: ACTOR,
        status: "approved",
        resolution:
          "Repair already kept the stored claim; the incoming extract was not applied. Leftover conflict review closed.",
      });
    }
    closed += 1;
  }
  return { closed: opts?.dryRun ? 0 : closed, skippedLevel, samples };
}

export async function rejectJunkReviews(
  db: Sql,
  opts?: { limit?: number; dryRun?: boolean },
): Promise<{ rejected: number; hidden: number; samples: Array<{ id: string; name: string; reason: string }> }> {
  const limit = Math.min(100, opts?.limit ?? 50);
  const rows = await db.query<{
    id: string;
    entity_id: string | null;
    canonical_name: string | null;
    visibility: string | null;
    reason: string;
  }>(
    `select r.id, r.entity_id, e.canonical_name, e.visibility, r.reason
     from review_items r
     left join entities e on e.id = r.entity_id
     where r.status = 'pending'
     order by r.generated_at
     limit $1`,
    [limit * 4],
  );
  let rejected = 0;
  let hidden = 0;
  const samples: Array<{ id: string; name: string; reason: string }> = [];
  for (const row of rows) {
    const name = row.canonical_name ?? "";
    if (!name) continue;
    const junk = isJointVentureName(name) || isMalformedCompanyName(name);
    if (!junk) continue;
    if (row.visibility === "public") continue;
    samples.push({ id: row.id, name, reason: isJointVentureName(name) ? "joint_venture" : "malformed_name" });
    if (opts?.dryRun) continue;
    await closeReview(db, {
      reviewItemId: row.id,
      actorId: ACTOR,
      status: "rejected",
      resolution: isJointVentureName(name)
        ? "Joint-venture name is not a single legal entity."
        : "Malformed or non-entity name; not a company record.",
    });
    rejected += 1;
    if (row.entity_id && row.visibility && row.visibility !== "public") {
      await db.query(
        "update entities set visibility = 'hidden', updated_at = now() where id = $1 and visibility <> 'public'",
        [row.entity_id],
      );
      hidden += 1;
    }
    if (rejected >= limit) break;
  }
  return { rejected: opts?.dryRun ? 0 : rejected, hidden: opts?.dryRun ? 0 : hidden, samples: samples.slice(0, 25) };
}

export async function copyRegistrationFromCertificateClaims(
  db: Sql,
  opts?: { limit?: number; dryRun?: boolean },
): Promise<{
  copied: number;
  skippedConflict: number;
  skippedInvalid: number;
  samples: Array<{ entityId: string; name: string; registration: string; via: string }>;
}> {
  const limit = Math.min(200, opts?.limit ?? 80);
  const rows = await db.query<{
    entity_id: string;
    canonical_name: string;
    value: string | null;
    via: string;
  }>(
    `select x.entity_id, x.canonical_name, x.value, x.via from (
       select e.id as entity_id, e.canonical_name, cs.registration_number as value, 'current_state' as via
       from entities e
       join entity_current_state cs on cs.entity_id = e.id
       where e.visibility = 'public' and e.merged_into_id is null
         and (e.registration_number is null or btrim(e.registration_number) = '')
         and cs.registration_number is not null
       union all
       select e.id, e.canonical_name, pc.value, 'published_claim'
       from entities e
       join published_claims pc on pc.entity_id = e.id and pc.field_key = 'registration_number'
       where e.visibility = 'public' and e.merged_into_id is null
         and (e.registration_number is null or btrim(e.registration_number) = '')
         and pc.value is not null
       union all
       select e.id, e.canonical_name, coalesce(c.normalized_value, c.raw_value), 'certificate_claim'
       from entities e
       join evidence_entity_links l on l.entity_id = e.id
       join evidence ev on ev.id = l.evidence_id
       join extracted_claims c on c.evidence_id = ev.id and c.field_key = 'registration_number'
       where e.visibility = 'public' and e.merged_into_id is null
         and (e.registration_number is null or btrim(e.registration_number) = '')
         and ev.publication_state = 'published'
         and ev.evidence_type in ('bee_certificate','sworn_affidavit')
     ) x
     limit $1`,
    [limit * 3],
  );

  const byEntity = new Map<string, { name: string; values: Set<string>; via: string }>();
  for (const row of rows) {
    const formatted = formatZaRegistration(row.value);
    if (!formatted) continue;
    if (isVerifierRegistration(formatted)) continue;
    const cur = byEntity.get(row.entity_id) ?? { name: row.canonical_name, values: new Set(), via: row.via };
    cur.values.add(formatted);
    if (row.via === "current_state") cur.via = row.via;
    byEntity.set(row.entity_id, cur);
  }

  let copied = 0;
  let skippedConflict = 0;
  let skippedInvalid = 0;
  const samples: Array<{ entityId: string; name: string; registration: string; via: string }> = [];

  for (const [entityId, info] of byEntity) {
    if (info.values.size !== 1) {
      skippedInvalid += 1;
      continue;
    }
    const registration = [...info.values][0]!;
    const clash = await db.query<{ id: string; canonical_name: string }>(
      `select id, canonical_name from entities
       where registration_number_normalized = $1 and id <> $2 and merged_into_id is null
       limit 1`,
      [normalizeRegistration(registration), entityId],
    );
    if (clash[0]) {
      skippedConflict += 1;
      continue;
    }
    if (!opts?.dryRun) {
      try {
        await updateEntity(db, {
          id: entityId,
          registrationNumber: registration,
          actorId: ACTOR,
        });
        await audit(db, {
          actorType: "import",
          actorId: ACTOR,
          action: "entity.registration_copied",
          targetType: "entity",
          targetId: entityId,
          after: { registration, via: info.via },
          reason: "Copied from published certificate claim; entity had no registration number.",
        });
      } catch {
        skippedConflict += 1;
        continue;
      }
    }
    copied += 1;
    if (samples.length < 25) samples.push({ entityId, name: info.name, registration, via: info.via });
    if (copied >= limit) break;
  }
  return { copied: opts?.dryRun ? 0 : copied, skippedConflict, skippedInvalid, samples };
}

export async function clearVerifierCopiedRegistrations(
  db: Sql,
  opts?: { dryRun?: boolean },
): Promise<{ cleared: number; samples: Array<{ id: string; name: string; registration: string }> }> {
  const rows = await db.query<{ id: string; canonical_name: string; registration_number: string }>(
    `select id, canonical_name, registration_number from entities
     where merged_into_id is null
       and registration_number_normalized = any($1::text[])`,
    [[...new Set(["199500052307", "200200136407", "200101796307", "200102796307"])]],
  );
  const samples = rows.map((r) => ({
    id: r.id,
    name: r.canonical_name,
    registration: r.registration_number,
  }));
  if (!opts?.dryRun) {
    for (const row of rows) {
      if (/empowerlogic|aqrate|empowerdex/i.test(row.canonical_name)) continue;
      await updateEntity(db, {
        id: row.id,
        registrationNumber: null,
        actorId: ACTOR,
      });
      await audit(db, {
        actorType: "import",
        actorId: ACTOR,
        action: "entity.registration_cleared",
        targetType: "entity",
        targetId: row.id,
        before: { registration: row.registration_number },
        reason: "Registration matched a known verification-agency number, not the measured entity.",
      });
    }
  }
  return { cleared: opts?.dryRun ? 0 : samples.filter((s) => !/empowerlogic|aqrate|empowerdex/i.test(s.name)).length, samples };
}

export async function mergeNormalizedDuplicates(
  db: Sql,
  opts?: { limit?: number; dryRun?: boolean },
): Promise<{
  merged: number;
  skippedConflict: number;
  samples: Array<{ survivor: string; absorbed: string; name: string }>;
}> {
  const limit = Math.min(40, opts?.limit ?? 20);
  const groups = await db.query<{
    normalized_name: string;
    ids: string;
    names: string;
    regs: string;
    vis: string;
  }>(
    `select normalized_name,
            string_agg(id, ',' order by created_at) as ids,
            string_agg(canonical_name, ' | ' order by created_at) as names,
            string_agg(coalesce(registration_number_normalized, ''), ',' order by created_at) as regs,
            string_agg(visibility, ',' order by created_at) as vis
     from entities
     where merged_into_id is null
     group by normalized_name
     having count(*) = 2
     limit 80`,
  );
  const days = await getExpiringSoonDays(db);
  let merged = 0;
  let skippedConflict = 0;
  const samples: Array<{ survivor: string; absorbed: string; name: string }> = [];

  for (const group of groups) {
    const ids = group.ids.split(",");
    if (ids.length !== 2) continue;
    const regs = group.regs.split(",");
    const distinctRegs = [...new Set(regs.filter(Boolean))];
    if (distinctRegs.length > 1) {
      skippedConflict += 1;
      continue;
    }
    const a = ids[0]!;
    const b = ids[1]!;
    const counts = await db.query<{ id: string; n: number; visibility: string; has_reg: number }>(
      `select e.id, e.visibility,
              (select count(*)::int from evidence_entity_links l where l.entity_id = e.id) as n,
              case when e.registration_number is null then 0 else 1 end as has_reg
       from entities e where e.id = $1 or e.id = $2`,
      [a, b],
    );
    if (counts.length !== 2) continue;
    const ranked = [...counts].sort((x, y) => {
      if (x.visibility === "public" && y.visibility !== "public") return -1;
      if (y.visibility === "public" && x.visibility !== "public") return 1;
      if (x.has_reg !== y.has_reg) return y.has_reg - x.has_reg;
      return y.n - x.n;
    });
    const survivor = ranked[0]!;
    const absorbed = ranked[1]!;
    samples.push({
      survivor: survivor.id,
      absorbed: absorbed.id,
      name: group.names,
    });
    if (!opts?.dryRun) {
      const out = await mergeEntities(db, {
        survivorId: survivor.id,
        absorbedId: absorbed.id,
        actorId: ACTOR,
        notes: "Exact normalized-name duplicate with non-conflicting registration.",
        expiringSoonDays: days,
      });
      if (!out.ok) {
        skippedConflict += 1;
        continue;
      }
      const leftover = await db.query<{ id: string }>(
        `select id from review_items
         where status = 'pending' and type = 'potential_duplicate_entity'
           and (entity_id = $1 or entity_id = $2)`,
        [survivor.id, absorbed.id],
      );
      for (const row of leftover) {
        await closeReview(db, {
          reviewItemId: row.id,
          actorId: ACTOR,
          status: "approved",
          resolution: "Duplicate entities merged on identical normalized name.",
        });
      }
    }
    merged += 1;
    if (merged >= limit) break;
  }
  return { merged: opts?.dryRun ? 0 : merged, skippedConflict, samples };
}

export type IdentityPatch = {
  canonicalName: string;
  legalName?: string;
  tradingName?: string;
  registrationNumber?: string;
  replaceRegistrationIf?: string;
  website?: string;
  aliases?: string[];
  sectorIds?: string[];
  parentName?: string;
  jseListed?: boolean;
  sources?: Array<{ url: string; sourceType?: string; frequency?: "daily" | "weekly" | "monthly" | "manual" }>;
};

export async function applyIdentityBatch(
  db: Sql,
  items: IdentityPatch[],
): Promise<{
  updated: number;
  notFound: string[];
  skippedReg: Array<{ name: string; reason: string }>;
  results: Array<{ name: string; entityId: string; filled: string[] }>;
}> {
  const results: Array<{ name: string; entityId: string; filled: string[] }> = [];
  const notFound: string[] = [];
  const skippedReg: Array<{ name: string; reason: string }> = [];
  let updated = 0;

  for (const item of items) {
    const found = await findEntityByNameOrReg(db, {
      canonicalName: item.canonicalName,
      registrationNumber: item.registrationNumber,
    });
    if (!found) {
      notFound.push(item.canonicalName);
      continue;
    }
    const row = (
      await db.query<{
        id: string;
        registration_number: string | null;
        website: string | null;
        legal_name: string | null;
        trading_name: string | null;
      }>("select id, registration_number, website, legal_name, trading_name from entities where id = $1", [found.id])
    )[0];
    if (!row) {
      notFound.push(item.canonicalName);
      continue;
    }
    const filled: string[] = [];
    const patch: Parameters<typeof updateEntity>[1] = { id: row.id, actorId: ACTOR };

    if (item.registrationNumber && isZaCompanyRegistration(item.registrationNumber)) {
      const formatted = formatZaRegistration(item.registrationNumber)!;
      if (isVerifierRegistration(formatted)) {
        skippedReg.push({ name: item.canonicalName, reason: "verifier_agency_registration" });
      } else if (!row.registration_number || isVerifierRegistration(row.registration_number) ||
          (item.replaceRegistrationIf &&
            normalizeRegistration(row.registration_number) === normalizeRegistration(item.replaceRegistrationIf))) {
        const clash = await db.query<{ id: string }>(
          `select id from entities
           where registration_number_normalized = $1 and id <> $2 and merged_into_id is null
           limit 1`,
          [normalizeRegistration(formatted), row.id],
        );
        if (clash[0]) {
          skippedReg.push({ name: item.canonicalName, reason: "registration_belongs_to_another_entity" });
        } else {
          patch.registrationNumber = formatted;
          filled.push("registration_number");
        }
      } else if (normalizeRegistration(row.registration_number) !== normalizeRegistration(formatted)) {
        skippedReg.push({ name: item.canonicalName, reason: "existing_registration_preserved" });
      }
    } else if (item.registrationNumber) {
      skippedReg.push({ name: item.canonicalName, reason: "invalid_registration_format" });
    }

    if (item.website && !row.website) {
      try {
        const u = new URL(item.website);
        if (u.protocol === "http:" || u.protocol === "https:") {
          patch.website = item.website;
          filled.push("website");
        }
      } catch {
        /* skip bad url */
      }
    }
    if (item.legalName && !row.legal_name) {
      patch.legalName = item.legalName;
      filled.push("legal_name");
    }
    if (item.tradingName && !row.trading_name) {
      patch.tradingName = item.tradingName;
      filled.push("trading_name");
    }

    if (filled.some((f) => ["registration_number", "website", "legal_name", "trading_name"].includes(f))) {
      await updateEntity(db, patch);
    }

    for (const alias of item.aliases ?? []) {
      if (alias.trim() && normalizeName(alias) !== normalizeName(item.canonicalName)) {
        await addAlias(db, { entityId: row.id, alias: alias.trim(), aliasType: "other", actorId: ACTOR });
        filled.push(`alias:${alias.trim()}`);
      }
    }

    const sectors = new Set(item.sectorIds ?? []);
    sectors.delete("sec_jse");
    sectors.delete("sec_government_suppliers");
    if (item.jseListed) {
      try {
        await setClassification(db, {
          entityId: row.id,
          sectorId: "sec_jse",
          actorId: ACTOR,
          classificationType: "listing",
        });
        filled.push("listing:jse");
      } catch {
        /* unknown sector */
      }
    }
    for (const sectorId of sectors) {
      try {
        await setClassification(db, { entityId: row.id, sectorId, actorId: ACTOR });
        filled.push(`sector:${sectorId}`);
      } catch {
        /* unknown sector */
      }
    }

    if (item.parentName?.trim()) {
      const parent = await findEntityByNameOrReg(db, { canonicalName: item.parentName.trim() });
      if (parent && parent.id !== row.id) {
        const already = await db.query<{ id: string }>(
          `select id from entity_relationships
           where source_entity_id = $1 and target_entity_id = $2 and relationship_type = 'parent'
           limit 1`,
          [row.id, parent.id],
        );
        if (!already[0]) {
          await createRelationship(db, {
            sourceEntityId: row.id,
            targetEntityId: parent.id,
            relationshipType: "parent",
            publicStatus: "public",
            actorId: ACTOR,
          });
          filled.push(`parent:${item.parentName.trim()}`);
        }
      }
    }

    for (const source of item.sources ?? []) {
      try {
        await createSource(db, {
          url: source.url,
          entityId: row.id,
          sourceType: source.sourceType ?? "other",
          frequency: source.frequency ?? "monthly",
          crawlConfig: {
            urlPatterns: ["bbbee", "b-bbee", "bee-certificate", "transformation", "sustainability", "scorecard"],
            maxLinks: 40,
            maxDepth: 1,
          },
          actorId: ACTOR,
        });
        filled.push(`source:${source.url}`);
      } catch {
        /* bad url */
      }
    }

    if (filled.length) updated += 1;
    results.push({ name: item.canonicalName, entityId: row.id, filled });
  }
  return { updated, notFound, skippedReg, results };
}

export async function applySectorsBatch(
  db: Sql,
  items: Array<{ canonicalName: string; sectorIds: string[] }>,
): Promise<{ assigned: number; notFound: string[] }> {
  let assigned = 0;
  const notFound: string[] = [];
  for (const item of items) {
    const found = await findEntityByNameOrReg(db, { canonicalName: item.canonicalName });
    if (!found) {
      notFound.push(item.canonicalName);
      continue;
    }
    for (const sectorId of item.sectorIds) {
      try {
        await setClassification(db, { entityId: found.id, sectorId, actorId: ACTOR });
        assigned += 1;
      } catch {
        /* skip */
      }
    }
  }
  return { assigned, notFound };
}

export async function ensureCompanyWebsiteSources(
  db: Sql,
  opts?: { limit?: number; dryRun?: boolean },
): Promise<{ created: number; samples: Array<{ name: string; url: string }> }> {
  const limit = Math.min(40, opts?.limit ?? 20);
  const rows = await db.query<{ id: string; canonical_name: string; website: string }>(
    `select e.id, e.canonical_name, e.website
     from entities e
     where e.visibility = 'public' and e.merged_into_id is null
       and e.website is not null and btrim(e.website) <> ''
       and not exists (
         select 1 from monitored_sources s
         where s.entity_id = e.id
           and s.domain = regexp_replace(lower(split_part(regexp_replace(e.website, '^https?://', ''), '/', 1)), '^www\\.', '')
       )
     order by e.updated_at desc
     limit $1`,
    [limit],
  );
  const samples: Array<{ name: string; url: string }> = [];
  let created = 0;
  for (const row of rows) {
    let url = row.website.trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    samples.push({ name: row.canonical_name, url });
    if (opts?.dryRun) continue;
    try {
      await createSource(db, {
        url,
        entityId: row.id,
        sourceType: "company_webpage",
        frequency: "monthly",
        crawlConfig: {
          urlPatterns: ["bbbee", "b-bbee", "bee", "transformation", "sustainability", "certificate", "scorecard"],
          maxLinks: 40,
          maxDepth: 1,
        },
        actorId: ACTOR,
      });
      created += 1;
    } catch {
      /* skip */
    }
  }
  return { created: opts?.dryRun ? 0 : created, samples };
}

export async function listPriorityQueue(db: Sql, queue: string, limit = 40) {
  const pred = queuePredicate(queue);
  if (!pred) return { queue, error: "unknown_queue", items: [] };
  const cap = Math.min(80, Math.max(1, limit));
  const items = await db.query<{
    id: string;
    slug: string;
    canonical_name: string;
    registration_number: string | null;
    website: string | null;
    evidence_n: number;
    procurement_n: number;
    latest_year: number | null;
  }>(
    `select e.id, e.slug, e.canonical_name, e.registration_number, e.website,
            (select count(*)::int from evidence_entity_links l
             join evidence ev on ev.id = l.evidence_id
             where l.entity_id = e.id and ev.publication_state = 'published') as evidence_n,
            (select count(*)::int from evidence_entity_links l
             join evidence ev on ev.id = l.evidence_id
             where l.entity_id = e.id and ev.evidence_type = 'government_procurement_disclosure'
               and ev.publication_state = 'published') as procurement_n,
            (select max(extract(year from ev.issue_date)::int)
             from evidence_entity_links l
             join evidence ev on ev.id = l.evidence_id
             where l.entity_id = e.id and ev.evidence_type = 'government_procurement_disclosure') as latest_year
     from entities e
     where e.merged_into_id is null and e.visibility = 'public' and ${pred}
     order by evidence_n desc, e.canonical_name
     limit $1`,
    [cap],
  );
  return { queue, items };
}

export { isZaCompanyRegistration, formatZaRegistration };
