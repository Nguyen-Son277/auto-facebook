"use client";

import { useActionState } from "react";
import { syncFacebookPages } from "@/app/actions/pages";

export type ConnectionOption = {
  id: string;
  name: string;
  appId: string;
};

export default function SyncPagesForm({
  hasToken,
  connections,
}: {
  hasToken: boolean;
  /** Danh sách Facebook App trong workspace — đồng bộ theo App được chọn. */
  connections: ConnectionOption[];
}) {
  const [state, action, pending] = useActionState(syncFacebookPages, null);

  if (connections.length === 0) {
    return (
      <div className="rounded-2xl border border-yellow-200 bg-yellow-50 p-5">
        <h2 className="font-semibold text-yellow-900">🔄 Đồng bộ Pages</h2>
        <p className="mt-1 text-sm text-yellow-800">
          Workspace chưa có Facebook App nào. Hãy vào trang{" "}
          <b>Facebook Apps</b> để thêm App (App ID + Secret) trước — mỗi App lấy
          được một nhóm Page khác nhau.
        </p>
        <a
          href="/facebook-apps"
          className="mt-3 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          🔗 Quản lý Facebook Apps
        </a>
      </div>
    );
  }

  return (
    <form action={action} className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
      <h2 className="font-semibold text-blue-900">🔄 Đồng bộ Pages</h2>
      <p className="mt-1 text-sm text-blue-800">
        Chọn <b>Facebook App</b> rồi dán <b>User Access Token</b> của App đó (quyền{" "}
        <code className="rounded bg-blue-100 px-1">pages_show_list</code>,{" "}
        <code className="rounded bg-blue-100 px-1">pages_manage_posts</code>,{" "}
        <code className="rounded bg-blue-100 px-1">pages_read_engagement</code>).
        App sẽ tự đổi token long-lived và import các Page mà App này cấp quyền.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-blue-900">Facebook App</span>
          <select
            name="connectionId"
            className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm"
            data-testid="sync-connection-select"
          >
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.appId})
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium text-blue-900">User Access Token</span>
          <input
            name="userToken"
            type="password"
            className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
            placeholder={hasToken ? "Token đã lưu — dán token mới nếu muốn thay" : "EAAG..."}
          />
        </label>
      </div>

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

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
        >
          {pending ? "Đang đồng bộ..." : "Đồng bộ Pages"}
        </button>
        <a
          href="/facebook-apps"
          className="rounded-lg border border-blue-300 px-4 py-2 text-sm text-blue-700 hover:bg-blue-100"
        >
          🔗 Thêm Facebook App khác
        </a>
      </div>
    </form>
  );
}
