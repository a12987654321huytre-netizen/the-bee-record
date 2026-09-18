import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public-shell";

export const Route = createFileRoute("/sources")({
  component: SourcesPage,
  head: () => ({ meta: [{ title: "Sources — The BEE Record" }] }),
});

function SourcesPage() {
  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-4 py-10 md:px-6">
        <h1 className="font-display text-4xl">Sources and provenance</h1>
        <p className="mt-4 text-muted">
          Every public claim should be answerable: which document, which field, when it was approved, by whom or by which
          rule, and whether older values exist.
        </p>
        <ul className="mt-6 list-disc space-y-2 pl-5">
          <li>Company pages show the supporting evidence, issue and expiry dates, source URL and source-live status.</li>
          <li>Evidence pages show hash, retrieval time, linked entities and published claims.</li>
          <li>Monitored sources are checked on a schedule. Failures are recorded; evidence is not deleted.</li>
          <li>
            Community tips enter moderation. See <Link to="/submit" className="underline underline-offset-4">Submit</Link>.
          </li>
        </ul>
        <p className="mt-6">
          Full rules: <Link to="/methodology" className="underline underline-offset-4">Methodology</Link>.
        </p>
      </article>
    </PublicShell>
  );
}
