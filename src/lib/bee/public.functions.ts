import { createServerFn } from "@tanstack/react-start";
import { notFound, redirect } from "@tanstack/react-router";
import { getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { EVIDENCE_TYPES } from "./constants.ts";
import { ipHash } from "./hash.ts";
import {
  createSubmission,
  getPublicAgency,
  getPublicEntity,
  getPublicEvidence,
  listExpiring,
  listPublicAgencies,
  listPublicCompanies,
  listSectors,
  listUpdates,
  publicStats,
  recentHome,
  searchAcross,
} from "./queries.server.ts";
import { sql } from "./sql.server.ts";
import { checkFetchUrl } from "./ssrf.ts";

function cachePublic() {
  setResponseHeader("cache-control", "public, max-age=30");
}

function clientIp(): string | null {
  const fwd = getRequestHeader("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() ?? null;
  return getRequestHeader("x-real-ip") ?? null;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "").trim();
}

export const getHomeData = createServerFn({ method: "GET" }).handler(async () => {
  cachePublic();
  const db = await sql();
  const [stats, sectors, recent] = await Promise.all([publicStats(db), listSectors(db), recentHome(db)]);
  const expiring = await listExpiring(db, "expiring");
  const expired = await listExpiring(db, "expired");
  return { stats, sectors, recent, expiring: expiring.slice(0, 6), expired: expired.slice(0, 6) };
});

export const searchPublic = createServerFn({ method: "GET" })
  .validator(z.object({ q: z.string().optional(), page: z.number().optional() }))
  .handler(async ({ data }) => {
    cachePublic();
    const db = await sql();
    const q = data.q?.trim() ?? "";
    if (!q) return { q, companies: [], agencies: [], directory: { items: [], total: 0, page: 1, pageSize: 25 } };
    const [across, directory] = await Promise.all([
      searchAcross(db, q),
      listPublicCompanies(db, { q, page: data.page ?? 1 }),
    ]);
    return { q, ...across, directory };
  });

export const getCompanyDirectory = createServerFn({ method: "GET" })
  .validator(
    z.object({
      q: z.string().optional(),
      level: z.string().optional(),
      sector: z.string().optional(),
      agency: z.string().optional(),
      lifecycle: z.string().optional(),
      page: z.coerce.number().optional(),
    }),
  )
  .handler(async ({ data }) => {
    cachePublic();
    const db = await sql();
    const [result, sectors, agencies] = await Promise.all([
      listPublicCompanies(db, data),
      listSectors(db),
      listPublicAgencies(db),
    ]);
    return { ...result, sectors, agencies };
  });

export const getCompanyPage = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string() }))
  .handler(async ({ data }) => {
    cachePublic();
    const db = await sql();
    const result = await getPublicEntity(db, data.slug);
    if (!result) throw notFound();
    if (!result.entity) {
      throw redirect({ to: "/companies/$slug", params: { slug: result.redirectTo ?? "" } });
    }
    return result;
  });

export const getEvidencePage = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    cachePublic();
    const db = await sql();
    const result = await getPublicEvidence(db, data.id);
    if (!result) throw notFound();
    return result;
  });

export const getVerifierDirectory = createServerFn({ method: "GET" })
  .validator(z.object({ q: z.string().optional() }))
  .handler(async ({ data }) => {
    cachePublic();
    const db = await sql();
    return { items: await listPublicAgencies(db, data.q) };
  });

export const getVerifierPage = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string() }))
  .handler(async ({ data }) => {
    cachePublic();
    const db = await sql();
    const result = await getPublicAgency(db, data.slug);
    if (!result) throw notFound();
    return result;
  });

export const getSectorPage = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string(), page: z.coerce.number().optional() }))
  .handler(async ({ data }) => {
    cachePublic();
    const db = await sql();
    const sectors = await listSectors(db);
    const sector = sectors.find((s) => s.slug === data.slug);
    if (!sector) throw notFound();
    const directory = await listPublicCompanies(db, { sector: data.slug, page: data.page ?? 1 });
    return { sector, directory };
  });

export const getUpdatesPage = createServerFn({ method: "GET" })
  .validator(z.object({ page: z.coerce.number().optional() }))
  .handler(async ({ data }) => {
    cachePublic();
    const db = await sql();
    return listUpdates(db, data.page ?? 1);
  });

export const getExpiringPage = createServerFn({ method: "GET" })
  .validator(z.object({ mode: z.enum(["expiring", "expired"]) }))
  .handler(async ({ data }) => {
    cachePublic();
    const db = await sql();
    return { mode: data.mode, items: await listExpiring(db, data.mode) };
  });

export const getSectorsNav = createServerFn({ method: "GET" }).handler(async () => {
  cachePublic();
  const db = await sql();
  return listSectors(db);
});

const submissionSchema = z.object({
  type: z.enum([
    "certificate_url",
    "annual_report",
    "disclosure",
    "correction",
    "missing_company",
    "newer_evidence",
    "verification",
    "other",
  ]),
  companyText: z.string().max(300).optional(),
  url: z.string().max(2000).optional(),
  message: z.string().max(4000).optional(),
  disputedField: z.string().max(80).optional(),
  submitterName: z.string().max(120).optional(),
  submitterEmail: z.string().max(200).optional(),
  evidenceId: z.string().optional(),
});

export const submitPublic = createServerFn({ method: "POST" })
  .validator(submissionSchema)
  .handler(async ({ data }) => {
    if (data.url) {
      const checked = checkFetchUrl(data.url);
      if (!checked.ok) return { ok: false as const, error: checked.reason };
    }
    if (!data.url && !data.message && !data.companyText) {
      return { ok: false as const, error: "Provide a company, URL, or explanation." };
    }
    const db = await sql();
    return createSubmission(db, {
      type: data.type,
      companyText: data.companyText ? stripTags(data.companyText) : null,
      url: data.url ?? null,
      message: data.message ? stripTags(data.message) : null,
      disputedField: data.disputedField ? stripTags(data.disputedField) : null,
      submitterName: data.submitterName ? stripTags(data.submitterName) : null,
      submitterEmail: data.submitterEmail ? stripTags(data.submitterEmail) : null,
      ipHash: ipHash(clientIp()),
    });
  });

export const evidenceTypeValues = EVIDENCE_TYPES;
