import { createFileRoute, useRouter, useRouteContext } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Input, Label } from "@/components/ui";
import { changePasswordFn, getSettingsFn, saveSettingsFn } from "@/lib/bee/admin.functions";
import { MIN_PASSWORD_LENGTH } from "@/lib/bee/password-policy";

export const Route = createFileRoute("/admin/settings")({
  loader: () => getSettingsFn(),
  component: Settings,
  head: () => ({
    meta: [
      { title: "Settings — The BEE Record" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

function Settings() {
  const data = Route.useLoaderData();
  const ctx = useRouteContext({ from: "/admin" });
  const router = useRouter();
  const csrf = ctx.session?.csrf ?? "";
  const session = ctx.session;
  const cfg = data.rule.config;
  return (
    <div className="max-w-xl">
      <h1 className="font-display text-3xl">Settings</h1>
      <p className="mt-2 text-sm text-muted">
        {data.aiConfigured
          ? "AI extraction is configured."
          : "AI extraction is not configured. Manual and deterministic extraction still work."}
      </p>
      <form
        className="mt-6 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const bool = (name: string) => f.get(name) === "on";
          await saveSettingsFn({
            data: {
              csrf,
              autoPublishEnabled: bool("autoPublishEnabled"),
              ruleEnabled: bool("ruleEnabled"),
              confidenceThreshold: Number(f.get("confidenceThreshold")),
              expiringSoonDays: Number(f.get("expiringSoonDays")),
              config: {
                officialCompanyDomain: bool("officialCompanyDomain"),
                recognizedDocumentType: bool("recognizedDocumentType"),
                minimumConfidence: Number(f.get("confidenceThreshold")),
                exactEntityMatch: bool("exactEntityMatch"),
                validDates: bool("validDates"),
                noConflictingCurrentEvidence: bool("noConflictingCurrentEvidence"),
                knownVerifier: bool("knownVerifier"),
                registrationNumberConsistency: bool("registrationNumberConsistency"),
                manualLockConflictMustBeFalse: bool("manualLockConflictMustBeFalse"),
              },
            },
          });
          await router.invalidate();
        }}
      >
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="autoPublishEnabled" defaultChecked={data.autoPublishEnabled} /> Site-wide auto-publication
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="ruleEnabled" defaultChecked={data.rule.enabled} /> Enable current rule
        </label>
        <div>
          <Label htmlFor="confidenceThreshold">Minimum confidence</Label>
          <Input id="confidenceThreshold" name="confidenceThreshold" type="number" step="0.01" min="0" max="1" className="mt-1" defaultValue={data.confidenceThreshold} />
        </div>
        <div>
          <Label htmlFor="expiringSoonDays">Expiring-soon window (days)</Label>
          <Input id="expiringSoonDays" name="expiringSoonDays" type="number" className="mt-1" defaultValue={data.expiringSoonDays} />
        </div>
        <fieldset className="space-y-2 border border-rule p-3">
          <legend className="px-1 text-sm">Rule conditions</legend>
          {(
            [
              ["officialCompanyDomain", "Official company domain"],
              ["recognizedDocumentType", "Recognised document type"],
              ["exactEntityMatch", "Exact entity match"],
              ["validDates", "Valid dates"],
              ["noConflictingCurrentEvidence", "No conflicting current evidence"],
              ["knownVerifier", "Known verifier (optional)"],
              ["registrationNumberConsistency", "Registration-number consistency"],
              ["manualLockConflictMustBeFalse", "Block on manual lock conflict"],
            ] as const
          ).map(([name, label]) => (
            <label key={name} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={name} defaultChecked={cfg[name]} /> {label}
            </label>
          ))}
        </fieldset>
        <p className="text-xs text-muted">Saving creates a new rule version. Changes are audited.</p>
        <Button type="submit">Save settings</Button>
      </form>

      <section id="account" className="mt-12 scroll-mt-6 border-t border-rule pt-8">
        <h2 className="font-display text-2xl">Account</h2>
        <p className="mt-2 text-sm text-muted">
          Signed in as {session?.name} ({session?.email}) · {session?.role}. Change the password for this account here.
        </p>
        <ChangePasswordForm csrf={csrf} />
      </section>
    </div>
  );
}

function ChangePasswordForm({ csrf }: { csrf: string }) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form
      className="mt-6 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        setPending(true);
        setError(null);
        setSuccess(null);
        try {
          const result = await changePasswordFn({
            data: {
              csrf,
              currentPassword: String(f.get("currentPassword") || ""),
              newPassword: String(f.get("newPassword") || ""),
              confirmPassword: String(f.get("confirmPassword") || ""),
            },
          });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          form.reset();
          setSuccess("Password updated. Other sessions on this account have been signed out.");
        } catch {
          setError("Could not update the password. Try again.");
        } finally {
          setPending(false);
        }
      }}
    >
      <div>
        <Label htmlFor="currentPassword">Current password</Label>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          className="mt-1"
          autoComplete="current-password"
          required
        />
      </div>
      <div>
        <Label htmlFor="newPassword">New password</Label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          className="mt-1"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </div>
      <div>
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          className="mt-1"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </div>
      <p className="text-xs text-muted">Minimum {MIN_PASSWORD_LENGTH} characters. The current session stays signed in.</p>
      {error ? (
        <p className="text-sm text-rust" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="text-sm text-sage" role="status">
          {success}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Updating…" : "Change password"}
      </Button>
    </form>
  );
}
