# Production deployment — The BEE Record

This checkout is a TanStack Start app. The **working production target** is
**Vercel + Neon Postgres**. That matches the Nitro `vercel` preset, the `pg`
driver, and `migrations/0002_schema.sql` (Postgres: `timestamptz`, `bytea`,
`ilike`, `interval`).

Do **not** apply this schema to Cloudflare D1 unchanged. D1 is SQLite. A
Workers/D1/R2 port is a framework change, not a config flip.

There is no default admin password. The first operator is created at
`/admin/bootstrap`. Admin password hashes are scrypt and are never committed.

---

## 1. Clean checkout

```bash
git clone https://github.com/a12987654321huytre-netizen/the-bee-record.git
cd the-bee-record
npm ci
```

Do not create a `.env` file in git. Set secrets in the host.

Required for a working backend:

| Name | Required | Where | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | **yes** | server | Neon (or any Postgres) connection string |
| `CRON_SECRET` | recommended | server | Bearer token for `POST /api/cron` |
| `XAI_API_KEY` | optional | server | Enables `grok-4.5` extraction; deterministic parser still works without it |
| `VITE_AUTH_ENABLED` | keep `false` | build | Public visitors have no end-user accounts. Admin auth is custom, not Better Auth. |

Never put secrets in `VITE_*` variables. Never commit Cloudflare tokens, Neon
URLs, xAI keys, or admin passwords.

---

## 2. Apply production migrations (Postgres / Neon)

Schema source: [`migrations/0002_schema.sql`](migrations/0002_schema.sql)

The migrator is [`scripts/migrate.mjs`](scripts/migrate.mjs). It records applied
files in `_migrations` and is safe to re-run.

**Exact production command:**

```bash
DATABASE_URL="$DATABASE_URL" npm run db:migrate
```

`npm run build` already runs `npm run db:migrate` after the Vite/Nitro build, so
a Vercel deploy applies pending files automatically when `DATABASE_URL` is set.

If `DATABASE_URL` is unset, migrate exits 0 (local PGLite applies the same files
at startup).

`migrations/auth/0001_auth.sql` is **not** applied (Better Auth is off). Do not
copy it into `migrations/` unless you turn public accounts on.

---

## 3. Deploy on Vercel from GitHub (supported path)

1. Import **this** repository in Vercel (Framework: Other / Vite; Output: Nitro
   Vercel preset from `npm run build`).
2. Set project environment variables: `DATABASE_URL`, `CRON_SECRET`, optional
   `XAI_API_KEY`. Mark them server-only.
3. Build command: `npm run build`
4. Install command: `npm ci`
5. Provision Neon. Attach the pooled connection string as `DATABASE_URL`.
6. Deploy. Confirm migrate logs: `[migrate] applied 0002_schema.sql` on first
   publish, `[migrate] up to date` afterwards.
7. Open `https://<project>.vercel.app/admin/bootstrap` once. Create the first
   administrator (password ≥ 12 characters).
8. Schedule cron: `POST https://<project>.vercel.app/api/cron` every 6 hours
   with header `Authorization: Bearer $CRON_SECRET`.

Rollback: redeploy a previous deployment. Do not drop evidence tables. Schema
is additive (`if not exists`).

### Post-deploy checks (backend, not just HTML)

- `GET /` — live counts, not placeholders
- `GET /companies` — directory (empty until something is published)
- `GET /search?q=` — search
- `GET /methodology` — public
- `GET /admin` → redirect to bootstrap or login
- Bootstrap → login → create a company → ingest evidence → review → publish
- `POST /api/cron` with bearer token returns `{ ok: true, expiry, jobs }`
- Uploaded documents persist (Postgres `bytea` via `evidence_assets`)

If the homepage loads but `/admin` or migrate failed, the deploy is **not**
complete.

---

## 4. Cloudflare (from GitHub) — resource map, not a drop-in

The product spec listed Cloudflare. This codebase is **not** a Workers/D1 app
today. Binding this repo to Cloudflare Pages/Workers without a port will boot a
frontend (or fail Nitro) while **D1 reads/writes, R2, Queues, and Cron will not
work**.

| Spec resource | This checkout | Cloudflare equivalent if you later port |
| --- | --- | --- |
| App | TanStack Start + Nitro **`vercel`** preset | Workers or Pages + Workers, Nitro `cloudflare-module` (framework change) |
| Database | Neon Postgres via `DATABASE_URL` | **D1** — needs a SQLite dialect rewrite of `migrations/0002_schema.sql` (`bytea`→`BLOB`, `timestamptz`→`text`, `ilike`→`LIKE`, `interval`→integer days, drop `::int`) |
| Document archive | `evidence_assets.content bytea`, `storage_backend='db'` | **R2** bucket; set `storage_backend='r2'` and `storage_key`; do not mutate archived bytes |
| Scheduled jobs | `POST /api/cron` + `CRON_SECRET` | **Cron Triggers** hitting the same route, or a Worker scheduled handler calling `processExpiries` + `runDueSources` |
| Background crawl | In-request `runSourceCheck` (idempotent) | **Queues** / **Workflows** for crawl → fetch → extract |
| AI | `XAI_API_KEY` (xAI `grok-4.5`) | Same secret in Worker secrets; or Workers AI behind the existing extractor abstraction |
| Admin auth | scrypt hashes + HttpOnly cookie `bee_admin` | Same application auth. **No** default password. Store hashes only. |
| Secrets | Vercel/Neon env | Use D1 binding + `wrangler secret put XAI_API_KEY` + `wrangler secret put CRON_SECRET` |

### If you still attach Cloudflare to this GitHub repo

Do not point Pages at this build and call it done. Required before a Cloudflare
production cutover:

1. Change the Nitro preset (framework change — not done here).
2. Rewrite SQL for D1; keep a separate migrations tree. **Never** run
   `migrations/0002_schema.sql` against D1.
3. Create: Worker/Pages project, D1 database, R2 bucket, Queue, Cron Trigger.
4. Bind them in Wrangler. Put `XAI_API_KEY` and `CRON_SECRET` in Worker secrets.
5. Apply the D1 dialect migrations with Wrangler, e.g.
   `npx wrangler d1 migrations apply bee-record --remote` **after** those
   files exist. They do not exist in this checkout on purpose.
6. Re-run the backend checklist above against the Cloudflare URL, including D1
   writes and R2 document fetch.

Until that port exists, production is Vercel + Neon from this repository.

---

## 5. Admin after first deploy

1. `/admin/bootstrap` — only while `admin_users` is empty.
2. `/admin/login`
3. Settings → Account — change password (revokes other sessions).
4. Companies → Evidence → Review → publish.
5. Sources → add URL → Crawl now. Cron picks up due sources.

---

## 6. What is never in git

- `.env*` files
- Neon / Cloudflare / xAI tokens
- Admin passwords or password hashes
- Local PGLite data
- `node_modules/`, `.vercel/`, sandbox screenshots
