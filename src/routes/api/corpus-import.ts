import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  authorizeCorpusImport,
  importCorpusBatch,
  retryUnpublished,
  type CorpusItem,
} from "@/lib/bee/corpus-import.server";
import { runDueSources, runSourceCheck } from "@/lib/bee/crawler.server";
import {
  repairCorpusStats,
  repairEvidenceBatch,
  repairLifecycleBatch,
} from "@/lib/bee/repair.server";
import { sql } from "@/lib/bee/sql.server";

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

const itemSchema = z.object({
  canonicalName: z.string().min(2),
  legalName: z.string().optional(),
  tradingName: z.string().optional(),
  registrationNumber: z.string().optional(),
  website: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  sectorIds: z.array(z.string()).optional(),
  jseListed: z.boolean().optional(),
  parentName: z.string().optional(),
  entityType: z.string().optional(),
  evidence: z.array(evidenceSchema).optional(),
  sources: z.array(sourceSchema).optional(),
  publishIfSafe: z.boolean().optional(),
});

const bodySchema = z.object({
  action: z.enum(["import", "crawl", "stats", "retry", "repair"]).optional(),
  items: z.array(itemSchema).min(1).max(3).optional(),
  crawlLimit: z.number().int().min(1).max(8).optional(),
  retryLimit: z.number().int().min(1).max(12).optional(),
  repairLimit: z.number().int().min(1).max(12).optional(),
  phase: z.enum(["extract", "lifecycle"]).optional(),
  afterId: z.string().nullable().optional(),
  sourceId: z.string().optional(),
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
        if (action === "repair") {
          const phase = parsed.data.phase ?? "extract";
          if (phase === "lifecycle") {
            const out = await repairLifecycleBatch(db, {
              limit: Math.min(40, (parsed.data.repairLimit ?? 8) * 5),
              afterId: parsed.data.afterId ?? null,
            });
            return Response.json({ ...(await stats(db)), phase, ...out });
          }
          const out = await repairEvidenceBatch(db, parsed.data.repairLimit ?? 6);
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
              error: r.error,
            })),
          });
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
