const PREFIXES = {
  entity: "ent",
  alias: "als",
  rel: "rel",
  class: "cls",
  agency: "agy",
  agencyAlias: "aga",
  accreditation: "acr",
  signatory: "sig",
  evidence: "evd",
  asset: "ast",
  location: "loc",
  link: "lnk",
  extract: "xrn",
  claim: "clm",
  published: "pcl",
  lock: "lck",
  source: "src",
  check: "chk",
  job: "job",
  event: "evt",
  review: "rvw",
  submission: "sub",
  rule: "rul",
  merge: "mrg",
  audit: "aud",
  xref: "xrf",
  pub: "pub",
  note: "nte",
  admin: "adm",
  session: "ses",
  attempt: "att",
  enrichment: "enr",
} as const;

export type IdPrefix = (typeof PREFIXES)[keyof typeof PREFIXES];

export function newId(prefix: IdPrefix): string {
  const raw = crypto.randomUUID().replace(/-/g, "");
  return `${prefix}_${raw}`;
}

export function newIds() {
  return PREFIXES;
}
