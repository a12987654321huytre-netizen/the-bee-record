import { KNOWN_AGENCIES, extractBva } from "./deterministic-extract.ts";
import { uniqueSlug, type Sql } from "./db-types.ts";
import { newId } from "./ids.ts";
import { normalizeName, slugify } from "./normalize.ts";

const REJECT_NAMES =
  /^(sanas|yes|no|n a|na|n\/a|date|level|bee|b bbee|verification agency|rating agency|broad based black economic|broad based black economic empowerment|name of technical signatory|technical signatory|measured entity|by management of measured entity and is an)$/;

export function canonicalAgencyName(raw: string): string | null {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (trimmed.length < 3 || trimmed.length > 120) return null;
  if (REJECT_NAMES.test(normalizeName(trimmed))) return null;
  if (/measured entity|technical signatory|management of|gazette|scorecard|procurement recognition/i.test(trimmed)) {
    return null;
  }
  for (const known of KNOWN_AGENCIES) {
    if (known.pattern.test(trimmed)) return known.name;
  }
  return trimmed;
}

async function addAliasIfNew(db: Sql, agencyId: string, alias: string) {
  const normalized = normalizeName(alias);
  if (!normalized) return;
  const existing = await db.query<{ id: string }>(
    "select id from agency_aliases where agency_id = $1 and normalized_alias = $2 limit 1",
    [agencyId, normalized],
  );
  if (existing[0]) return;
  await db.query("insert into agency_aliases (id, agency_id, alias, normalized_alias) values ($1,$2,$3,$4)", [
    newId("aga"),
    agencyId,
    alias.trim(),
    normalized,
  ]);
}

async function recordBva(db: Sql, agencyId: string, bva: string, evidenceId?: string | null) {
  const identifier = bva.toUpperCase().replace(/\s+/g, "");
  if (!/^BVA\d{2,4}$/.test(identifier)) return;
  const existing = await db.query<{ id: string }>(
    `select id from agency_accreditations
     where agency_id = $1 and accreditation_identifier = $2
     limit 1`,
    [agencyId, identifier],
  );
  if (existing[0]) return;
  await db.query(
    `insert into agency_accreditations
      (id, agency_id, accreditation_body, accreditation_identifier, status, evidence_id)
     values ($1,$2,'SANAS',$3,'Identifier stated on certificate',$4)`,
    [newId("acr"), agencyId, identifier, evidenceId ?? null],
  );
}

export async function findAgencyId(db: Sql, name: string): Promise<string | null> {
  const canonical = canonicalAgencyName(name) ?? name;
  const n = normalizeName(canonical);
  if (!n) return null;
  const rows = await db.query<{ id: string }>(
    `select id from verification_agencies where normalized_name = $1
     union
     select agency_id as id from agency_aliases where normalized_alias = $1
     limit 1`,
    [n],
  );
  if (rows[0]) return rows[0].id;
  const rawNorm = normalizeName(name);
  if (rawNorm && rawNorm !== n) {
    const alt = await db.query<{ id: string }>(
      `select id from verification_agencies where normalized_name = $1
       union
       select agency_id as id from agency_aliases where normalized_alias = $1
       limit 1`,
      [rawNorm],
    );
    if (alt[0]) return alt[0].id;
  }
  return null;
}

export async function ensureAgency(
  db: Sql,
  input: { name: string | null | undefined; bva?: string | null; evidenceId?: string | null; website?: string | null },
): Promise<string | null> {
  const raw = input.name?.trim();
  if (!raw) return null;
  const canonical = canonicalAgencyName(raw);
  if (!canonical) return null;

  let id = await findAgencyId(db, canonical);
  if (!id && canonical !== raw) id = await findAgencyId(db, raw);

  if (!id) {
    id = newId("agy");
    const slug = await uniqueSlug(db, "verification_agencies", slugify(canonical));
    await db.query(
      `insert into verification_agencies
        (id, name, normalized_name, slug, legal_name, website, visibility)
       values ($1,$2,$3,$4,$5,$6,'public')`,
      [id, canonical, normalizeName(canonical), slug, canonical, input.website?.trim() || null],
    );
  } else if (input.website?.trim()) {
    await db.query(
      "update verification_agencies set website = coalesce(website, $2), updated_at = now() where id = $1",
      [id, input.website.trim()],
    );
  }

  if (normalizeName(raw) !== normalizeName(canonical)) {
    await addAliasIfNew(db, id, raw);
  }

  const bva = input.bva?.trim() || extractBva(raw);
  if (bva) await recordBva(db, id, bva, input.evidenceId);
  return id;
}

export async function ensureSignatory(
  db: Sql,
  input: { name: string | null | undefined; agencyId?: string | null; title?: string | null },
): Promise<string | null> {
  const raw = input.name?.replace(/\s+/g, " ").trim();
  if (!raw || raw.length < 3 || raw.length > 80) return null;
  if (/^(signatory|technical|date|yes|no)$/i.test(raw)) return null;
  const n = normalizeName(raw);
  if (!n) return null;
  const existing = input.agencyId
    ? await db.query<{ id: string }>(
        "select id from signatories where normalized_name = $1 and agency_id = $2 limit 1",
        [n, input.agencyId],
      )
    : await db.query<{ id: string }>(
        "select id from signatories where normalized_name = $1 and agency_id is null limit 1",
        [n],
      );
  if (existing[0]) {
    if (input.title?.trim()) {
      await db.query("update signatories set role_title = coalesce(role_title, $2) where id = $1", [
        existing[0].id,
        input.title.trim(),
      ]);
    }
    return existing[0].id;
  }
  const id = newId("sig");
  await db.query(
    "insert into signatories (id, name, normalized_name, agency_id, role_title) values ($1,$2,$3,$4,$5)",
    [id, raw, n, input.agencyId ?? null, input.title?.trim() || null],
  );
  return id;
}
