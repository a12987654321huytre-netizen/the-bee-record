import { audit } from "./audit.server.ts";
import type { Sql } from "./db-types.ts";
import { hashPassword, checkPasswordChange, verifyPassword } from "./passwords.ts";

export async function applyPasswordChange(
  db: Sql,
  input: {
    adminId: string;
    sessionId: string;
    storedHash: string;
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const currentMatches = await verifyPassword(input.currentPassword, input.storedHash);
  const check = checkPasswordChange({
    currentMatches,
    currentPassword: input.currentPassword,
    newPassword: input.newPassword,
    confirmPassword: input.confirmPassword,
  });
  if (!check.ok) return check;
  await db.query("update admin_users set password_hash = $2 where id = $1", [
    input.adminId,
    await hashPassword(input.newPassword),
  ]);
  await db.query("delete from admin_sessions where admin_user_id = $1 and id <> $2", [input.adminId, input.sessionId]);
  await audit(db, {
    actorType: "admin",
    actorId: input.adminId,
    action: "admin.password_changed",
    targetType: "admin_user",
    targetId: input.adminId,
    after: { otherSessionsRevoked: true },
  });
  return { ok: true };
}
