/** Pure enrichment helpers — scoring, registration checks, sector catalogue, admin queues. */

import { normalizeRegistration } from "./normalize.ts";

export const ZA_ENTITY_TYPES = new Set([
  "06",
  "07",
  "08",
  "09",
  "10",
  "21",
  "22",
  "23",
  "24",
  "25",
  "26",
  "30",
]);

/** SANAS verification-agency company numbers — never copy onto measured entities. */
export const VERIFIER_REGISTRATIONS = new Set([
  "199500052307", // EmpowerLogic (Pty) Ltd
  "200200136407", // AQRate (Pty) Ltd
  "200101796307", // Empowerdex (Pty) Ltd (certificate footer)
  "200102796307", // Empowerdex (Pty) Ltd (SANAS)
]);

export function isVerifierRegistration(value: string | null | undefined): boolean {
  if (!value) return false;
  return VERIFIER_REGISTRATIONS.has(normalizeRegistration(value));
}

export function isZaCompanyRegistration(value: string | null | undefined): boolean {
  if (!value) return false;
  const n = normalizeRegistration(value);
  if (!/^\d{12}$/.test(n)) return false;
  const year = Number(n.slice(0, 4));
  if (year < 1900 || year > 2030) return false;
  return ZA_ENTITY_TYPES.has(n.slice(10, 12));
}

export function formatZaRegistration(value: string | null | undefined): string | null {
  if (!value || !isZaCompanyRegistration(value)) return null;
  const n = normalizeRegistration(value);
  return `${n.slice(0, 4)}/${n.slice(4, 10)}/${n.slice(10, 12)}`;
}

export type PriorityInputs = {
  evidenceCount: number;
  procurementCount: number;
  institutionCount: number;
  latestProcurementYear: number | null;
  hasWebsite: boolean;
  hasRegistration: boolean;
  hasCertificate: boolean;
  hasCurrentCertificate: boolean;
  jseListed: boolean;
  isGroup: boolean;
  hasParent: boolean;
};

/**
 * Internal research-priority score. Not shown publicly.
 * Higher = research a current certificate / identity first.
 */
export function enrichmentPriorityScore(p: PriorityInputs): number {
  let score = 0;
  if (p.jseListed) score += 40;
  if (p.isGroup) score += 18;
  if (p.hasWebsite) score += 15;
  if (p.hasRegistration) score += 8;
  if (p.latestProcurementYear === 2026) score += 18;
  else if (p.latestProcurementYear === 2025) score += 12;
  else if (p.latestProcurementYear === 2024) score += 6;
  score += Math.min(25, p.procurementCount * 3);
  score += Math.min(16, Math.max(0, p.institutionCount - 1) * 4);
  score += Math.min(10, p.evidenceCount);
  if (!p.hasCertificate) score += 20;
  else if (!p.hasCurrentCertificate) score += 12;
  if (p.hasParent) score += 4;
  return score;
}

export const EXTRA_SECTORS: Array<{ id: string; slug: string; name: string }> = [
  { id: "sec_financial", slug: "financial-services", name: "Financial services" },
  { id: "sec_engineering", slug: "engineering", name: "Engineering" },
  { id: "sec_ict", slug: "ict", name: "ICT" },
  { id: "sec_legal", slug: "legal", name: "Legal" },
  { id: "sec_accounting", slug: "accounting", name: "Accounting / audit" },
  { id: "sec_recruitment", slug: "recruitment", name: "Recruitment" },
  { id: "sec_marketing", slug: "marketing", name: "Marketing / communications" },
  { id: "sec_transport", slug: "transport", name: "Transport" },
  { id: "sec_automotive", slug: "automotive", name: "Automotive" },
  { id: "sec_manufacturing", slug: "manufacturing", name: "Manufacturing" },
  { id: "sec_industrial", slug: "industrial", name: "Industrial" },
  { id: "sec_healthcare", slug: "healthcare", name: "Healthcare" },
  { id: "sec_pharma", slug: "pharmaceuticals", name: "Pharmaceuticals" },
  { id: "sec_food", slug: "food-beverage", name: "Food & beverage" },
  { id: "sec_agriculture", slug: "agriculture", name: "Agriculture" },
  { id: "sec_hospitality", slug: "hospitality", name: "Hospitality" },
  { id: "sec_tourism", slug: "tourism", name: "Tourism" },
  { id: "sec_property", slug: "property", name: "Property" },
  { id: "sec_energy", slug: "energy", name: "Energy" },
  { id: "sec_security", slug: "security", name: "Security" },
  { id: "sec_facilities", slug: "facilities", name: "Cleaning / facilities" },
  { id: "sec_printing", slug: "printing", name: "Printing" },
  { id: "sec_education", slug: "education", name: "Education / training" },
  { id: "sec_media", slug: "media", name: "Media / communications" },
];

/** Not industries. Stored as classification attributes, never as public sectors. */
export const NON_INDUSTRY_SECTOR_IDS = {
  jse: "sec_jse",
  governmentSuppliers: "sec_government_suppliers",
} as const;

const INDUSTRY_RULES: Array<{ re: RegExp; id: string }> = [
  { re: /\bpharma(?:cy|ceutical|ceuticals|care)?s?\b/i, id: "sec_pharma" },
  { re: /\b(?:medical aid|medical scheme)\b/i, id: "sec_insurance" },
  { re: /\b(?:healthcare|hospital|hospitals|clinic|clinics|health)\b/i, id: "sec_healthcare" },
  { re: /\bmedical\b/i, id: "sec_healthcare" },
  { re: /\bbanks?\b|\bbanking\b/i, id: "sec_banking" },
  { re: /\b(?:insurance|insurers?|underwriters?)\b/i, id: "sec_insurance" },
  { re: /\bassurance\b/i, id: "sec_insurance" },
  { re: /\b(?:mining|miner|miners|colliery|gold mine)\b/i, id: "sec_mining" },
  { re: /\b(?:construction|kontraksie|konstruksie|civils?|builders?|building)\b/i, id: "sec_construction" },
  { re: /\b(?:engineer(?:s|ing)?|ingenieurs(?:wese)?)\b/i, id: "sec_engineering" },
  { re: /\belectrical\b/i, id: "sec_engineering" },
  { re: /\b(?:attorney|attorneys|advocates)\b/i, id: "sec_legal" },
  { re: /\b(?:accountant|accountants|auditors?)\b/i, id: "sec_accounting" },
  { re: /\b(?:recruitment|staffing)\b/i, id: "sec_recruitment" },
  { re: /\b(?:logistic(?:s)?|freight|courier)\b/i, id: "sec_logistics" },
  { re: /\b(?:transport|trucking|haulage|vervoer|trucks?|buses?)\b/i, id: "sec_transport" },
  { re: /\b(?:security|guarding|sekuriteit)\b/i, id: "sec_security" },
  { re: /\b(?:cleaning|cleaners?|hygiene|sanitary|facilities)\b/i, id: "sec_facilities" },
  { re: /\b(?:hotel|hotels|hospitality|lodge|guesthouse|guest house)\b/i, id: "sec_hospitality" },
  { re: /\b(?:training|academy|college|university|education|skool)\b/i, id: "sec_education" },
  { re: /\b(?:agricultur\w*|farming|farms?|boerdery|\bagri\b)\b/i, id: "sec_agriculture" },
  { re: /\b(?:propert(?:y|ies)|eiendom(?:me)?|\breit\b)\b/i, id: "sec_property" },
  { re: /\b(?:energy|energies|solar|petroleum|renewable)\b/i, id: "sec_energy" },
  { re: /\b(?:software|\bict\b|cyber|electronics)\b/i, id: "sec_ict" },
  { re: /\b(?:telecom(?:munication)?s?|cellular)\b/i, id: "sec_telecoms" },
  { re: /\b(?:retail(?:er)?s?|supermarket|wholesalers?)\b/i, id: "sec_retail" },
  { re: /\b(?:foods?|catering|beverage|beverages|bakery)\b/i, id: "sec_food" },
  { re: /\b(?:print(?:ing|ers)?)\b/i, id: "sec_printing" },
  { re: /\b(?:automotive|motors?|vehicles?|tyres?|tires?|auto)\b/i, id: "sec_automotive" },
  { re: /\bmanufactur/i, id: "sec_manufacturing" },
  { re: /\b(?:steel|welding|fabrication|pipes|fittings|cables)\b/i, id: "sec_industrial" },
  { re: /\b(?:media|broadcast(?:ing)?|publishing)\b/i, id: "sec_media" },
  { re: /\bconsult(?:ing|ancy|ants?)?\b|\bforensic\b/i, id: "sec_professional" },
];

/**
 * Industry sectors implied by the company's own name.
 * Generic words (trading, projects, holdings, solutions) are not industries.
 * Returns at most two sectors. Does not use tender text.
 */
export function inferIndustrySectors(name: string): string[] {
  if (/\b(?:medical aid|medical scheme)\b/i.test(name)) return ["sec_insurance"];
  const text = name.replace(/\bquality assurance\b/gi, " ").replace(/\bcapacity building\b/gi, " ");
  const hits: string[] = [];
  for (const rule of INDUSTRY_RULES) {
    if (!rule.re.test(text)) continue;
    if (!hits.includes(rule.id)) hits.push(rule.id);
  }
  const specific = hits.filter((id) => id !== "sec_professional");
  const chosen = (specific.length ? specific : hits).slice(0, 2);
  if (chosen.includes("sec_engineering")) {
    return chosen.filter((id) => id !== "sec_professional").slice(0, 2);
  }
  if (chosen.includes("sec_construction") && chosen.includes("sec_engineering")) {
    return ["sec_engineering", "sec_construction"];
  }
  return chosen;
}

export const ADMIN_QUEUES = [
  "procurement_only",
  "no_registration",
  "no_sector",
  "no_website",
  "no_current_certificate",
  "expired_certificate_only",
  "validity_unconfirmed",
  "review_required",
  "no_monitored_source",
  "multiple_evidence",
  "current_certificate",
  "expiring_soon",
  "certificate_enrichment",
  "identity_enrichment",
  "monitoring_setup",
  "expiry_replacement",
] as const;

export type AdminQueue = (typeof ADMIN_QUEUES)[number];

export const ADMIN_QUEUE_LABELS: Record<AdminQueue, string> = {
  procurement_only: "Procurement only",
  no_registration: "No registration number",
  no_sector: "No sector",
  no_website: "No official website",
  no_current_certificate: "No current certificate",
  expired_certificate_only: "Expired certificate only",
  validity_unconfirmed: "Validity unconfirmed",
  review_required: "Review required",
  no_monitored_source: "No monitored source",
  multiple_evidence: "Multiple evidence records",
  current_certificate: "Current certificate",
  expiring_soon: "Expiring soon",
  certificate_enrichment: "Certificate enrichment",
  identity_enrichment: "Identity enrichment",
  monitoring_setup: "Monitoring setup",
  expiry_replacement: "Expiry replacement",
};

/** SQL predicate against entities aliased as `e`. */
export function queuePredicate(queue: string): string | null {
  switch (queue) {
    case "procurement_only":
      return `exists (
          select 1 from evidence_entity_links l
          join evidence ev on ev.id = l.evidence_id
          where l.entity_id = e.id and ev.publication_state = 'published'
            and ev.evidence_type = 'government_procurement_disclosure'
        ) and not exists (
          select 1 from evidence_entity_links l
          join evidence ev on ev.id = l.evidence_id
          where l.entity_id = e.id and ev.publication_state = 'published'
            and ev.evidence_type in ('bee_certificate','sworn_affidavit')
        )`;
    case "no_registration":
      return `(e.registration_number is null or btrim(e.registration_number) = '')`;
    case "no_sector":
      return `not exists (
        select 1 from entity_classifications c
        where c.entity_id = e.id and c.is_public = 1 and c.classification_type = 'sector'
          and c.sector_id not in ('sec_jse', 'sec_government_suppliers')
      )`;
    case "no_website":
      return `(e.website is null or btrim(e.website) = '')`;
    case "no_current_certificate":
      return `not exists (
          select 1 from entity_current_state cs
          where cs.entity_id = e.id and cs.lifecycle_state in ('current','expiring_soon')
        )`;
    case "expired_certificate_only":
      return `exists (
          select 1 from evidence_entity_links l
          join evidence ev on ev.id = l.evidence_id
          where l.entity_id = e.id and ev.publication_state = 'published'
            and ev.evidence_type in ('bee_certificate','sworn_affidavit')
            and ev.lifecycle_state = 'expired'
        ) and not exists (
          select 1 from evidence_entity_links l
          join evidence ev on ev.id = l.evidence_id
          where l.entity_id = e.id and ev.publication_state = 'published'
            and ev.evidence_type in ('bee_certificate','sworn_affidavit')
            and ev.lifecycle_state in ('current','expiring_soon')
        )`;
    case "validity_unconfirmed":
      return `exists (
          select 1 from evidence_entity_links l
          join evidence ev on ev.id = l.evidence_id
          where l.entity_id = e.id and ev.lifecycle_state = 'unknown_validity'
        ) or exists (
          select 1 from entity_current_state cs
          where cs.entity_id = e.id and cs.lifecycle_state = 'unknown_validity'
        )`;
    case "review_required":
      return `exists (
          select 1 from review_items r
          where r.entity_id = e.id and r.status = 'pending'
        )`;
    case "no_monitored_source":
      return `not exists (select 1 from monitored_sources s where s.entity_id = e.id)`;
    case "multiple_evidence":
      return `(
          select count(*) from evidence_entity_links l
          join evidence ev on ev.id = l.evidence_id
          where l.entity_id = e.id and ev.publication_state = 'published'
        ) >= 2`;
    case "current_certificate":
      return `exists (
          select 1 from entity_current_state cs
          where cs.entity_id = e.id and cs.lifecycle_state in ('current','expiring_soon')
        )`;
    case "expiring_soon":
      return `exists (
          select 1 from entity_current_state cs
          where cs.entity_id = e.id and cs.lifecycle_state = 'expiring_soon'
        )`;
    case "certificate_enrichment":
      return `e.visibility = 'public'
        and e.website is not null and btrim(e.website) <> ''
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
        )`;
    case "identity_enrichment":
      return `e.visibility = 'public'
        and (e.registration_number is null or btrim(e.registration_number) = '')
        and exists (
          select 1 from evidence_entity_links l
          join evidence ev on ev.id = l.evidence_id
          where l.entity_id = e.id and ev.publication_state = 'published'
            and ev.evidence_type = 'government_procurement_disclosure'
        )`;
    case "monitoring_setup":
      return `e.visibility = 'public'
        and e.website is not null and btrim(e.website) <> ''
        and not exists (
          select 1 from monitored_sources s
          where s.entity_id = e.id
            and s.domain = regexp_replace(lower(split_part(regexp_replace(e.website, '^https?://', ''), '/', 1)), '^www\\.', '')
        )`;
    case "expiry_replacement":
      return `e.visibility = 'public' and exists (
          select 1 from evidence_entity_links l
          join evidence ev on ev.id = l.evidence_id
          where l.entity_id = e.id and ev.publication_state = 'published'
            and ev.evidence_type in ('bee_certificate','sworn_affidavit')
            and (
              ev.lifecycle_state = 'expired'
              or (ev.lifecycle_state = 'expiring_soon' and ev.expiry_date is not null and ev.expiry_date <= current_date + 60)
            )
        )`;
    default:
      return null;
  }
}
