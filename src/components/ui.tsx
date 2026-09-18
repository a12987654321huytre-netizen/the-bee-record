import type { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "plain" }) {
  const styles = {
    primary: "bg-forest text-cream hover:bg-forest-2",
    ghost: "border border-rule bg-cream text-ink hover:border-rule-strong",
    danger: "bg-rust text-cream hover:opacity-90",
    plain: "text-ink underline decoration-rule underline-offset-4 hover:decoration-ink",
  } as const;
  return (
    <button
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-sm px-4 text-sm font-medium transition-opacity duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "min-h-11 w-full rounded-sm border border-rule bg-cream px-3 text-sm text-ink placeholder:text-muted",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "min-h-11 w-full rounded-sm border border-rule bg-cream px-3 text-sm text-ink",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-28 w-full rounded-sm border border-rule bg-cream px-3 py-2 text-sm text-ink placeholder:text-muted",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("block text-xs font-medium uppercase tracking-wide text-muted", className)} {...props} />;
}

export function Status({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "current" | "expired" | "warn" | "review";
}) {
  const tones = {
    neutral: "border-rule text-muted",
    current: "border-sage text-sage",
    expired: "border-rust text-rust",
    warn: "border-amber text-amber",
    review: "border-forest text-forest",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="border border-dashed border-rule px-5 py-8">
      <p className="font-display text-lg text-ink">{title}</p>
      {body ? <p className="mt-2 max-w-prose text-sm text-muted">{body}</p> : null}
    </div>
  );
}

export function Field({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="border-t border-rule py-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 text-sm text-ink">{value}</dd>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
