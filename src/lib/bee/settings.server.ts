import type { AutomationRuleConfig } from "./types.ts";
import { jsonParse, type Sql } from "./db-types.ts";

const DEFAULT_RULE: AutomationRuleConfig = {
  officialCompanyDomain: true,
  recognizedDocumentType: true,
  minimumConfidence: 0.98,
  exactEntityMatch: true,
  validDates: true,
  noConflictingCurrentEvidence: true,
  knownVerifier: false,
  registrationNumberConsistency: true,
  manualLockConflictMustBeFalse: true,
};

async function dbOrDefault(db?: Sql): Promise<Sql> {
  if (db) return db;
  const { sql } = await import("./sql.server.ts");
  return sql();
}

export async function getSetting<T>(key: string, fallback: T, db?: Sql): Promise<T> {
  const client = await dbOrDefault(db);
  const rows = await client.query<{ value: string }>("select value from app_settings where key = $1", [key]);
  if (!rows[0]) return fallback;
  return jsonParse<T>(rows[0].value, fallback);
}

export async function setSetting(key: string, value: unknown, actorId: string | null, db?: Sql) {
  const client = await dbOrDefault(db);
  await client.query(
    `insert into app_settings (key, value, updated_by, updated_at) values ($1,$2,$3,now())
     on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
    [key, JSON.stringify(value), actorId],
  );
}

export async function getExpiringSoonDays(db?: Sql): Promise<number> {
  const n = await getSetting<number>("expiring_soon_days", 90, db);
  return Number.isFinite(Number(n)) ? Number(n) : 90;
}

export async function getAutoPublishEnabled(db?: Sql): Promise<boolean> {
  return (await getSetting<boolean>("auto_publish_enabled", false, db)) === true;
}

export async function getConfidenceThreshold(db?: Sql): Promise<number> {
  const n = await getSetting<number>("confidence_threshold", 0.98, db);
  return Number(n);
}

export async function getActiveRule(db?: Sql): Promise<{
  id: string;
  version: number;
  enabled: boolean;
  config: AutomationRuleConfig;
}> {
  const client = await dbOrDefault(db);
  const rows = await client.query<{ id: string; version: number; enabled: number; config: string }>(
    "select id, version, enabled, config from automation_rules order by version desc limit 1",
  );
  const row = rows[0];
  if (!row) {
    return { id: "rule_v1", version: 1, enabled: false, config: DEFAULT_RULE };
  }
  return {
    id: row.id,
    version: row.version,
    enabled: Number(row.enabled) === 1,
    config: { ...DEFAULT_RULE, ...jsonParse<Partial<AutomationRuleConfig>>(row.config, {}) },
  };
}

export { DEFAULT_RULE };
