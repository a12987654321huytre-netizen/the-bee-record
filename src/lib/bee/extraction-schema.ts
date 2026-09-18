import { z } from "zod";
import { BEE_FIELDS } from "./constants.ts";
import type { ExtractionResult } from "./types.ts";

export const extractionClaimSchema = z.object({
  field: z.enum(BEE_FIELDS),
  raw_value: z.string(),
  normalized_value: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  page: z.number().int().nullable(),
  locator: z.string().nullable(),
  warning: z.string().nullable(),
});

export const extractionResultSchema = z.object({
  claims: z.array(extractionClaimSchema),
  warnings: z.array(z.string()),
  ambiguity: z.array(z.string()),
});

export function parseExtractionJson(input: unknown): { ok: true; data: ExtractionResult } | { ok: false; error: string } {
  const result = extractionResultSchema.safeParse(input);
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((i) => i.message).join("; ") };
  }
  return { ok: true, data: result.data };
}

export function parseExtractionText(text: string): { ok: true; data: ExtractionResult } | { ok: false; error: string } {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1]!.trim() : trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, error: "Model output was not valid JSON." };
  }
  return parseExtractionJson(parsed);
}
