import { Link } from "@tanstack/react-router";
import { APP_NAME } from "@/lib/bee/constants";

const NAV = [
  { to: "/search", label: "Search" },
  { to: "/companies", label: "Companies" },
  { to: "/verifiers", label: "Verifiers" },
  { to: "/updates", label: "Updates" },
  { to: "/methodology", label: "Methodology" },
  { to: "/submit", label: "Submit" },
] as const;

export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-cream focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="border-b border-rule bg-cream">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4 px-4 py-4 md:px-6">
          <Link to="/" className="group block">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-forest">South Africa · public evidence</p>
            <p className="font-display text-3xl leading-none text-ink group-hover:text-forest">{APP_NAME}</p>
          </Link>
          <nav aria-label="Primary" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="text-muted underline-offset-4 hover:text-ink hover:underline"
                activeProps={{ className: "text-ink underline underline-offset-4" }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="mt-16 border-t border-rule">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted md:flex-row md:justify-between md:px-6">
          <p>
            Indexes publicly disclosed B-BBEE information. Not an official register and not a finding of compliance.
          </p>
          <p className="flex flex-wrap gap-4">
            <Link to="/methodology" className="hover:text-ink">
              Methodology
            </Link>
            <Link to="/sources" className="hover:text-ink">
              Sources
            </Link>
            <Link to="/corrections" className="hover:text-ink">
              Corrections
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
