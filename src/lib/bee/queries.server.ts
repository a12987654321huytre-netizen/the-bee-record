import { workingClaims, workingValue } from "./claims.server.ts";
import { jsonParse, type Sql } from "./db-types.ts";
import { LATEST_EVIDENCE_SQL_RANK } from "./latest-evidence.ts";
import type { CurrentState, EntityRow, EvidenceRow } from "./types.ts";

export type PublicStats = {
  companies: number;
  evidence: number;
  historical: number;
  verifiers: number;
  updated30d: number;
  currentCertificates: number;
  officialDisclosures: number;
  recentCompanies: number;
  historicalOnly: number;
  undatedOfficial: number;
  with2026: number;
  with2025: number;
  with2024: number;
};

export async function publicStats(db: Sql): Promise<PublicStats> {
  const companies = await db.query<{ n: number }>(
    "select count(*)::int as n from entities where visibility = 'public' and merged_into_id is null",
  );
  const evidence = await db.query<{ n: number }>(
    "select count(*)::int as n from evidence where publication_state = 'published'",
  );
  const historical = await db.query<{ n: number }>(
    "select count(*)::int as n from evidence where publication_state = 'published' and lifecycle_state in ('historical','superseded','expired')",
  );
  const verifiers = await db.query<{ n: number }>(
    "select count(*)::int as n from verification_agencies where visibility = 'public'",
  );
  const updated30d = await db.query<{ n: number }>(
    "select count(*)::int as n from publication_events where published_at >= now() - interval '30 days'",
  );
  const currentCertificates = await db.query<{ n: number }>(
    `select count(*)::int as n from evidence
     where publication_state = 'published'
       and lifecycle_state in ('current','expiring_soon')
       and evidence_type in ('bee_certificate','sworn_affidavit')`,
  );
  const officialDisclosures = await db.query<{ n: number }>(
    "select count(*)::int as n from evidence where publication_state = 'published' and evidence_type = 'government_procurement_disclosure'",
  );
  const yearCount = async (year: number) =>
    (
      await db.query<{ n: number }>(
        `select count(distinct e.id)::int as n
         from entities e
         join evidence_entity_links l on l.entity_id = e.id and l.link_state in ('confirmed','extracted')
         join evidence ev on ev.id = l.evidence_id and ev.publication_state = 'published'
         where e.visibility = 'public' and e.merged_into_id is null
           and ev.issue_date is not null and extract(year from ev.issue_date)::int = $1`,
        [year],
      )
    )[0]?.n ?? 0;
  const recentCompanies = await db.query<{ n: number }>(
    `select count(distinct e.id)::int as n
     from entities e
     join evidence_entity_links l on l.entity_id = e.id and l.link_state in ('confirmed','extracted')
     join evidence ev on ev.id = l.evidence_id and ev.publication_state = 'published'
     where e.visibility = 'public' and e.merged_into_id is null
       and ev.issue_date is not null and ev.issue_date >= '2024-01-01'`,
  );
  const historicalOnly = await db.query<{ n: number }>(
    `select count(*)::int as n from entities e
     where e.visibility = 'public' and e.merged_into_id is null
       and exists (
         select 1 from evidence_entity_links l
         join evidence ev on ev.id = l.evidence_id
         where l.entity_id = e.id and l.link_state in ('confirmed','extracted')
           and ev.publication_state = 'published' and ev.issue_date is not null and ev.issue_date < '2024-01-01'
       )
       and not exists (
         select 1 from evidence_entity_links l
         join evidence ev on ev.id = l.evidence_id
         where l.entity_id = e.id and l.link_state in ('confirmed','extracted')
           and ev.publication_state = 'published'
           and (
             (ev.issue_date is not null and ev.issue_date >= '2024-01-01')
             or (ev.evidence_type in ('bee_certificate','sworn_affidavit') and ev.lifecycle_state in ('current','expiring_soon'))
           )
       )`,
  );
  const undatedOfficial = await db.query<{ n: number }>(
    `select count(*)::int as n from entities e
     where e.visibility = 'public' and e.merged_into_id is null
       and exists (
         select 1 from evidence_entity_links l
         join evidence ev on ev.id = l.evidence_id
         where l.entity_id = e.id and l.link_state in ('confirmed','extracted') and ev.publication_state = 'published'
       )
       and not exists (
         select 1 from evidence_entity_links l
         join evidence ev on ev.id = l.evidence_id
         where l.entity_id = e.id and l.link_state in ('confirmed','extracted')
           and ev.publication_state = 'published' and ev.issue_date is not null
       )
       and not exists (
         select 1 from evidence_entity_links l
         join evidence ev on ev.id = l.evidence_id
         where l.entity_id = e.id and l.link_state in ('confirmed','extracted')
           and ev.publication_state = 'published'
           and ev.evidence_type in ('bee_certificate','sworn_affidavit')
           and ev.lifecycle_state in ('current','expiring_soon')
       )`,
  );
  return {
    companies: companies[0]?.n ?? 0,
    evidence: evidence[0]?.n ?? 0,
    historical: historical[0]?.n ?? 0,
    verifiers: verifiers[0]?.n ?? 0,
    updated30d: updated30d[0]?.n ?? 0,
    currentCertificates: currentCertificates[0]?.n ?? 0,
    officialDisclosures: officialDisclosures[0]?.n ?? 0,
    recentCompanies: recentCompanies[0]?.n ?? 0,
    historicalOnly: historicalOnly[0]?.n ?? 0,
    undatedOfficial: undatedOfficial[0]?.n ?? 0,
    with2026: await yearCount(2026),
    with2025: await yearCount(2025),
    with2024: await yearCount(2024),
  };
}

export async function listSectors(db: Sql) {
  return db.query<{ id: string; slug: string; name: string; description: string | null; n: number }>(
    `select s.id, s.slug, s.name, s.description, count(ec.id)::int as n
     from sectors s
     left join entity_classifications ec on ec.sector_id = s.id and ec.is_public = 1
     left join entities e on e.id = ec.entity_id and e.visibility = 'public' and e.merged_into_id is null
     group by s.id, s.slug, s.name, s.description
     order by s.name`,
  );
}

export type CompanyListItem = {
  id: string;
  slug: string;
  canonical_name: string;
  registration_number: string | null;
  bee_level: string | null;
  expiry_date: string | null;
  lifecycle_state: string | null;
  agency_name: string | null;
  updated_at: string;
  sector_names: string | null;
  has_disclosure: boolean;
  current_evidence_type: string | null;
  disclosure_level: string | null;
  disclosure_date: string | null;
  disclosure_url: string | null;
  disclosure_title: string | null;
  latest_evidence_id: string | null;
  latest_evidence_type: string | null;
  latest_lifecycle: string | null;
  latest_level: string | null;
  latest_date: string | null;
  latest_date_precision: string | null;
  latest_date_raw: string | null;
  latest_title: string | null;
  latest_url: string | null;
  latest_issuer: string | null;
  latest_agency: string | null;
  latest_expiry: string | null;
  latest_domain: string | null;
  latest_created_at: string | null;
  latest_retrieved_at: string | null;
  latest_discovered_at: string | null;
};

export async function listPublicCompanies(
  db: Sql,
  input: {
    q?: string;
    level?: string;
    sector?: string;
    agency?: string;
    lifecycle?: string;
    evidenceType?: string;
    year?: string;
    page?: number;
    pageSize?: number;
    sort?: string;
  },
): Promise<{ items: CompanyListItem[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, input.pageSize ?? 25));
  const where: string[] = ["e.visibility = 'public'", "e.merged_into_id is null"];
  const params: unknown[] = [];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (input.q?.trim()) {
    const raw = input.q.trim();
    const like = `%${raw}%`;
    const p1 = add(like);
    const p2 = add(raw.toLowerCase().replace(/[^a-z0-9]/g, ""));
    where.push(`(
      e.canonical_name ilike ${p1}
      or e.legal_name ilike ${p1}
      or e.trading_name ilike ${p1}
      or e.registration_number ilike ${p1}
      or e.registration_number_normalized = ${p2}
      or exists (select 1 from entity_aliases a where a.entity_id = e.id and (a.alias ilike ${p1} or a.normalized_alias ilike ${p1}))
    )`);
  }
  if (input.level) {
    where.push(`coalesce(latest.reported_level, cs.bee_level) = ${add(input.level)}`);
  }
  if (input.lifecycle) {
    where.push(`cs.lifecycle_state = ${add(input.lifecycle)}`);
  }
  if (input.sector) {
    where.push(
      `exists (select 1 from entity_classifications ec join sectors s on s.id = ec.sector_id where ec.entity_id = e.id and s.slug = ${add(input.sector)} and ec.is_public = 1)`,
    );
  }
  if (input.agency) {
    const slugP = add(input.agency);
    where.push(
      `(exists (select 1 from verification_agencies va where va.id = cs.verifier_agency_id and va.slug = ${slugP}) or latest.agency_slug = ${slugP})`,
    );
  }
  if (input.year && /^\d{4}$/.test(input.year)) {
    where.push(`latest.issue_date is not null and extract(year from latest.issue_date)::int = ${add(Number(input.year))}`);
  }
  if (input.evidenceType === "current_certificate") {
    where.push(`exists (
      select 1 from evidence ev
      join evidence_entity_links l on l.evidence_id = ev.id
      where l.entity_id = e.id and l.link_state in ('confirmed','extracted')
        and ev.publication_state = 'published'
        and ev.evidence_type in ('bee_certificate','sworn_affidavit')
        and ev.lifecycle_state in ('current','expiring_soon')
    )`);
  } else if (input.evidenceType === "recent_evidence" || input.evidenceType === "official_procurement_disclosure") {
    where.push(`exists (
      select 1 from evidence ev
      join evidence_entity_links l on l.evidence_id = ev.id
      where l.entity_id = e.id and l.link_state in ('confirmed','extracted')
        and ev.publication_state = 'published'
        and ev.issue_date is not null and ev.issue_date >= '2024-01-01'
        ${input.evidenceType === "official_procurement_disclosure" ? "and ev.evidence_type = 'government_procurement_disclosure'" : ""}
    )`);
  } else if (input.evidenceType === "official_company_disclosure") {
    where.push(`exists (
      select 1 from evidence ev
      join evidence_entity_links l on l.evidence_id = ev.id
      where l.entity_id = e.id and l.link_state in ('confirmed','extracted')
        and ev.publication_state = 'published'
        and ev.evidence_type in ('company_disclosure','annual_report','integrated_report','esg_report','sustainability_report','transformation_report','investor_document')
        and ev.issue_date is not null and ev.issue_date >= '2024-01-01'
    )`);
  } else if (input.evidenceType === "historical_disclosure" || input.evidenceType === "historical_evidence") {
    where.push(`exists (
      select 1 from evidence ev
      join evidence_entity_links l on l.evidence_id = ev.id
      where l.entity_id = e.id and l.link_state in ('confirmed','extracted')
        and ev.publication_state = 'published' and ev.issue_date is not null and ev.issue_date < '2024-01-01'
    ) and not exists (
      select 1 from evidence ev
      join evidence_entity_links l on l.evidence_id = ev.id
      where l.entity_id = e.id and l.link_state in ('confirmed','extracted')
        and ev.publication_state = 'published'
        and (
          (ev.issue_date is not null and ev.issue_date >= '2024-01-01')
          or (ev.evidence_type in ('bee_certificate','sworn_affidavit') and ev.lifecycle_state in ('current','expiring_soon'))
        )
    )`);
  } else if (input.evidenceType === "date_not_stated") {
    where.push(`exists (
      select 1 from evidence ev
      join evidence_entity_links l on l.evidence_id = ev.id
      where l.entity_id = e.id and l.link_state in ('confirmed','extracted') and ev.publication_state = 'published'
    ) and not exists (
      select 1 from evidence ev
      join evidence_entity_links l on l.evidence_id = ev.id
      where l.entity_id = e.id and l.link_state in ('confirmed','extracted')
        and ev.publication_state = 'published' and ev.issue_date is not null
    )`);
  }

  const latestJoin = `
     left join lateral (
       select ev.id,
              ev.evidence_type,
              ev.lifecycle_state,
              ev.issue_date,
              ev.issue_date_precision,
              ev.issue_date_raw,
              ev.expiry_date,
              ev.title,
              ev.source_url,
              ev.document_issuer,
              ev.source_domain,
              va.name as agency_name,
              va.slug as agency_slug,
              ev.created_at,
              ev.retrieved_at,
              ev.discovered_at,
              (select coalesce(c.edited_value, c.normalized_value, c.raw_value)
               from extracted_claims c
               join extraction_runs r on r.id = c.extraction_run_id
               where c.evidence_id = ev.id and c.field_key = 'bee_level' and r.success = 1
               order by r.started_at desc
               limit 1) as reported_level
       from evidence ev
       join evidence_entity_links l on l.evidence_id = ev.id
       left join verification_agencies va on va.id = ev.verifier_agency_id
       where l.entity_id = e.id
         and l.link_state in ('confirmed','extracted')
         and ev.publication_state = 'published'
       order by ${LATEST_EVIDENCE_SQL_RANK} desc,
                ev.issue_date desc nulls last,
                ev.id desc
       limit 1
     ) latest on true`;

  const whereSql = where.join(" and ");
  const totalRows = await db.query<{ n: number }>(
    `select count(*)::int as n
     from entities e
     left join entity_current_state cs on cs.entity_id = e.id
     ${latestJoin}
     where ${whereSql}`,
    params,
  );
  const offset = (page - 1) * pageSize;
  const limitP = add(pageSize);
  const offsetP = add(offset);
  const items = await db.query<CompanyListItem>(
    `select e.id, e.slug, e.canonical_name, e.registration_number,
            cs.bee_level, cs.expiry_date, cs.lifecycle_state, e.updated_at,
            va.name as agency_name,
            (select string_agg(s.name, ', ' order by s.name)
             from entity_classifications ec
             join sectors s on s.id = ec.sector_id
             where ec.entity_id = e.id and ec.is_public = 1) as sector_names,
            exists (
              select 1 from evidence ev
              join evidence_entity_links l on l.evidence_id = ev.id
              where l.entity_id = e.id
                and l.link_state in ('confirmed','extracted')
                and ev.publication_state = 'published'
                and ev.evidence_type = 'government_procurement_disclosure'
            ) as has_disclosure,
            (select ev.evidence_type from evidence ev where ev.id = cs.evidence_id) as current_evidence_type,
            latest.reported_level as disclosure_level,
            latest.issue_date as disclosure_date,
            latest.source_url as disclosure_url,
            latest.title as disclosure_title,
            latest.id as latest_evidence_id,
            latest.evidence_type as latest_evidence_type,
            latest.lifecycle_state as latest_lifecycle,
            latest.reported_level as latest_level,
            latest.issue_date as latest_date,
            latest.issue_date_precision as latest_date_precision,
            latest.issue_date_raw as latest_date_raw,
            latest.title as latest_title,
            latest.source_url as latest_url,
            latest.document_issuer as latest_issuer,
            latest.agency_name as latest_agency,
            latest.expiry_date as latest_expiry,
            latest.source_domain as latest_domain,
            latest.created_at as latest_created_at,
            latest.retrieved_at as latest_retrieved_at,
            latest.discovered_at as latest_discovered_at
     from entities e
     left join entity_current_state cs on cs.entity_id = e.id
     left join verification_agencies va on va.id = cs.verifier_agency_id
     ${latestJoin}
     where ${whereSql}
     order by e.canonical_name
     limit ${limitP} offset ${offsetP}`,
    params,
  );
  return { items, total: totalRows[0]?.n ?? 0, page, pageSize };
}

export async function searchAcross(
  db: Sql,
  q: string,
  limit = 20,
): Promise<{
  companies: Array<{ id: string; slug: string; name: string; kind: string; extra: string | null }>;
  agencies: Array<{ id: string; slug: string; name: string }>;
}> {
  const like = `%${q.trim()}%`;
  const companies = await db.query<{ id: string; slug: string; name: string; kind: string; extra: string | null }>(
    `select distinct e.id, e.slug, e.canonical_name as name,
            'company' as kind, e.registration_number as extra
     from entities e
     left join entity_aliases a on a.entity_id = e.id
     where e.visibility = 'public' and e.merged_into_id is null
       and (e.canonical_name ilike $1 or e.legal_name ilike $1 or e.trading_name ilike $1
            or e.registration_number ilike $1 or a.alias ilike $1)
     order by e.canonical_name
     limit $2`,
    [like, limit],
  );
  const agencies = await db.query<{ id: string; slug: string; name: string }>(
    `select distinct v.id, v.slug, v.name
     from verification_agencies v
     left join agency_aliases a on a.agency_id = v.id
     where v.visibility = 'public' and (v.name ilike $1 or a.alias ilike $1)
     order by v.name
     limit $2`,
    [like, limit],
  );
  return { companies, agencies };
}

export async function getPublicEntity(db: Sql, slug: string) {
  const entities = await db.query<EntityRow>("select * from entities where slug = $1 limit 1", [slug]);
  const entity = entities[0];
  if (!entity) return null;
  if (entity.merged_into_id) {
    const survivor = await db.query<{ slug: string }>("select slug from entities where id = $1", [entity.merged_into_id]);
    return { redirectTo: survivor[0]?.slug ?? null, entity: null };
  }
  if (entity.visibility !== "public") return null;

  const current = await db.query<CurrentState>("select * from entity_current_state where entity_id = $1", [entity.id]);
  const aliases = await db.query<{ alias: string; alias_type: string }>(
    "select alias, alias_type from entity_aliases where entity_id = $1 and reviewed_status = 'reviewed' order by alias",
    [entity.id],
  );
  const sectors = await db.query<{ slug: string; name: string }>(
    `select s.slug, s.name from entity_classifications ec
     join sectors s on s.id = ec.sector_id
     where ec.entity_id = $1 and ec.is_public = 1`,
    [entity.id],
  );
  const parents = await db.query<{ id: string; slug: string; canonical_name: string; relationship_type: string }>(
    `select e.id, e.slug, e.canonical_name, r.relationship_type
     from entity_relationships r
     join entities e on e.id = r.target_entity_id
     where r.source_entity_id = $1 and r.public_status = 'public' and r.review_state = 'approved'
       and r.relationship_type in ('parent','holding_company')
       and e.visibility = 'public'`,
    [entity.id],
  );
  const children = await db.query<{ id: string; slug: string; canonical_name: string; relationship_type: string }>(
    `select e.id, e.slug, e.canonical_name, r.relationship_type
     from entity_relationships r
     join entities e on e.id = r.target_entity_id
     where r.source_entity_id = $1 and r.public_status = 'public' and r.review_state = 'approved'
       and r.relationship_type in ('subsidiary','operating_company','division','trading_brand')
       and e.visibility = 'public'`,
    [entity.id],
  );
  const evidence = await db.query<
    EvidenceRow & {
      agency_name: string | null;
      signatory_name: string | null;
      reported_bee_level: string | null;
      tender_number: string | null;
      government_institution: string | null;
      enterprise_class: string | null;
    }
  >(
    `select e.*, va.name as agency_name, sg.name as signatory_name,
            (select coalesce(c.edited_value, c.normalized_value, c.raw_value)
             from extracted_claims c
             join extraction_runs r on r.id = c.extraction_run_id
             where c.evidence_id = e.id and c.field_key = 'bee_level' and r.success = 1
             order by r.started_at desc
             limit 1) as reported_bee_level,
            (select coalesce(c.edited_value, c.normalized_value, c.raw_value)
             from extracted_claims c
             join extraction_runs r on r.id = c.extraction_run_id
             where c.evidence_id = e.id and c.field_key = 'tender_number' and r.success = 1
             order by r.started_at desc
             limit 1) as tender_number,
            (select coalesce(c.edited_value, c.normalized_value, c.raw_value)
             from extracted_claims c
             join extraction_runs r on r.id = c.extraction_run_id
             where c.evidence_id = e.id and c.field_key = 'government_institution' and r.success = 1
             order by r.started_at desc
             limit 1) as government_institution,
            (select coalesce(c.edited_value, c.normalized_value, c.raw_value)
             from extracted_claims c
             join extraction_runs r on r.id = c.extraction_run_id
             where c.evidence_id = e.id and c.field_key = 'enterprise_class' and r.success = 1
             order by r.started_at desc
             limit 1) as enterprise_class
     from evidence e
     join evidence_entity_links l on l.evidence_id = e.id
     left join verification_agencies va on va.id = e.verifier_agency_id
     left join signatories sg on sg.id = e.signatory_id
     where l.entity_id = $1 and l.link_state in ('confirmed','extracted')
       and e.publication_state = 'published'
     order by e.issue_date desc nulls last, e.id desc`,
    [entity.id],
  );
  const publishedClaims = await db.query<{
    field_key: string;
    value: string | null;
    evidence_id: string;
    published_at: string;
    published_by: string;
    rule_version: string | null;
    claim_id: string | null;
  }>("select field_key, value, evidence_id, published_at, published_by, rule_version, claim_id from published_claims where entity_id = $1", [
    entity.id,
  ]);
  const events = await db.query<{
    id: string;
    event_type: string;
    summary: string;
    published_at: string;
    evidence_id: string;
    previous_evidence_id: string | null;
  }>(
    "select id, event_type, summary, published_at, evidence_id, previous_evidence_id from publication_events where entity_id = $1 order by published_at desc",
    [entity.id],
  );
  const agency =
    current[0]?.verifier_agency_id
      ? (
          await db.query<{ id: string; slug: string; name: string }>(
            "select id, slug, name from verification_agencies where id = $1",
            [current[0].verifier_agency_id],
          )
        )[0]
      : null;
  const supporting = evidence.find((e) => e.id === current[0]?.evidence_id) ?? evidence[0] ?? null;
  return {
    redirectTo: null,
    entity,
    current: current[0] ?? null,
    aliases,
    sectors,
    parents,
    children,
    evidence,
    publishedClaims,
    events,
    agency,
    supporting,
  };
}

export async function getPublicEvidence(db: Sql, id: string) {
  const rows = await db.query<EvidenceRow>("select * from evidence where id = $1", [id]);
  const evidence = rows[0];
  if (!evidence || evidence.publication_state !== "published") return null;
  const entities = await db.query<{ id: string; slug: string; canonical_name: string }>(
    `select e.id, e.slug, e.canonical_name
     from evidence_entity_links l
     join entities e on e.id = l.entity_id
     where l.evidence_id = $1 and l.link_state in ('confirmed','extracted') and e.visibility = 'public'`,
    [id],
  );
  const claims = await workingClaims(db, id);
  const agency = evidence.verifier_agency_id
    ? (
        await db.query<{ id: string; slug: string; name: string; website: string | null }>(
          "select id, slug, name, website from verification_agencies where id = $1",
          [evidence.verifier_agency_id],
        )
      )[0]
    : null;
  const signatory = evidence.signatory_id
    ? (await db.query<{ name: string; role_title: string | null }>("select name, role_title from signatories where id = $1", [evidence.signatory_id]))[0]
    : null;
  const locations = await db.query<{ url: string; discovered_at: string; last_seen_at: string }>(
    "select url, discovered_at, last_seen_at from evidence_source_locations where evidence_id = $1 order by last_seen_at desc",
    [id],
  );
  return { evidence, entities, claims, agency, signatory, locations, archived: Boolean(evidence.asset_id) };
}

export async function listPublicAgencies(db: Sql, q?: string) {
  const like = q?.trim() ? `%${q.trim()}%` : null;
  return db.query<{
    id: string;
    slug: string;
    name: string;
    website: string | null;
    evidence_count: number;
  }>(
    `select v.id, v.slug, v.name, v.website,
            (select count(*)::int from evidence e where e.verifier_agency_id = v.id and e.publication_state = 'published') as evidence_count
     from verification_agencies v
     where v.visibility = 'public'
       and ($1::text is null or v.name ilike $1)
     order by v.name`,
    [like],
  );
}

export async function getPublicAgency(db: Sql, slug: string) {
  const rows = await db.query<{
    id: string;
    name: string;
    slug: string;
    legal_name: string | null;
    website: string | null;
  }>("select id, name, slug, legal_name, website from verification_agencies where slug = $1 and visibility = 'public'", [
    slug,
  ]);
  const agency = rows[0];
  if (!agency) return null;
  const aliases = await db.query<{ alias: string }>("select alias from agency_aliases where agency_id = $1", [agency.id]);
  const accreditations = await db.query<{
    accreditation_body: string | null;
    accreditation_identifier: string | null;
    status: string | null;
    effective_from: string | null;
    effective_to: string | null;
  }>("select accreditation_body, accreditation_identifier, status, effective_from, effective_to from agency_accreditations where agency_id = $1", [
    agency.id,
  ]);
  const signatories = await db.query<{ name: string; role_title: string | null }>(
    "select name, role_title from signatories where agency_id = $1 order by name",
    [agency.id],
  );
  const evidence = await db.query<
    EvidenceRow & { entity_name: string | null; entity_slug: string | null }
  >(
    `select e.*, ent.canonical_name as entity_name, ent.slug as entity_slug
     from evidence e
     left join evidence_entity_links l on l.evidence_id = e.id and l.link_state = 'confirmed'
     left join entities ent on ent.id = l.entity_id and ent.visibility = 'public'
     where e.verifier_agency_id = $1 and e.publication_state = 'published'
     order by e.issue_date desc nulls last
     limit 100`,
    [agency.id],
  );
  return { agency, aliases, accreditations, signatories, evidence };
}

export async function listUpdates(db: Sql, page = 1, pageSize = 25) {
  const offset = (Math.max(1, page) - 1) * pageSize;
  const items = await db.query<{
    id: string;
    summary: string;
    event_type: string;
    published_at: string;
    evidence_id: string;
    previous_evidence_id: string | null;
    entity_name: string;
    entity_slug: string;
  }>(
    `select p.id, p.summary, p.event_type, p.published_at, p.evidence_id, p.previous_evidence_id,
            e.canonical_name as entity_name, e.slug as entity_slug
     from publication_events p
     join entities e on e.id = p.entity_id
     where e.visibility = 'public'
     order by p.published_at desc
     limit $1 offset $2`,
    [pageSize, offset],
  );
  const total = await db.query<{ n: number }>(
    `select count(*)::int as n from publication_events p
     join entities e on e.id = p.entity_id where e.visibility = 'public'`,
  );
  return { items, total: total[0]?.n ?? 0, page, pageSize };
}

export async function listExpiring(db: Sql, mode: "expiring" | "expired") {
  const clause = mode === "expired" ? "e.lifecycle_state = 'expired'" : "e.lifecycle_state = 'expiring_soon'";
  return db.query<
    EvidenceRow & { entity_name: string | null; entity_slug: string | null }
  >(
    `select e.*, ent.canonical_name as entity_name, ent.slug as entity_slug
     from evidence e
     left join evidence_entity_links l on l.evidence_id = e.id and l.link_state = 'confirmed'
     left join entities ent on ent.id = l.entity_id and ent.visibility = 'public'
     where e.publication_state = 'published' and ${clause}
     order by e.expiry_date ${mode === "expired" ? "desc" : "asc"} nulls last
     limit 100`,
  );
}

export async function recentHome(db: Sql) {
  const updated = await db.query<{
    slug: string;
    canonical_name: string;
    bee_level: string | null;
    lifecycle_state: string | null;
    published_at: string | null;
    current_evidence_type: string | null;
    has_disclosure: boolean;
    disclosure_level: string | null;
    disclosure_date: string | null;
    disclosure_url: string | null;
    disclosure_title: string | null;
  }>(
    `select e.slug, e.canonical_name, cs.bee_level, cs.lifecycle_state, cs.published_at,
            (select ev.evidence_type from evidence ev where ev.id = cs.evidence_id) as current_evidence_type,
            exists (
              select 1 from evidence ev
              join evidence_entity_links l on l.evidence_id = ev.id
              where l.entity_id = e.id
                and l.link_state in ('confirmed','extracted')
                and ev.publication_state = 'published'
                and ev.evidence_type = 'government_procurement_disclosure'
            ) as has_disclosure,
            (select coalesce(c.edited_value, c.normalized_value, c.raw_value)
             from evidence ev
             join evidence_entity_links l on l.evidence_id = ev.id
             join extracted_claims c on c.evidence_id = ev.id
             join extraction_runs r on r.id = c.extraction_run_id
             where l.entity_id = e.id
               and l.link_state in ('confirmed','extracted')
               and ev.publication_state = 'published'
               and ev.evidence_type = 'government_procurement_disclosure'
               and c.field_key = 'bee_level' and r.success = 1
             order by ev.issue_date desc nulls last, r.started_at desc
             limit 1) as disclosure_level,
            (select ev.issue_date
             from evidence ev
             join evidence_entity_links l on l.evidence_id = ev.id
             where l.entity_id = e.id
               and l.link_state in ('confirmed','extracted')
               and ev.publication_state = 'published'
               and ev.evidence_type = 'government_procurement_disclosure'
             order by ev.issue_date desc nulls last, ev.updated_at desc
             limit 1) as disclosure_date,
            (select ev.source_url
             from evidence ev
             join evidence_entity_links l on l.evidence_id = ev.id
             where l.entity_id = e.id
               and l.link_state in ('confirmed','extracted')
               and ev.publication_state = 'published'
               and ev.evidence_type = 'government_procurement_disclosure'
             order by ev.issue_date desc nulls last, ev.updated_at desc
             limit 1) as disclosure_url,
            (select ev.title
             from evidence ev
             join evidence_entity_links l on l.evidence_id = ev.id
             where l.entity_id = e.id
               and l.link_state in ('confirmed','extracted')
               and ev.publication_state = 'published'
               and ev.evidence_type = 'government_procurement_disclosure'
             order by ev.issue_date desc nulls last, ev.updated_at desc
             limit 1) as disclosure_title
     from entities e
     left join entity_current_state cs on cs.entity_id = e.id
     where e.visibility = 'public' and e.merged_into_id is null
     order by coalesce(cs.published_at, e.updated_at) desc
     limit 8`,
  );
  const evidence = await db.query<{
    id: string;
    title: string | null;
    evidence_type: string;
    issue_date: string | null;
    source_url: string | null;
    lifecycle_state: string | null;
    entity_name: string | null;
    entity_slug: string | null;
  }>(
    `select e.id, e.title, e.evidence_type, e.issue_date, e.source_url, e.lifecycle_state,
            ent.canonical_name as entity_name, ent.slug as entity_slug
     from evidence e
     left join evidence_entity_links l on l.evidence_id = e.id and l.link_state = 'confirmed'
     left join entities ent on ent.id = l.entity_id and ent.visibility = 'public'
     where e.publication_state = 'published'
     order by
       case
         when e.issue_date >= '2024-01-01' then 0
         when e.source_url ~ '/(2024|2025|2026)(/|$)' then 0
         else 1
       end,
       coalesce(e.issue_date, '0001-01-01') desc,
       e.updated_at desc
     limit 8`,
  );
  return { updated, evidence };
}

export async function createSubmission(
  db: Sql,
  input: {
    type: string;
    companyText?: string | null;
    url?: string | null;
    message?: string | null;
    disputedField?: string | null;
    submitterName?: string | null;
    submitterEmail?: string | null;
    ipHash?: string | null;
  },
) {
  const hour = await db.query<{ n: number }>(
    `select count(*)::int as n from submissions where ip_hash = $1 and created_at >= now() - interval '1 hour'`,
    [input.ipHash],
  );
  if (input.ipHash && (hour[0]?.n ?? 0) >= 8) {
    return { ok: false as const, error: "Too many submissions from this network. Try again later." };
  }
  const id = (await import("./ids.ts")).newId("sub");
  await db.query(
    `insert into submissions
      (id, type, company_text, url, message, disputed_field, submitter_name, submitter_email, ip_hash)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      input.type,
      input.companyText?.trim() || null,
      input.url?.trim() || null,
      input.message?.trim() || null,
      input.disputedField?.trim() || null,
      input.submitterName?.trim() || null,
      input.submitterEmail?.trim() || null,
      input.ipHash ?? null,
    ],
  );
  const { ensureReviewItem } = await import("./review.server.ts");
  await ensureReviewItem(db, {
    type: input.type === "correction" ? "community_submission" : "community_submission",
    reason: input.type === "correction" ? "Public correction or dispute submitted." : "Public source tip submitted.",
    payload: { submissionId: id },
    severity: "normal",
  });
  return { ok: true as const, id };
}

export { jsonParse, workingValue };
