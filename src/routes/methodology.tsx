import { createFileRoute } from "@tanstack/react-router";
import { PublicShell } from "@/components/public-shell";

export const Route = createFileRoute("/methodology")({
  component: Methodology,
  head: () => ({ meta: [{ title: "Methodology — The BEE Record" }] }),
});

function Methodology() {
  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-4 py-10 md:px-6">
        <h1 className="font-display text-4xl">Methodology</h1>
        <p className="mt-4 text-lg text-muted">
          The BEE Record is a public evidence index, not an official B-BBEE register and not a regulator. Inclusion or
          absence does not prove compliance, non-compliance, ownership, or control beyond what the cited document says.
        </p>
        <Section title="Public evidence model">
          Every published fact is attached to a document: a certificate, affidavit, annual report, disclosure page or other
          checkable public source. The current company view is an interpretation of approved evidence, not a row that
          overwrites history.
        </Section>
        <Section title="Evidence preservation">
          Documents are hashed. Identical bytes are not stored twice. A newer certificate does not erase an older one.
          Expired and superseded records remain inspectable. If a source URL later returns 404, the historical record stays.
        </Section>
        <Section title="Source priority">
          Primary evidence is preferred: original certificates and affidavits, then official company sites and
          disclosures, then verification or regulatory sources, then other credible public secondary sources. Secondary
          sources help discovery; they do not silently outrank a stronger primary document.
        </Section>
        <Section title="Extraction">
          Structured fields are extracted by a deterministic parser and, when configured, a server-side model. Model
          output is validated against a schema. Document text is treated as untrusted. Extraction is not automatically
          treated as truth.
        </Section>
        <Section title="Human review">
          Uncertain entity matches, conflicting levels, locked-field collisions, malformed extraction and community
          submissions enter a review queue. Approval publishes a new interpretation without deleting prior evidence.
        </Section>
        <Section title="Entity matching">
          Search may list similar names. Search never merges companies. Registration-number conflicts and ambiguous names
          go to review. Fuzzy resemblance is not identity.
        </Section>
        <Section title="Automation">
          Auto-publication is optional and conservative. When it runs, the exact rule version is stored on the publication
          event. Manual locks are not silently overwritten.
        </Section>
        <Section title="Expiry and supersession">
          Status is calculated from dates. “Expiring soon” uses a configured window. Expiry changes status; it does not
          delete the document. A later certificate may supersede an earlier one for the current view while both remain
          in the timeline.
        </Section>
        <Section title="Corrections">
          Anyone can submit a source tip or a dispute. Submissions never publish themselves. Moderators review them and
          leave an audit trail.
        </Section>
        <Section title="Limitations">
          The index only knows what it has fetched and reviewed. Missing companies are not a finding. OCR and parsers
          fail. Dates can be ambiguous and are left unknown rather than guessed. Archived files may be retained without
          being offered as a public download.
        </Section>
      </article>
    </PublicShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 border-t border-rule pt-6">
      <h2 className="font-display text-2xl">{title}</h2>
      <p className="mt-2 text-ink-2">{children}</p>
    </section>
  );
}
