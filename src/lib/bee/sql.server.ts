import { dbSource, getPglite, getSql, type Sql } from "../db.ts";
export type { Sql };
export { jsonParse, jsonText, uniqueSlug } from "./db-types.ts";

function serializeCell(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Uint8Array) return value;
  return value;
}

function serializeRows(rows: unknown[]): unknown[] {
  return rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return row;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      out[key] = serializeCell(value);
    }
    return out;
  });
}

function wrapRun(run: (text: string, params: unknown[]) => Promise<unknown[]>): Sql {
  const sql = (async <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]> => {
    let text = strings[0] ?? "";
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1] ?? ""}`;
    return serializeRows(await run(text, values)) as T[];
  }) as unknown as Sql;
  sql.query = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    serializeRows(await run(text, params)) as T[];
  return sql;
}

export async function withTransaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  if (dbSource === "pglite") {
    const pg = await getPglite();
    return pg.transaction(async (tx) => {
      const sql = wrapRun(async (text, params) => {
        const res = await tx.query(text, params);
        return res.rows as unknown[];
      });
      return fn(sql);
    });
  }

  const { Pool, types } = await import("pg");
  types.setTypeParser(20, Number);
  types.setTypeParser(1082, (v: string) => v);
  types.setTypeParser(1186, (v: string) => v);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured.");
  const g = globalThis as typeof globalThis & { __beeNeonTxPool__?: InstanceType<typeof Pool> };
  g.__beeNeonTxPool__ ??= new Pool({ connectionString: url });
  const client = await g.__beeNeonTxPool__.connect();
  try {
    await client.query("begin");
    const sql = wrapRun(async (text, params) => {
      const res = await client.query(text, params);
      return res.rows as unknown[];
    });
    const result = await fn(sql);
    await client.query("commit");
    return result;
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function sql(): Promise<Sql> {
  const inner = await getSql();
  return wrapRun((text, params) => inner.query(text, params));
}
