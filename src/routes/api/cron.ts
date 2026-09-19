import { createFileRoute } from "@tanstack/react-router";
import { getCookie } from "@tanstack/react-start/server";
import { SESSION_COOKIE } from "@/lib/bee/constants";
import { runDueSources } from "@/lib/bee/crawler.server";
import { processExpiries } from "@/lib/bee/expiry.server";
import { continueQueuedEnrichment } from "@/lib/bee/enrichment-run.server";
import { ensureEvidenceDatesRepaired } from "@/lib/bee/evidence-date.server";
import { sql } from "@/lib/bee/sql.server";

export const Route = createFileRoute("/api/cron")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.CRON_SECRET?.trim();
        const header = request.headers.get("authorization");
        const cookie = getCookie(SESSION_COOKIE);
        const authorized = secret ? header === `Bearer ${secret}` : Boolean(cookie);
        if (!authorized) {
          return new Response("Unauthorized", { status: 401 });
        }
        const db = await sql();
        await ensureEvidenceDatesRepaired(db);
        const expiry = await processExpiries(db);
        const jobs = await runDueSources(db, 8);
        const enrichment = await continueQueuedEnrichment(db);
        return Response.json({ ok: true, expiry, jobs, enrichment });
      },
    },
  },
});
