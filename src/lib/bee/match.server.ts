import { normalizeName, normalizeRegistration } from "./normalize.ts";
import type { Sql } from "./db-types.ts";

export type EntityMatch = {
  entityId: string | null;
  method: string | null;
  confidence: number;
  uncertain: boolean;
  extractedName: string | null;
  reason: string;
  conflict?: string;
};

export async function matchEntity(
  db: Sql,
  input: {
    extractedName?: string | null;
    extractedReg?: string | null;
    suggestedEntityId?: string | null;
  },
): Promise<EntityMatch> {
  const extractedName = input.extractedName?.trim() || null;
  const extractedReg = input.extractedReg ? normalizeRegistration(input.extractedReg) : null;

  if (input.suggestedEntityId) {
    const rows = await db.query<{
      id: string;
      merged_into_id: string | null;
      registration_number_normalized: string | null;
      canonical_name: string;
    }>("select id, merged_into_id, registration_number_normalized, canonical_name from entities where id = $1", [
      input.suggestedEntityId,
    ]);
    const row = rows[0];
    if (row) {
      const entityId = row.merged_into_id ?? row.id;
      if (extractedReg && row.registration_number_normalized && extractedReg !== row.registration_number_normalized) {
        return {
          entityId,
          method: "admin",
          confidence: 0.4,
          uncertain: true,
          extractedName,
          reason: "Linked entity registration number differs from the extracted registration number. The canonical identifier was not overwritten.",
          conflict: "registration_number_conflict",
        };
      }
      return {
        entityId,
        method: "admin",
        confidence: 1,
        uncertain: false,
        extractedName,
        reason: "Linked by an administrator.",
      };
    }
  }

  if (extractedReg) {
    const byReg = await db.query<{ id: string; canonical_name: string; merged_into_id: string | null }>(
      `select id, canonical_name, merged_into_id from entities
       where registration_number_normalized = $1 and merged_into_id is null
       limit 2`,
      [extractedReg],
    );
    if (byReg.length === 1) {
      const nameNorm = extractedName ? normalizeName(extractedName) : null;
      const entityNorm = normalizeName(byReg[0]!.canonical_name);
      if (nameNorm && nameNorm !== entityNorm) {
        const alias = await db.query<{ id: string }>(
          "select id from entity_aliases where entity_id = $1 and normalized_alias = $2 limit 1",
          [byReg[0]!.id, nameNorm],
        );
        if (!alias.length) {
          return {
            entityId: byReg[0]!.id,
            method: "registration_number",
            confidence: 0.7,
            uncertain: true,
            extractedName,
            reason: "Registration number matches, but the extracted name differs.",
            conflict: "name_differs",
          };
        }
      }
      return {
        entityId: byReg[0]!.id,
        method: "registration_number",
        confidence: 0.99,
        uncertain: false,
        extractedName,
        reason: "Exact registration-number match.",
      };
    }
  }

  if (extractedName) {
    const nameNorm = normalizeName(extractedName);
    if (nameNorm) {
      const byName = await db.query<{ id: string }>(
        `select id from entities
         where normalized_name = $1 and merged_into_id is null
         limit 2`,
        [nameNorm],
      );
      const byAlias = await db.query<{ entity_id: string }>(
        `select a.entity_id from entity_aliases a
         join entities e on e.id = a.entity_id
         where a.normalized_alias = $1 and e.merged_into_id is null
         limit 2`,
        [nameNorm],
      );
      const ids = [...new Set([...byName.map((r) => r.id), ...byAlias.map((r) => r.entity_id)])];
      if (ids.length === 1) {
        if (extractedReg) {
          const ent = await db.query<{ registration_number_normalized: string | null }>(
            "select registration_number_normalized from entities where id = $1",
            [ids[0]],
          );
          const existing = ent[0]?.registration_number_normalized;
          if (existing && existing !== extractedReg) {
            return {
              entityId: ids[0]!,
              method: "name",
              confidence: 0.4,
              uncertain: true,
              extractedName,
              reason: "Name matches but registration numbers conflict.",
              conflict: "registration_number_conflict",
            };
          }
        }
        return {
          entityId: ids[0]!,
          method: byName.length ? "canonical_name" : "alias",
          confidence: 0.92,
          uncertain: false,
          extractedName,
          reason: byName.length ? "Exact canonical-name match." : "Exact alias match.",
        };
      }
      if (ids.length > 1) {
        let conflict: string | undefined = "ambiguous_name";
        if (extractedReg) {
          const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
          const ents = await db.query<{ id: string; registration_number_normalized: string | null }>(
            `select id, registration_number_normalized from entities where id in (${placeholders})`,
            ids,
          );
          if (ents.some((e) => e.registration_number_normalized && e.registration_number_normalized !== extractedReg)) {
            conflict = "registration_number_conflict";
          }
        }
        return {
          entityId: null,
          method: "ambiguous_name",
          confidence: 0.3,
          uncertain: true,
          extractedName,
          reason:
            conflict === "registration_number_conflict"
              ? "Name resembles more than one entity and registration numbers conflict."
              : "Multiple entities share this name or alias.",
          conflict,
        };
      }
    }
  }

  return {
    entityId: null,
    method: null,
    confidence: 0,
    uncertain: Boolean(extractedName || extractedReg),
    extractedName,
    reason: extractedName || extractedReg ? "No confident entity match." : "No entity identifiers extracted.",
  };
}
