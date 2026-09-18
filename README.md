# The BEE Record

A searchable index of publicly disclosed South African B-BBEE information, backed by certificates, annual reports and company disclosures.

**Everything sourced. Everything checkable. Everything versioned.**

This is an evidence and provenance system, not a directory that overwrites a company’s “current level”. A newer certificate becomes the current interpretation; the older document stays.

The public site is read-only. Publication happens only through review or a recorded automation rule.

This is not an official government register.

## Architecture

The product model is:

`ENTITY → EVIDENCE → EXTRACTED CLAIMS → REVIEW → PUBLISHED INTERPRETATION → HISTORY`

| Layer | Implementation |
| --- | --- |
| App | TanStack Start (React + Vite) |
| Database | Postgres (Neon in production, embedded PGLite in preview) |
| Document archive | Database `bytea` (R2-compatible metadata: hash, key, backend) |
| AI extraction | xAI `grok-4.5` when `XAI_API_KEY` is present, plus a deterministic parser |
| Auth | Application admin sessions (HttpOnly cookie, scrypt hashes, CSRF, login rate limits) |
| Jobs | Admin-triggered source checks + `POST /api/cron` |

Cloudflare D1 / R2 / Queues / Cron are the long-term hosting shape described in the product spec. This deployment uses the platform’s Postgres + Vercel workers with the same relational schema, immutable evidence rows, and idempotent jobs so the data model does not have to be rewritten.

## Data-integrity rules (non-negotiable)

- Evidence rows are never overwritten. New bytes at an old URL create a new evidence record.
- Identical content hashes do not create a second evidence row.
- AI output is schema-validated and never writes published entity columns directly.
- Uncertain entity matches go to review. Search does not merge companies.
- Manual field locks block silent automation overwrites.
- Expired and superseded documents remain queryable.
- Homepage statistics are live queries. There is no seed of fictional companies.

## Local / preview setup

```bash
npm ci
npm run dev
npm test
npm run typecheck
npm run build
```

Preview uses an in-memory Postgres (PGLite). Data resets when the dev server restarts. Production uses Neon via `DATABASE_URL` (injected on deploy — do not write a `.env` file).

### First administrator

1. Open `/admin`. You are sent to `/admin/bootstrap` while the admin table is empty.
2. Create an administrator (password at least 12 characters). There is no default password.
3. Sign in at `/admin/login`. Sessions are server-side, HttpOnly, SameSite=Lax.

### First real record

1. **Companies** — create a legal entity. Visibility starts as `draft`.
2. **Evidence** — paste a public URL or the document text. The file is hashed and archived.
3. Extraction runs (deterministic always; AI when configured).
4. A **review** item is created unless conservative auto-publish rules all pass (they are off by default).
5. Approve: the public company page updates; previous evidence remains on the timeline.

## Bindings and environment

Never put secrets in client JavaScript. Never commit production secrets.

| Name | Where | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | server | Neon connection string on deploy |
| `XAI_API_KEY` | server | Optional. Enables structured AI extraction |
| `CRON_SECRET` | server | Bearer token for `POST /api/cron` |
| `SESSION_COOKIE` | code | `bee_admin` HttpOnly cookie |

See [DEPLOY.md](DEPLOY.md) for Vercel + Neon production steps and the Cloudflare resource map. Do not apply `migrations/0002_schema.sql` to D1; it is Postgres.

## Tests

```bash
npm test
```

## Production deployment

This stack deploys to **Vercel + Neon Postgres**. Full steps are in [DEPLOY.md](DEPLOY.md).

```bash
git clone https://github.com/a12987654321huytre-netizen/the-bee-record.git
cd the-bee-record
npm ci
DATABASE_URL="$DATABASE_URL" npm run db:migrate
```

1. Provision Postgres (Neon) and set `DATABASE_URL`.
2. Set `CRON_SECRET`. Optionally set `XAI_API_KEY`.
3. Import this GitHub repository in Vercel. Build command: `npm run build`.
4. Open `/admin/bootstrap` once. There is no default password.
5. Point a scheduler at `POST /api/cron` with `Authorization: Bearer $CRON_SECRET`.

## URL map

Public: `/` `/search` `/companies` `/companies/$slug` `/evidence/$id` `/verifiers` `/sectors/$slug` `/updates` `/evidence/expiring` `/evidence/expired` `/submit` `/methodology` `/sources` `/corrections`

Admin: `/admin` `/admin/review` `/admin/companies` `/admin/evidence` `/admin/sources` `/admin/jobs` `/admin/submissions` `/admin/verifiers` `/admin/settings` `/admin/audit`
