import { createFileRoute, Link } from "@tanstack/react-router";
import { EmptyState } from "@/components/ui";
import { listJobsFn } from "@/lib/bee/admin.functions";
import { formatWhen } from "@/lib/bee/format";

export const Route = createFileRoute("/admin/jobs/")({
  loader: () => listJobsFn(),
  component: Jobs,
});

function Jobs() {
  const { items } = Route.useLoaderData();
  return (
    <div>
      <h1 className="font-display text-3xl">Crawler jobs</h1>
      {!items.length ? (
        <div className="mt-6">
          <EmptyState title="No crawler jobs have run." />
        </div>
      ) : (
        <table className="mt-6 w-full text-left text-sm">
          <thead className="border-y border-rule text-xs uppercase text-muted">
            <tr>
              <th className="py-2">Job</th>
              <th>Type</th>
              <th>State</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {(items as Array<{ id: string; type: string; state: string; started_at: string | null; error: string | null }>).map((j) => (
              <tr key={j.id} className="border-b border-rule">
                <td className="py-2">
                  <Link to="/admin/jobs/$id" params={{ id: j.id }} className="font-mono text-xs hover:underline">
                    {j.id}
                  </Link>
                </td>
                <td>{j.type}</td>
                <td>{j.state}</td>
                <td>{formatWhen(j.started_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
