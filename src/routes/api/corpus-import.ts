import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authorizeCorpusImport } from "@/lib/bee/corpus-import-auth";
import {
  importCorpusBatch,
  reprocessStoredUrls,
  retryUnpublished,
  type CorpusItem,
} from "@/lib/bee/corpus-import.server";
import { auditPublicRecency, hideNamedEntities, republishLegitimateHiddenEntities, unpublishStaleProcurementEntities } from "@/lib/bee/recency.server";
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
import { publicStats } from "@/lib/bee/queries.server";
import {
  auditProcurementEvidenceDates,
  repairProcurementEvidenceDates,
} from "@/lib/bee/evidence-date.server";
import { matchCompanyUniverse, runSectorClassificationPass } from "@/lib/bee/sector-pass.server";
