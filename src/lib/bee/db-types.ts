export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonRow = { [key: string]: JsonValue };

export type Sql = {
  <T = JsonRow>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]>;
  query<T = JsonRow>(text: string, params?: unknown[]): Promise<T[]>;
};

export function jsonText(value: unknown): string {
  return JSON.stringify(value);
}

export function jsonParse<T>(value: unknown, fallback: T): T {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value as T;
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function uniqueSlug(
  db: Sql,
  table: "entities" | "verification_agencies",
  base: string,
): Promise<string> {
  let slug = base;
  let i = 2;
  for (;;) {
    const rows =
      table === "entities"
        ? await db.query<{ id: string }>("select id from entities where slug = $1 limit 1", [slug])
        : await db.query<{ id: string }>("select id from verification_agencies where slug = $1 limit 1", [slug]);
    if (!rows.length) return slug;
    slug = `${base}-${i}`;
    i += 1;
  }
}
