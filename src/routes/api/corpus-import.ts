import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  authorizeCorpusImport,
  importCorpusBatch,
  retryUnpublished,
  type CorpusItem,
} from "@/lib/bee/corpus-import.server";
import { auditPublicRecency, republishLegitimateHiddenEntities, unpublishStaleProcurementEntities } from "@/lib/bee/recency.server";
import { runDueSources, runSourceCheck } from "@/lib/bee/crawler.server";
import {
  repairCorpusStats,
  repairEvidenceBatch,
  repairLifecycleBatch,
  resetEqualDateRepairRuns,
  resetRepairRuns,
  cleanupGarbageAgencies,
  sanitizeEvidenceBatch,
  ensureUnknownValidityConstraint,
} from "@/lib/bee/repair.server";
import {
  applyIdentityBatch,
  applySectorsBatch,
  auditEnrichment,
  closeStalePublishedReviews,
  closeSucceededExtractionReviews,
  closeSuppressedClaimReviews,
  closeRepairKeptConflicts,
  copyRegistrationFromCertificateClaims,
  clearVerifierCopiedRegistrations,
  ensureCompanyWebsiteSources,
  ensureExtraSectors,
  listPriorityQueue,
  mergeNormalizedDuplicates,
  rejectJunkReviews,
} from "@/lib/bee/enrichment.server";
import { sql } from "@/lib/bee/sql.server";
import {
  auditProcurementEvidenceDates,
  repairProcurementEvidenceDates,
} from "@/lib/bee/evidence-date.server";

const evidenceSchema = z.object({
  url: z.string().url(),
  evidenceType: z.string().optional(),
  title: z.string().optional(),
});

const sourceSchema = z.object({
  url: z.string().url(),
  sourceType: z.string().optional(),
  frequency: z.enum(["daily", "weekly", "monthly", "manual"]).optional(),
});

const procurementSchema = z.object({
  sourceUrl: z.string().url(),
  governmentInstitution: z.string().min(2),
  tenderNumber: z.string().optional(),
  tenderDescription: z.string().optional(),
  awardDate: z.string().optional(),
  beeLevel: z.string().optional(),
  enterpriseClass: z.string().optional(),
  contractPeriod: z.string().optional(),
  contractAmount: z.string().optional(),
  sourceTitle: z.string().optional(),
  outcome: z.enum(["awarded", "responded", "unsuccessful", "bidder_register"]).optional(),
});

const itemSchema = z.object({
  canonicalName: z.string().min(2),
  legalName: z.string().optional(),
  tradingName: z.string().optional(),
  registrationNumber: z.string().optional(),
  replaceRegistrationIf: z.string().optional(),
  website: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  sectorIds: z.array(z.string()).optional(),
  jseListed: z.boolean().optional(),
  parentName: z.string().optional(),
  entityType: z.string().optional(),
  evidence: z.array(evidenceSchema).optional(),
  sources: z.array(sourceSchema).optional(),
  procurement: z.array(procurementSchema).max(8).optional(),
  publishIfSafe: z.boolean().optional(),
});

const bodySchema = z.object({
  action: z.enum(["import", "crawl", "stats", "retry", "repair", "recency", "enrich"]).optional(),
  items: z.array(itemSchema).min(1).max(25).optional(),
  crawlLimit: z.number().int().min(1).max(8).optional(),
  retryLimit: z.number().int().min(1).max(12).optional(),
  repairLimit: z.number().int().min(1).max(12).optional(),
  phase: z
    .enum([
      "extract",
      "lifecycle",
      "reset",
      "cleanup",
      "sanitize",
      "schema",
      "audit",
      "unpublish",
      "close-stale-reviews",
      "close-extraction",
      "close-suppressed",
      "close-repair-conflicts",
      "copy-regs",
      "clear-agency-regs",
      "merge-dupes",
      "identity",
      "sectors",
      "ensure-sectors",
      "queue",
      "reject-junk",
      "monitors",
      "dates",
      "republish",
    ])
    .optional(),
  afterId: z.string().nullable().optional(),
  sourceId: z.string().optional(),
  dryRun: z.boolean().optional(),
  recencyLimit: z.number().int().min(1).max(1500).optional(),
  enrichLimit: z.number().int().min(1).max(200).optional(),
  queue: z.string().optional(),
});

async function stats(db: Awaited<ReturnType<typeof sql>>) {
  const counts = await repairCorpusStats(db);
  return { ok: true, counts };
}

export const Route = createFileRoute("/api/corpus-import")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCorpusImport(request.headers.get("authorization"))) {
          return new Response("Unauthorized", { status: 401 });
        }
        let json: unknown;
        try {
          json = JSON.parse(await request.text());
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
        }
        const parsed = bodySchema.safeParse(json);
        if (!parsed.success) {
          return Response.json({ ok: false, error: parsed.error.message }, { status: 400 });
        }
        const db = await sql();
        const action = parsed.data.action ?? "import";
        if (action === "stats") {
          return Response.json(await stats(db));
        }
        if (action === "enrich") {
          const phase = parsed.data.phase ?? "audit";
          const limit = parsed.data.enrichLimit;
          const dryRun = parsed.data.dryRun ?? false;
          try {
            if (phase === "close-stale-reviews") {
              const out = await closeStalePublishedReviews(db, { limit, dryRun });
              return Response.json({ ...(await stats(db)), phase, ...out });
            }
            if (phase === "close-extraction") {
              const out = await closeSucceededExtractionReviews(db, { limit, dryRun });
              return Response.json({ ...(await stats(db)), phase, ...out });
            }
            if (phase === "close-suppressed") {
              const out = await closeSuppressedClaimReviews(db, { limit, dryRun });
              return Response.json({ ...(await stats(db)), phase, ...out });
            }
            if (phase === "close-repair-conflicts") {
              const out = await closeRepairKeptConflicts(db, { limit, dryRun });
              return Response.json({ ...(await stats(db)), phase, ...out });
            }
            if (phase === "reject-junk") {
              const out = await rejectJunkReviews(db, { limit, dryRun });
              return Response.json({ ...(await stats(db)), phase, ...out });
            }
            if (phase === "copy-regs") {
              const out = await copyRegistrationFromCertificateClaims(db, { limit, dryRun });
              return Response.json({ ...(await stats(db)), phase, ...out });
            }
            if (phase === "clear-agency-regs") {
              const out = await clearVerifierCopiedRegistrations(db, { dryRun });
              return Response.json({ ...(await stats(db)), phase, ...out });
            }
            if (phase === "merge-dupes") {
              const out = await mergeNormalizedDuplicates(db, { limit, dryRun });
              return Response.json({ ...(await stats(db)), phase, ...out });
            }
            if (phase === "ensure-sectors") {
              const out = await ensureExtraSectors(db);
              return Response.json({ ...(await stats(db)), phase, ...out });
            }
            if (phase === "identity") {
              if (!parsed.data.items?.length) {
                return Response.json({ ok: false, error: "items required for identity." }, { status: 400 });
              }
              const out = await applyIdentityBatch(db, parsed.data.items);
              return Response.json({ ...(await stats(db)), phase, ...out });
            }
            if (phase === "sectors") {
              if (!parsed.data.items?.length) {
                return Response.json({ ok: false, error: "items required for sectors." }, { status: 400 });
              }
              const out = await applySectorsBatch(
                db,
                parsed.data.items.map((it) => ({
                  canonicalName: it.canonicalName,
                  sectorIds: it.sectorIds ?? [],
                })),
              );
              return Response.json({ ...(await stats(db)), phase, ...out });
            }
            if (phase === "monitors") {
              const out = await ensureCompanyWebsiteSources(db, { limit, dryRun });
              return Response.json({ ...(await stats(db)), phase, ...out });
            }
            if (phase === "queue") {
              const out = await listPriorityQueue(db, parsed.data.queue ?? "certificate_enrichment", limit ?? 40);
              return Response.json({ ok: true, phase, ...out });
            }
            if (phase === "dates") {
              const out = parsed.data.dryRun
                ? await auditProcurementEvidenceDates(db)
                : await repairProcurementEvidenceDates(db);
              return Response.json({ ...(await stats(db)), phase, ...out });
            }
            return Response.json(await auditEnrichment(db));
          } catch (err) {
            const e = err as { message?: string; code?: string; detail?: string };
            return Response.json(
              {
                ok: false,
                error: e?.message ?? String(err),
                code: e?.code ?? null,
                detail: e?.detail ?? null,
                phase,
              },
              { status: 500 },
            );
          }
        }
        if (action === "recency") {
          const phase = parsed.data.phase ?? "audit";
          if (phase === "unpublish") {
            const out = await unpublishStaleProcurementEntities(db, {
              limit: parsed.data.recencyLimit,
              dryRun: parsed.data.dryRun,
            });
            return Response.json({ ...(await stats(db)), phase, ...out });
          }
          if (phase === "republish") {
            const out = await republishLegitimateHiddenEntities(db, {
              dryRun: parsed.data.dryRun,
              limit: parsed.data.recencyLimit,
            });
            return Response.json({ ...(await stats(db)), phase, ...out });
          }
          const out = await auditPublicRecency(db);
          return Response.json({
            ...(await stats(db)),
            phase: "audit",
            stale: out.unpublishPre2024 + out.unpublishUnknown,
            ...out,
          });
        }
        if (action === "repair") {
          const phase = parsed.data.phase ?? "extract";
          try {
          if (phase === "schema") {
            const out = await ensureUnknownValidityConstraint(db);
            return Response.json({ ...(await stats(db)), phase, ...out });
          }
          if (phase === "reset") {
            const out = await resetRepairRuns(db);
            return Response.json({ ...(await stats(db)), phase, ...out });
          }
          if (phase === "cleanup") {
            const garbageAgencies = await cleanupGarbageAgencies(db);
            const equalDates = await resetEqualDateRepairRuns(db);
            return Response.json({
              ...(await stats(db)),
              phase,
              garbageAgencies,
              equalDateEvidence: equalDates.evidence,
              equalDateRuns: equalDates.runs,
            });
          }
          if (phase === "lifecycle") {
            const out = await repairLifecycleBatch(db, {
              limit: Math.min(40, (parsed.data.repairLimit ?? 8) * 5),
              afterId: parsed.data.afterId ?? null,
            });
            return Response.json({ ...(await stats(db)), phase, ...out });
          }
          if (phase === "sanitize") {
            const out = await sanitizeEvidenceBatch(db, parsed.data.repairLimit ?? 6);
            return Response.json({
              ...(await stats(db)),
              phase,
              processed: out.processed,
              skipped: out.skipped,
              suppressed: out.suppressed,
              remaining: out.remaining,
              remainingSanitize: out.remaining,
              entityIds: out.entityIds,
              results: out.results.map((r) => ({
                evidenceId: r.evidenceId,
                skipped: r.skipped,
                parsed: r.parsed,
                suppressed: r.filled,
                fetchFallback: r.fetchFallback,
                error: r.error,
              })),
            });
          }
          const out = await repairEvidenceBatch(db, parsed.data.repairLimit ?? 3);
          return Response.json({
            ...(await stats(db)),
            phase,
            processed: out.processed,
            skipped: out.skipped,
            filled: out.filled,
            agenciesLinked: out.agenciesLinked,
            reviews: out.reviews,
            remaining: out.remaining,
            remainingExtract: out.remaining,
            entityIds: out.entityIds,
            results: out.results.map((r) => ({
              evidenceId: r.evidenceId,
              skipped: r.skipped,
              parsed: r.parsed,
              filled: r.filled,
              agencyId: r.agencyId,
              conflicts: r.conflicts,
              textLength: r.textLength,
              fetchFallback: r.fetchFallback,
              error: r.error,
            })),
          });
          } catch (err) {
            const e = err as { message?: string; code?: string; detail?: string; constraint?: string };
            return Response.json(
              {
                ok: false,
                error: e?.message ?? String(err),
                code: e?.code ?? null,
                detail: e?.detail ?? null,
                constraint: e?.constraint ?? null,
                phase,
              },
              { status: 500 },
            );
          }
        }
        if (action === "retry") {
          const out = await retryUnpublished(db, parsed.data.retryLimit ?? 6);
          return Response.json({ ...(await stats(db)), ...out });
        }
        if (action === "crawl") {
          if (parsed.data.sourceId) {
            const one = await runSourceCheck(db, parsed.data.sourceId, {
              type: "import",
              id: "import:corpus-2026",
            });
            return Response.json({ ok: true, jobs: [one.jobId], crawled: 1, okJob: one.ok });
          }
          const jobs = await runDueSources(db, parsed.data.crawlLimit ?? 3);
          return Response.json({ ok: true, jobs, crawled: jobs.length });
        }
        if (!parsed.data.items?.length) {
          return Response.json({ ok: false, error: "items required for import." }, { status: 400 });
        }
        const out = await importCorpusBatch(db, parsed.data.items as CorpusItem[]);
        return Response.json({ ok: true, ...out });
      },
      GET: async ({ request }) => {
        if (!authorizeCorpusImport(request.headers.get("authorization"))) {
          return new Response("Unauthorized", { status: 401 });
        }
        const db = await sql();
        return Response.json(await stats(db));
      },
    },
  },
});
