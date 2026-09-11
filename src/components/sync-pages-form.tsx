"use client";

import { useActionState } from "react";
import { syncFacebookPages } from "@/app/actions/pages";

export default function SyncPagesForm({ hasToken }: { hasToken: boolean }) {
  const [state, action, pending] = useActionState(syncFacebookPages, null);

  return (
    <form
      action={action}
      className="rounded-2xl border border-blue-200 bg-blue-50 p-5"
    >
      <h2 className="font-semibold text-blue-900">🔄 Đồng bộ Pages</h2>
      <p className="mt-1 text-sm text-blue-800">
        Dán <b>User Access Token</b> có quyền{" "}
        <code className="rounded bg-blue-100 px-1">pages_show_list</code>,{" "}
        <code className="rounded bg-blue-100 px-1">pages_manage_posts</code>,{" "}
        <code className="rounded bg-blue-100 px-1">pages_read_engagement</code>.
        App sẽ tự đổi token long-lived và import toàn bộ Page bạn quản lý.
      </p>

      <input
        name="userToken"
        type="password"
        className="mt-3 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
        placeholder={hasToken ? "Token đã lưu — dán token mới nếu muốn thay" : "EAAG..."}
      />

      {state?.error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          ✗ {state.error}
        </p>
      )}
      {state?.ok && (
        <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <p className="font-medium">✓ {state.message}</p>
          {state.details?.map((d, i) => (
            <p key={i} className="mt-0.5 text-xs">
              {d}
            </p>
          ))}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
      >
        {pending ? "Đang đồng bộ..." : "Đồng bộ Pages"}
      </button>
    </form>
  );
}
