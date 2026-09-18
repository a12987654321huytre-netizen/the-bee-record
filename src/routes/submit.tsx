import { createFileRoute, Link } from "@tanstack/react-router";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { PublicShell } from "@/components/public-shell";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { submitPublic } from "@/lib/bee/public.functions";

export const Route = createFileRoute("/submit")({
  component: SubmitPage,
  head: () => ({ meta: [{ title: "Submit a source — The BEE Record" }] }),
});

function SubmitPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <PublicShell>
      <div className="mx-auto max-w-xl px-4 py-10 md:px-6">
        <h1 className="font-display text-4xl">Submit a source</h1>
        <p className="mt-2 text-muted">
          Tips never publish themselves. They enter a moderation queue. Contact details stay private.
        </p>
        {done ? (
          <p className="mt-8 border border-rule bg-cream p-4">Received. It will not change any public record until reviewed.</p>
        ) : (
          <form
            className="mt-8 space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setPending(true);
              setError(null);
              const form = new FormData(e.currentTarget);
              const result = await submitPublic({
                data: {
                  type: String(form.get("type") || "other") as never,
                  companyText: String(form.get("companyText") || "") || undefined,
                  url: String(form.get("url") || "") || undefined,
                  message: String(form.get("message") || "") || undefined,
                  submitterName: String(form.get("submitterName") || "") || undefined,
                  submitterEmail: String(form.get("submitterEmail") || "") || undefined,
                },
              });
              setPending(false);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setDone(true);
              await router.invalidate();
            }}
          >
            <div>
              <Label htmlFor="type">Type</Label>
              <Select id="type" name="type" className="mt-1" defaultValue="certificate_url">
                <option value="certificate_url">Certificate URL</option>
                <option value="annual_report">Annual / integrated report</option>
                <option value="disclosure">Company disclosure</option>
                <option value="missing_company">Missing company</option>
                <option value="newer_evidence">Newer evidence</option>
                <option value="verification">Verification information</option>
                <option value="other">Other</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="companyText">Company</Label>
              <Input id="companyText" name="companyText" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="url">URL</Label>
              <Input id="url" name="url" type="url" className="mt-1" placeholder="https://" />
            </div>
            <div>
              <Label htmlFor="message">Details</Label>
              <Textarea id="message" name="message" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="submitterName">Your name (optional)</Label>
              <Input id="submitterName" name="submitterName" className="mt-1" autoComplete="name" />
            </div>
            <div>
              <Label htmlFor="submitterEmail">Email (optional, not published)</Label>
              <Input id="submitterEmail" name="submitterEmail" type="email" className="mt-1" autoComplete="email" />
            </div>
            {error ? <p className="text-sm text-rust">{error}</p> : null}
            <Button type="submit" disabled={pending}>
              {pending ? "Sending…" : "Submit for review"}
            </Button>
          </form>
        )}
        <p className="mt-6 text-sm">
          Need to dispute a published field? Use{" "}
          <Link to="/corrections" className="underline underline-offset-4">
            corrections
          </Link>
          .
        </p>
      </div>
    </PublicShell>
  );
}
