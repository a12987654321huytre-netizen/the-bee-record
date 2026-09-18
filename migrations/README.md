# Migrations

Production database is **Postgres** (Neon). The single schema file for this app is:

- [`0002_schema.sql`](0002_schema.sql)

## Apply in production

```bash
DATABASE_URL="$DATABASE_URL" npm run db:migrate
```

This runs [`scripts/migrate.mjs`](../scripts/migrate.mjs). Files in this directory
(not subdirectories) are applied once, recorded in `_migrations`.

`npm run build` already invokes the same command, so Vercel applies pending
migrations on each deploy when `DATABASE_URL` is set.

## What is not applied

`auth/0001_auth.sql` is the Better Auth schema. Public user accounts are off
(`VITE_AUTH_ENABLED=false`). Admin login is a separate `admin_users` table in
`0002_schema.sql`. Do not copy the auth file up unless you turn Better Auth on.

## Cloudflare D1

Do not run `0002_schema.sql` against D1. It uses Postgres types (`timestamptz`,
`bytea`, `ilike`, `interval`, `::int`). A D1 port needs a separate SQLite
dialect tree and is not in this repository.
