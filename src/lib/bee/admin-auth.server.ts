import { getCookie, getRequest, getRequestHeader, setCookie } from "@tanstack/react-start/server";
import { applyPasswordChange } from "./admin-password.server.ts";
import { SESSION_COOKIE, SESSION_TTL_MS } from "./constants.ts";
import { sha256HexNode, ipHash } from "./hash.ts";
import { newId } from "./ids.ts";
import { hashPassword, passwordPolicyError, randomToken, verifyPassword } from "./passwords.ts";
import { sql } from "./sql.server.ts";
import type { AdminSession } from "./types.ts";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;

function cookieSecure(): boolean {
  const proto = getRequestHeader("x-forwarded-proto") ?? new URL(getRequest().url).protocol.replace(":", "");
  return proto === "https";
}

function clientIp(): string | null {
  const fwd = getRequestHeader("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() ?? null;
  return getRequestHeader("x-real-ip") ?? null;
}

export function assertSameOrigin() {
  const request = getRequest();
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new Error("Forbidden");
  }
  if (originHost !== host) throw new Error("Forbidden");
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const token = getCookie(SESSION_COOKIE);
  if (!token) return null;
  const db = await sql();
  const tokenHash = sha256HexNode(token);
  const rows = await db.query<{
    sid: string;
    csrf: string;
    expires_at: string;
    admin_id: string;
    email: string;
    name: string;
    role: "administrator" | "reviewer";
    disabled: number;
  }>(
    `select s.id as sid, s.csrf_secret as csrf, s.expires_at, u.id as admin_id, u.email, u.name, u.role, u.disabled
     from admin_sessions s
     join admin_users u on u.id = s.admin_user_id
     where s.token_hash = $1
     limit 1`,
    [tokenHash],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.disabled) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.query("delete from admin_sessions where id = $1", [row.sid]);
    return null;
  }
  await db.query("update admin_sessions set last_seen_at = now() where id = $1", [row.sid]);
  return {
    sessionId: row.sid,
    adminId: row.admin_id,
    email: row.email,
    name: row.name,
    role: row.role,
    csrf: row.csrf,
  };
}

export async function requireAdmin(): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session) {
    const err = new Error("Unauthorized");
    (err as Error & { status?: number }).status = 401;
    throw err;
  }
  return session;
}

export async function requireAdministrator(): Promise<AdminSession> {
  const session = await requireAdmin();
  if (session.role !== "administrator") {
    const err = new Error("Forbidden");
    (err as Error & { status?: number }).status = 403;
    throw err;
  }
  return session;
}

export async function adminCount(): Promise<number> {
  const db = await sql();
  const rows = await db.query<{ n: number }>("select count(*)::int as n from admin_users");
  return rows[0]?.n ?? 0;
}

async function tooManyFailures(email: string, ip: string | null): Promise<boolean> {
  const db = await sql();
  const since = new Date(Date.now() - LOGIN_WINDOW_MS).toISOString();
  const rows = await db.query<{ n: number }>(
    `select count(*)::int as n from login_attempts
     where email_normalized = $1 and success = 0 and attempted_at >= $2
       and ($3::text is null or ip_hash = $3)`,
    [email.toLowerCase(), since, ipHash(ip)],
  );
  return (rows[0]?.n ?? 0) >= LOGIN_MAX_FAILURES;
}

async function recordAttempt(email: string, ip: string | null, success: boolean) {
  const db = await sql();
  await db.query(
    "insert into login_attempts (id, email_normalized, ip_hash, success) values ($1,$2,$3,$4)",
    [newId("att"), email.toLowerCase(), ipHash(ip), success ? 1 : 0],
  );
}

function setSessionCookie(token: string) {
  setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

function clearSessionCookie() {
  setCookie(SESSION_COOKIE, "", {
    path: "/",
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    maxAge: 0,
  });
}

export async function loginAdmin(email: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  assertSameOrigin();
  const trimmed = email.trim().toLowerCase();
  const ip = clientIp();
  if (await tooManyFailures(trimmed, ip)) {
    return { ok: false, error: "Too many failed attempts. Try again in 15 minutes." };
  }
  const db = await sql();
  const users = await db.query<{
    id: string;
    password_hash: string;
    disabled: number;
  }>("select id, password_hash, disabled from admin_users where email = $1 limit 1", [trimmed]);
  const user = users[0];
  if (!user || user.disabled) {
    await recordAttempt(trimmed, ip, false);
    return { ok: false, error: "Invalid email or password." };
  }
  const good = await verifyPassword(password, user.password_hash);
  if (!good) {
    await recordAttempt(trimmed, ip, false);
    return { ok: false, error: "Invalid email or password." };
  }
  await recordAttempt(trimmed, ip, true);
  const token = randomToken(32);
  const csrf = randomToken(24);
  await db.query(
    `insert into admin_sessions (id, admin_user_id, token_hash, csrf_secret, expires_at, ip_hash, user_agent)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      newId("ses"),
      user.id,
      sha256HexNode(token),
      csrf,
      new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      ipHash(ip),
      getRequestHeader("user-agent")?.slice(0, 250) ?? null,
    ],
  );
  await db.query("update admin_users set last_login_at = now() where id = $1", [user.id]);
  setSessionCookie(token);
  return { ok: true };
}

export async function logoutAdmin() {
  const token = getCookie(SESSION_COOKIE);
  if (token) {
    const db = await sql();
    await db.query("delete from admin_sessions where token_hash = $1", [sha256HexNode(token)]);
  }
  clearSessionCookie();
}

export async function bootstrapAdmin(input: {
  name: string;
  email: string;
  password: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  assertSameOrigin();
  if ((await adminCount()) > 0) return { ok: false, error: "An administrator already exists." };
  const policy = passwordPolicyError(input.password);
  if (policy) return { ok: false, error: policy };
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter a valid email address." };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  const db = await sql();
  const id = newId("adm");
  await db.query(
    "insert into admin_users (id, email, name, password_hash, role) values ($1,$2,$3,$4,'administrator')",
    [id, email, name, await hashPassword(input.password)],
  );
  return loginAdmin(email, input.password);
}

export async function changeOwnPassword(input: {
  csrf: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  assertSameOrigin();
  const session = await requireAdmin();
  requireCsrf(session, input.csrf);
  const db = await sql();
  const rows = await db.query<{ password_hash: string }>(
    "select password_hash from admin_users where id = $1 and disabled = 0 limit 1",
    [session.adminId],
  );
  const row = rows[0];
  if (!row) return { ok: false, error: "Account is no longer active." };
  return applyPasswordChange(db, {
    adminId: session.adminId,
    sessionId: session.sessionId,
    storedHash: row.password_hash,
    currentPassword: input.currentPassword,
    newPassword: input.newPassword,
    confirmPassword: input.confirmPassword,
  });
}

export function requireCsrf(session: AdminSession, token: string | null | undefined) {
  if (!token || token !== session.csrf) {
    const err = new Error("Invalid CSRF token");
    (err as Error & { status?: number }).status = 403;
    throw err;
  }
}
