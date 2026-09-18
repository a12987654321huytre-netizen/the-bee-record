export const MIN_PASSWORD_LENGTH = 12;

export function passwordPolicyError(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

export function checkPasswordChange(input: {
  currentMatches: boolean;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): { ok: true } | { ok: false; error: string } {
  if (!input.currentMatches) return { ok: false, error: "Current password is incorrect." };
  if (input.newPassword !== input.confirmPassword) {
    return { ok: false, error: "New passwords do not match." };
  }
  const policy = passwordPolicyError(input.newPassword);
  if (policy) return { ok: false, error: policy };
  if (input.newPassword === input.currentPassword) {
    return { ok: false, error: "Choose a different password from the current one." };
  }
  return { ok: true };
}
