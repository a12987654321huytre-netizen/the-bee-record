import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Input, Label } from "@/components/ui";
import { loginAdminFn } from "@/lib/bee/admin.functions";

export const Route = createFileRoute("/admin/login")({
  component: Login,
  head: () => ({
    meta: [
      { title: "Admin login — The BEE Record" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

function Login() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form
        className="w-full max-w-sm space-y-4 border border-rule bg-cream p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setError(null);
          const form = new FormData(e.currentTarget);
          const result = await loginAdminFn({
            data: {
              email: String(form.get("email") || ""),
              password: String(form.get("password") || ""),
            },
          });
          setPending(false);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          await router.invalidate();
          await router.navigate({ to: "/admin" });
        }}
      >
        <h1 className="font-display text-2xl">Admin sign in</h1>
        <p className="text-sm text-muted">Server-side sessions. There is no default password.</p>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" className="mt-1" autoComplete="username" required />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" className="mt-1" autoComplete="current-password" required />
        </div>
        {error ? <p className="text-sm text-rust">{error}</p> : null}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </main>
  );
}
