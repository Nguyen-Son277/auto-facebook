"use client";

/**
 * Select chuyển workspace — client component vì cần onChange để tự submit.
 * GET submit với ?ws=<id> nên server component đọc searchParams để lọc.
 */
export default function WorkspaceSelect({
  workspaces,
}: {
  workspaces: { id: string; name: string }[];
}) {
  return (
    <form method="get" className="mt-1">
      <select
        name="ws"
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        data-testid="fbapps-workspace-select"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
      <button type="submit" className="ml-2 hidden">
        Chuyển
      </button>
    </form>
  );
}
