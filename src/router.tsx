import { createRouter } from "@tanstack/react-router";
import { AppErrorComponent } from "@/lib/error-component";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultErrorComponent: AppErrorComponent,
    defaultNotFoundComponent: () => (
      <main className="grid min-h-screen place-items-center bg-paper px-6 text-center text-ink">
        <div>
          <p className="font-display text-3xl">Not found</p>
          <p className="mt-2 text-sm text-muted">That record is not in the published index.</p>
          <a href="/" className="mt-4 inline-block underline underline-offset-4">
            Back to the index
          </a>
        </div>
      </main>
    ),
    scrollRestoration: true,
  });
}
