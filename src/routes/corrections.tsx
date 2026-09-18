import { createFileRoute } from "@tanstack/react-router";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { PublicShell } from "@/components/public-shell";
import { Button, Input, Label, Textarea } from "@/components/ui";
import { submitPublic } from "@/lib/bee/public.functions";

export const Route = createFileRoute("/corrections")({
  validateSearch: (s: Record<string, unknown>): { company?: string; evidence?: string } => ({
    company: typeof s.company === "string" && s.company ? s.company : undefined,
    evidence: typeof s.evidence === "string" && s.evidence ? s.evidence : undefined,
  }),
  component: Corrections,
  head: () => ({ meta: [{ title: "Corrections — The BEE Record" }] }),
});

function Corrections() {
  const search = Route.useSearch();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <PublicShell>
      <div className="mx-auto max-w-xl px-4 py-10 md:px-6">
        <h1 className="font-display text-4xl">Corrections and disputes</h1>
        <p className="mt-2 text-muted">
          Identify the company or evidence, the field, and a supporting URL. This enters review and does not edit the
          public database directly.
        </p>
        {done ? (
          <p className="mt-8 border border-rule bg-cream p-4">Dispute received. Public records are unchanged until review.</p>
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
                  type: "correction",
                  companyText: String(form.get("companyText") || "") || undefined,
                  url: String(form.get("url") || "") || undefined,
                  disputedField: String(form.get("disputedField") || "") || undefined,
                  message: String(form.get("message") || "") || undefined,
                  submitterName: String(form.get("submitterName") || "") || undefined,
                  submitterEmail: String(form.get("submitterEmail") || "") || undefined,
                  evidenceId: String(form.get("evidenceId") || "") || undefined,
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
              <Label htmlFor="companyText">Company</Label>
              <Input id="companyText" name="companyText" className="mt-1" defaultValue={search.company} />
            </div>
            <div>
              <Label htmlFor="evidenceId">Evidence ID (if known)</Label>
              <Input id="evidenceId" name="evidenceId" className="mt-1" defaultValue={search.evidence} />
            </div>
            <div>
              <Label htmlFor="disputedField">Disputed field</Label>
              <Input id="disputedField" name="disputedField" className="mt-1" placeholder="B-BBEE level, expiry date…" />
            </div>
            <div>
              <Label htmlFor="url">Supporting URL</Label>
              <Input id="url" name="url" type="url" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="message">Explanation</Label>
              <Textarea id="message" name="message" className="mt-1" required />
            </div>
            <div>
              <Label htmlFor="submitterName">Name (optional)</Label>
              <Input id="submitterName" name="submitterName" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="submitterEmail">Email (optional, not published)</Label>
              <Input id="submitterEmail" name="submitterEmail" type="email" className="mt-1" />
            </div>
            {error ? <p className="text-sm text-rust">{error}</p> : null}
            <Button type="submit" disabled={pending}>
              {pending ? "Sending…" : "Submit dispute"}
            </Button>
          </form>
        )}
      </div>
    </PublicShell>
  );
}
