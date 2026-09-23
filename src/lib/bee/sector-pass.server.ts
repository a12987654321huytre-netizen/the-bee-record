import { inferIndustrySectors, NON_INDUSTRY_SECTOR_IDS } from "./enrichment.ts";
import { ensureExtraSectors } from "./enrichment.server.ts";
import { newId } from "./ids.ts";
import { normalizeName } from "./normalize.ts";
import type { Sql } from "./db-types.ts";

const KNOWN_INDUSTRY: Array<[string, string[]]> = [
  ["Shoprite", ["sec_retail"]],
  ["Shoprite Holdings", ["sec_retail"]],
  ["Shoprite Checkers", ["sec_retail"]],
  ["Checkers", ["sec_retail"]],
  ["Pick n Pay", ["sec_retail"]],
  ["Pick n Pay Stores", ["sec_retail"]],
  ["Woolworths", ["sec_retail"]],
  ["Woolworths Holdings", ["sec_retail"]],
  ["The Foschini Group", ["sec_retail"]],
  ["Foschini", ["sec_retail"]],
  ["Mr Price", ["sec_retail"]],
  ["Mr Price Group", ["sec_retail"]],
  ["Pepkor", ["sec_retail"]],
  ["Pepkor Holdings", ["sec_retail"]],
  ["Truworths", ["sec_retail"]],
  ["Truworths International", ["sec_retail"]],
  ["Clicks", ["sec_retail"]],
  ["Clicks Group", ["sec_retail"]],
  ["Dis-Chem", ["sec_retail", "sec_pharma"]],
  ["Dis-Chem Pharmacies", ["sec_retail", "sec_pharma"]],
  ["Massmart", ["sec_retail"]],
  ["The SPAR Group", ["sec_retail"]],
  ["SPAR Group", ["sec_retail"]],
  ["Cashbuild", ["sec_retail"]],
  ["Italtile", ["sec_retail"]],
  ["Takealot", ["sec_retail"]],
  ["Vodacom", ["sec_telecoms"]],
  ["Vodacom Group", ["sec_telecoms"]],
  ["MTN", ["sec_telecoms"]],
  ["MTN Group", ["sec_telecoms"]],
  ["MTN South Africa", ["sec_telecoms"]],
  ["Telkom", ["sec_telecoms"]],
  ["Telkom SA", ["sec_telecoms"]],
  ["Telkom SA SOC", ["sec_telecoms"]],
  ["Cell C", ["sec_telecoms"]],
  ["FirstRand", ["sec_banking"]],
  ["FirstRand Bank", ["sec_banking"]],
  ["Standard Bank", ["sec_banking"]],
  ["Standard Bank Group", ["sec_banking"]],
  ["Standard Bank of South Africa", ["sec_banking"]],
  ["The Standard Bank of South Africa", ["sec_banking"]],
  ["Absa", ["sec_banking"]],
  ["Absa Group", ["sec_banking"]],
  ["Absa Bank", ["sec_banking"]],
  ["Nedbank", ["sec_banking"]],
  ["Nedbank Group", ["sec_banking"]],
  ["Capitec", ["sec_banking"]],
  ["Capitec Bank", ["sec_banking"]],
  ["Capitec Bank Holdings", ["sec_banking"]],
  ["Investec", ["sec_banking", "sec_financial"]],
  ["Investec Bank", ["sec_banking"]],
  ["African Bank", ["sec_banking"]],
  ["African Bank Limited", ["sec_banking"]],
  ["Discovery", ["sec_insurance", "sec_financial"]],
  ["Discovery Limited", ["sec_insurance", "sec_financial"]],
  ["Discovery Health", ["sec_healthcare", "sec_insurance"]],
  ["Sanlam", ["sec_insurance"]],
  ["Sanlam Limited", ["sec_insurance"]],
  ["Old Mutual", ["sec_insurance"]],
  ["Old Mutual Limited", ["sec_insurance"]],
  ["Momentum Metropolitan", ["sec_insurance"]],
  ["Momentum Group", ["sec_insurance"]],
  ["Santam", ["sec_insurance"]],
  ["OUTsurance", ["sec_insurance"]],
  ["OUTsurance Holdings", ["sec_insurance"]],
  ["Hollard", ["sec_insurance"]],
  ["The Hollard Insurance Company", ["sec_insurance"]],
  ["Liberty", ["sec_insurance"]],
  ["Liberty Group", ["sec_insurance"]],
  ["Clientele", ["sec_insurance"]],
  ["Alexander Forbes", ["sec_financial"]],
  ["Alexander Forbes Group Holdings", ["sec_financial"]],
  ["Coronation Fund Managers", ["sec_financial"]],
  ["Ninety One", ["sec_financial"]],
  ["PSG Konsult", ["sec_financial"]],
  ["Naspers", ["sec_media"]],
  ["Naspers Limited", ["sec_media"]],
  ["Prosus", ["sec_media"]],
  ["MultiChoice", ["sec_media"]],
  ["MultiChoice Group", ["sec_media"]],
  ["Media24", ["sec_media"]],
  ["eMedia Holdings", ["sec_media"]],
  ["Caxton", ["sec_media"]],
  ["Caxton and CTP Publishers and Printers", ["sec_media", "sec_printing"]],
  ["Sasol", ["sec_energy"]],
  ["Sasol Limited", ["sec_energy"]],
  ["Eskom", ["sec_energy"]],
  ["Eskom Holdings", ["sec_energy"]],
  ["Eskom Holdings SOC", ["sec_energy"]],
  ["Engen", ["sec_energy"]],
  ["Engen Petroleum", ["sec_energy"]],
  ["Astron Energy", ["sec_energy"]],
  ["Anglo American", ["sec_mining"]],
  ["Anglo American Platinum", ["sec_mining"]],
  ["AngloGold Ashanti", ["sec_mining"]],
  ["Gold Fields", ["sec_mining"]],
  ["Harmony Gold", ["sec_mining"]],
  ["Harmony Gold Mining Company", ["sec_mining"]],
  ["Sibanye-Stillwater", ["sec_mining"]],
  ["Sibanye Stillwater", ["sec_mining"]],
  ["Impala Platinum", ["sec_mining"]],
  ["Impala Platinum Holdings", ["sec_mining"]],
  ["Exxaro", ["sec_mining", "sec_energy"]],
  ["Exxaro Resources", ["sec_mining", "sec_energy"]],
  ["Kumba Iron Ore", ["sec_mining"]],
  ["Thungela", ["sec_mining"]],
  ["Thungela Resources", ["sec_mining"]],
  ["African Rainbow Minerals", ["sec_mining"]],
  ["Northam Platinum", ["sec_mining"]],
  ["DRDGOLD", ["sec_mining"]],
  ["Pan African Resources", ["sec_mining"]],
  ["South32", ["sec_mining"]],
  ["Glencore", ["sec_mining"]],
  ["Bidvest", ["sec_industrial"]],
  ["Bidvest Group", ["sec_industrial"]],
  ["The Bidvest Group", ["sec_industrial"]],
  ["Bid Corporation", ["sec_food"]],
  ["Bidcorp", ["sec_food"]],
  ["Tiger Brands", ["sec_food"]],
  ["AVI Limited", ["sec_food"]],
  ["RCL Foods", ["sec_food"]],
  ["Astral Foods", ["sec_food", "sec_agriculture"]],
  ["Oceana Group", ["sec_food"]],
  ["Famous Brands", ["sec_food", "sec_hospitality"]],
  ["Spur Corporation", ["sec_hospitality"]],
  ["Aspen Pharmacare", ["sec_pharma"]],
  ["Aspen Pharmacare Holdings", ["sec_pharma"]],
  ["Adcock Ingram", ["sec_pharma", "sec_healthcare"]],
  ["Adcock Ingram Holdings", ["sec_pharma", "sec_healthcare"]],
  ["Cipla Medpro", ["sec_pharma"]],
  ["Netcare", ["sec_healthcare"]],
  ["Netcare Hospitals", ["sec_healthcare"]],
  ["Life Healthcare", ["sec_healthcare"]],
  ["Life Healthcare Group", ["sec_healthcare"]],
  ["Mediclinic", ["sec_healthcare"]],
  ["Mediclinic International", ["sec_healthcare"]],
  ["AfroCentric", ["sec_healthcare"]],
  ["Growthpoint Properties", ["sec_property"]],
  ["Growthpoint", ["sec_property"]],
  ["Redefine Properties", ["sec_property"]],
  ["Hyprop Investments", ["sec_property"]],
  ["Resilient REIT", ["sec_property"]],
  ["Vukile Property Fund", ["sec_property"]],
  ["Fortress REIT", ["sec_property"]],
  ["NEPI Rockcastle", ["sec_property"]],
  ["Attacq", ["sec_property"]],
  ["Equites Property Fund", ["sec_property"]],
  ["WBHO", ["sec_construction"]],
  ["Wilson Bayly Holmes-Ovcon", ["sec_construction"]],
  ["Raubex", ["sec_construction"]],
  ["Raubex Group", ["sec_construction"]],
  ["Aveng", ["sec_construction"]],
  ["Murray & Roberts", ["sec_construction"]],
  ["Murray and Roberts", ["sec_construction"]],
  ["Stefanutti Stocks", ["sec_construction"]],
  ["Concor", ["sec_construction"]],
  ["Basil Read", ["sec_construction"]],
  ["Motus", ["sec_automotive"]],
  ["Motus Holdings", ["sec_automotive"]],
  ["Super Group", ["sec_logistics"]],
  ["Barloworld", ["sec_industrial"]],
  ["Grindrod", ["sec_logistics"]],
  ["Grindrod Limited", ["sec_logistics"]],
  ["Transnet", ["sec_logistics", "sec_transport"]],
  ["Transnet SOC", ["sec_logistics", "sec_transport"]],
  ["Airports Company South Africa", ["sec_transport"]],
  ["South African Airways", ["sec_transport"]],
  ["Sanral", ["sec_transport"]],
  ["South African National Roads Agency", ["sec_transport"]],
  ["Zutari", ["sec_engineering"]],
  ["Aurecon", ["sec_engineering"]],
  ["SMEC South Africa", ["sec_engineering"]],
  ["Gijima", ["sec_ict"]],
  ["Gijima Holdings", ["sec_ict"]],
  ["Altron", ["sec_ict"]],
  ["Allied Electronics Corporation", ["sec_ict"]],
  ["Datatec", ["sec_ict"]],
  ["EOH", ["sec_ict"]],
  ["EOH Holdings", ["sec_ict"]],
  ["Reunert", ["sec_ict"]],
  ["Business Connexion", ["sec_ict"]],
  ["Dimension Data", ["sec_ict"]],
  ["Mustek", ["sec_ict"]],
  ["Adapt IT", ["sec_ict"]],
  ["Bytes Technology Group", ["sec_ict"]],
  ["Naspers", ["sec_media"]],
  ["Mondi", ["sec_manufacturing"]],
  ["Mondi Limited", ["sec_manufacturing"]],
  ["Sappi", ["sec_manufacturing"]],
  ["Sappi Limited", ["sec_manufacturing"]],
  ["Mpact", ["sec_manufacturing"]],
  ["Nampak", ["sec_manufacturing"]],
  ["ArcelorMittal South Africa", ["sec_manufacturing"]],
  ["Hulamin", ["sec_manufacturing"]],
  ["AECI", ["sec_industrial"]],
  ["African Oxygen", ["sec_industrial"]],
  ["Afrox", ["sec_industrial"]],
  ["Toyota South Africa", ["sec_automotive"]],
  ["Toyota South Africa Motors", ["sec_automotive"]],
  ["Volkswagen Group South Africa", ["sec_automotive"]],
  ["Volkswagen of South Africa", ["sec_automotive"]],
  ["BMW South Africa", ["sec_automotive"]],
  ["Mercedes-Benz South Africa", ["sec_automotive"]],
  ["Ford Motor Company of Southern Africa", ["sec_automotive"]],
  ["Isuzu Motors South Africa", ["sec_automotive"]],
  ["Coca-Cola Beverages South Africa", ["sec_food"]],
  ["South African Breweries", ["sec_food"]],
  ["Distell", ["sec_food"]],
  ["Heineken South Africa", ["sec_food"]],
  ["Unilever South Africa", ["sec_manufacturing"]],
  ["Nestle South Africa", ["sec_food"]],
  ["Nestlé South Africa", ["sec_food"]],
  ["British American Tobacco South Africa", ["sec_manufacturing"]],
  ["Sun International", ["sec_hospitality"]],
  ["Tsogo Sun", ["sec_hospitality"]],
  ["Southern Sun", ["sec_hospitality"]],
  ["City Lodge Hotels", ["sec_hospitality"]],
  ["City Lodge", ["sec_hospitality"]],
  ["Peermont", ["sec_hospitality"]],
  ["PepsiCo South Africa", ["sec_food"]],
  ["Pioneer Foods", ["sec_food"]],
  ["Clover", ["sec_food"]],
  ["Clover Industries", ["sec_food"]],
  ["Libstar", ["sec_food"]],
  ["Libstar Holdings", ["sec_food"]],
  ["Quantum Foods", ["sec_food", "sec_agriculture"]],
  ["KAP", ["sec_industrial"]],
  ["KAP Industrial", ["sec_industrial"]],
  ["Invicta", ["sec_industrial"]],
  ["Invicta Holdings", ["sec_industrial"]],
  ["Hudaco", ["sec_industrial"]],
  ["Hudaco Industries", ["sec_industrial"]],
  ["Barloworld Equipment", ["sec_industrial"]],
  ["Imperial", ["sec_logistics"]],
  ["Imperial Logistics", ["sec_logistics"]],
  ["DP World", ["sec_logistics"]],
  ["DHL Supply Chain", ["sec_logistics"]],
  ["Bidvest Bank", ["sec_banking"]],
  ["Sasfin", ["sec_banking"]],
  ["Sasfin Bank", ["sec_banking"]],
  ["TymeBank", ["sec_banking"]],
  ["Discovery Bank", ["sec_banking"]],
  ["OUTsurance", ["sec_insurance"]],
  ["Bryte Insurance", ["sec_insurance"]],
  ["Guardrisk", ["sec_insurance"]],
  ["Santam Limited", ["sec_insurance"]],
  ["Sanlam Life", ["sec_insurance"]],
  ["Old Mutual Life", ["sec_insurance"]],
  ["Momentum Metropolitan Holdings", ["sec_insurance"]],
  ["Vodacom South Africa", ["sec_telecoms"]],
  ["Rain", ["sec_telecoms"]],
  ["Liquid Intelligent Technologies", ["sec_telecoms", "sec_ict"]],
  ["Telkom SOC", ["sec_telecoms"]],
  ["SABC", ["sec_media"]],
  ["South African Broadcasting Corporation", ["sec_media"]],
  ["Primedia", ["sec_media"]],
  ["Kagiso Media", ["sec_media"]],
  ["eMedia", ["sec_media"]],
  ["Multichoice", ["sec_media"]],
  ["DStv Media Sales", ["sec_media"]],
  ["Naspers", ["sec_media"]],
  ["Prosus", ["sec_media"]],
  ["Curro", ["sec_education"]],
  ["Curro Holdings", ["sec_education"]],
  ["Advtech", ["sec_education"]],
  ["ADvTECH", ["sec_education"]],
  ["Stadio", ["sec_education"]],
  ["Netcare Limited", ["sec_healthcare"]],
  ["Life Healthcare Group Holdings", ["sec_healthcare"]],
  ["Mediclinic Southern Africa", ["sec_healthcare"]],
  ["Lenmed", ["sec_healthcare"]],
  ["Busamed", ["sec_healthcare"]],
  ["AfroCentric Investment Corporation", ["sec_healthcare"]],
  ["Dis-Chem", ["sec_retail", "sec_pharma"]],
  ["Clicks", ["sec_retail"]],
  ["Woolworths Holdings Limited", ["sec_retail"]],
  ["Pep", ["sec_retail"]],
  ["Pepkor", ["sec_retail"]],
  ["Ackermans", ["sec_retail"]],
  ["Mr Price Group Limited", ["sec_retail"]],
  ["TFG", ["sec_retail"]],
  ["The Foschini Group Limited", ["sec_retail"]],
  ["Truworths International Limited", ["sec_retail"]],
  ["Spar", ["sec_retail"]],
  ["The SPAR Group Limited", ["sec_retail"]],
  ["Massmart Holdings", ["sec_retail"]],
  ["Game Stores", ["sec_retail"]],
  ["Makro", ["sec_retail"]],
  ["Builders Warehouse", ["sec_retail"]],
  ["Cashbuild Limited", ["sec_retail"]],
  ["Italtile Limited", ["sec_retail"]],
  ["Lewis Group", ["sec_retail"]],
  ["Pepkor Holdings Limited", ["sec_retail"]],
  ["Shoprite Holdings Limited", ["sec_retail"]],
  ["Pick n Pay Holdings", ["sec_retail"]],
  ["Pick n Pay Retailers", ["sec_retail"]],
];

function knownIndustry(name: string): string[] | null {
  const key = normalizeName(name);
  for (const [label, sectors] of KNOWN_INDUSTRY) {
    if (normalizeName(label) === key) return sectors;
  }
  return null;
}

export function sectorsForCompanyName(name: string): string[] {
  return knownIndustry(name) ?? inferIndustrySectors(name);
}

const GENUINE = `c.is_public = 1 and c.classification_type = 'sector'
  and c.sector_id not in ('sec_jse', 'sec_government_suppliers')`;

async function sectorSnapshot(db: Sql) {
  const published = (
    await db.query<{ n: number }>(
      `select count(*)::int as n from entities e
       where e.visibility = 'public' and e.merged_into_id is null`,
    )
  )[0]?.n ?? 0;
  const withSector = (
    await db.query<{ n: number }>(
      `select count(*)::int as n from entities e
       where e.visibility = 'public' and e.merged_into_id is null
         and exists (
           select 1 from entity_classifications c
           where c.entity_id = e.id and ${GENUINE}
         )`,
    )
  )[0]?.n ?? 0;
  const distribution = await db.query<{ name: string; n: number }>(
    `select s.name, count(distinct e.id)::int as n
     from sectors s
     join entity_classifications c on c.sector_id = s.id and c.classification_type = 'sector' and c.is_public = 1
     join entities e on e.id = c.entity_id and e.visibility = 'public' and e.merged_into_id is null
     where s.id not in ('sec_jse', 'sec_government_suppliers')
     group by s.name
     order by n desc, s.name`,
  );
  return {
    published,
    withGenuineSector: withSector,
    missingSector: published - withSector,
    coveragePct: published ? Math.round((withSector / published) * 1000) / 10 : 0,
    distribution,
  };
}

async function countSectorTyped(db: Sql, sectorId: string): Promise<number> {
  const rows = await db.query<{ n: number }>(
    `select count(*)::int as n from entity_classifications
     where sector_id = $1 and classification_type = 'sector'`,
    [sectorId],
  );
  return rows[0]?.n ?? 0;
}

async function moveNonIndustryAttributes(db: Sql): Promise<{ jse: number; governmentSupplier: number }> {
  const moved = async (sectorId: string, nextType: string) => {
    const deleted = await db.query<{ id: string }>(
      `delete from entity_classifications c
       where c.sector_id = $1 and c.classification_type = 'sector'
         and exists (
           select 1 from entity_classifications x
           where x.entity_id = c.entity_id and x.sector_id = c.sector_id and x.classification_type = $2
         )
       returning c.id`,
      [sectorId, nextType],
    );
    const updated = await db.query<{ id: string }>(
      `update entity_classifications
       set classification_type = $2
       where sector_id = $1 and classification_type = 'sector'
       returning id`,
      [sectorId, nextType],
    );
    return deleted.length + updated.length;
  };
  return {
    jse: await moved(NON_INDUSTRY_SECTOR_IDS.jse, "listing"),
    governmentSupplier: await moved(NON_INDUSTRY_SECTOR_IDS.governmentSuppliers, "attribute"),
  };
}

export async function runSectorClassificationPass(
  db: Sql,
  input: { limit?: number; dryRun?: boolean; afterName?: string } = {},
): Promise<{
  attributesStoredAsSectors: { jse: number; governmentSupplier: number };
  attributesMoved: { jse: number; governmentSupplier: number };
  scanned: number;
  proposed: number;
  classifiedCompanies: number;
  assignments: number;
  ambiguousInBatch: number;
  lastName: string | null;
  exhausted: boolean;
  remainingMissing: number;
  samples: Array<{ name: string; sectors: string[] }>;
  ambiguousSamples: string[];
  before: Awaited<ReturnType<typeof sectorSnapshot>>;
  after: Awaited<ReturnType<typeof sectorSnapshot>>;
}> {
  await ensureExtraSectors(db);
  const before = await sectorSnapshot(db);
  const attributesStoredAsSectors = {
    jse: await countSectorTyped(db, NON_INDUSTRY_SECTOR_IDS.jse),
    governmentSupplier: await countSectorTyped(db, NON_INDUSTRY_SECTOR_IDS.governmentSuppliers),
  };
  const attributesMoved = input.dryRun
    ? { jse: 0, governmentSupplier: 0 }
    : await moveNonIndustryAttributes(db);
  const limit = Math.min(1000, Math.max(1, input.limit ?? 800));
  const afterName = input.afterName ?? "";
  const rows = await db.query<{ id: string; canonical_name: string }>(
    `select e.id, e.canonical_name
     from entities e
     where e.visibility = 'public' and e.merged_into_id is null
       and not exists (
         select 1 from entity_classifications c
         where c.entity_id = e.id and ${GENUINE}
       )
       and ($2::text = '' or e.canonical_name > $2)
     order by e.canonical_name
     limit $1`,
    [limit, afterName],
  );
  const ids: string[] = [];
  const entityIds: string[] = [];
  const sectorIds: string[] = [];
  const samples: Array<{ name: string; sectors: string[] }> = [];
  const ambiguousSamples: string[] = [];
  let proposed = 0;
  let ambiguousInBatch = 0;
  const seen = new Set<string>();
  for (const row of rows) {
    const sectors = sectorsForCompanyName(row.canonical_name).filter(
      (id) => id !== "sec_jse" && id !== "sec_government_suppliers",
    );
    if (!sectors.length) {
      ambiguousInBatch += 1;
      if (ambiguousSamples.length < 20) ambiguousSamples.push(row.canonical_name);
      continue;
    }
    proposed += 1;
    if (samples.length < 25) samples.push({ name: row.canonical_name, sectors });
    for (const sectorId of sectors) {
      const key = `${row.id}:${sectorId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ids.push(newId("cls"));
      entityIds.push(row.id);
      sectorIds.push(sectorId);
    }
  }
  if (!input.dryRun && ids.length) {
    const chunk = 400;
    for (let i = 0; i < ids.length; i += chunk) {
      await db.query(
        `insert into entity_classifications (id, entity_id, sector_id, classification_type, is_public)
         select t.id, t.entity_id, t.sector_id, 'sector', 1
         from unnest($1::text[], $2::text[], $3::text[]) as t(id, entity_id, sector_id)
         on conflict (entity_id, sector_id, classification_type) do nothing`,
        [ids.slice(i, i + chunk), entityIds.slice(i, i + chunk), sectorIds.slice(i, i + chunk)],
      );
    }
  }
  const after = input.dryRun ? before : await sectorSnapshot(db);
  const lastName = rows.length ? rows[rows.length - 1]!.canonical_name : null;
  return {
    attributesStoredAsSectors,
    attributesMoved,
    scanned: rows.length,
    proposed,
    classifiedCompanies: input.dryRun ? 0 : proposed,
    assignments: input.dryRun ? 0 : ids.length,
    ambiguousInBatch,
    lastName,
    exhausted: rows.length < limit,
    remainingMissing: after.missingSector,
    samples,
    ambiguousSamples,
    before,
    after,
  };
}

export async function matchCompanyUniverse(db: Sql, names: string[]) {
  const raw = names.map((name) => name.trim()).filter((name) => name.length >= 2).slice(0, 500);
  const norms = raw.map((name) => normalizeName(name));
  const rows = await db.query<{
    raw: string;
    id: string | null;
    canonical_name: string | null;
    slug: string | null;
    visibility: string | null;
    via: string | null;
  }>(
    `with input as (
       select * from unnest($1::text[], $2::text[]) with ordinality as t(raw, norm, ord)
     ),
     name_hit as (
       select distinct on (i.ord) i.ord, i.raw, e.id, e.canonical_name, e.slug, e.visibility, 'name'::text as via
       from input i
       join entities e on e.merged_into_id is null and e.normalized_name = i.norm
       order by i.ord, (e.visibility = 'public') desc, e.canonical_name
     ),
     alias_hit as (
       select distinct on (i.ord) i.ord, i.raw, e.id, e.canonical_name, e.slug, e.visibility, 'alias'::text as via
       from input i
       join entity_aliases a on a.normalized_alias = i.norm
       join entities e on e.id = a.entity_id and e.merged_into_id is null
       order by i.ord, (e.visibility = 'public') desc, e.canonical_name
     )
     select i.raw,
            coalesce(n.id, a.id) as id,
            coalesce(n.canonical_name, a.canonical_name) as canonical_name,
            coalesce(n.slug, a.slug) as slug,
            coalesce(n.visibility, a.visibility) as visibility,
            coalesce(n.via, a.via) as via
     from input i
     left join name_hit n on n.ord = i.ord
     left join alias_hit a on a.ord = i.ord
     order by i.ord`,
    [raw, norms],
  );
  const present = rows.filter((row) => row.id && row.visibility === "public");
  const hidden = rows.filter((row) => row.id && row.visibility !== "public");
  const missing = rows.filter((row) => !row.id);
  return {
    checked: rows.length,
    present: present.length,
    hidden: hidden.length,
    missing: missing.length,
    missingNames: missing.map((row) => row.raw),
    matches: rows.map((row) => ({
      raw: row.raw,
      id: row.id,
      canonicalName: row.canonical_name,
      slug: row.slug,
      visibility: row.visibility,
      via: row.via,
    })),
  };
}
