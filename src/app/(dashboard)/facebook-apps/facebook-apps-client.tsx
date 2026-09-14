"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  saveFacebookConnection,
  deleteFacebookConnection,
  syncFacebookPages,
  type PageActionState,
} from "@/app/actions/pages";
import type { ConnectionView } from "@/lib/facebook-connection";

type PageLite = {
  id: string;
  name: string;
  fbPageId: string;
  isActive: boolean;
  brandId: string | null;
  tokenExpiresAt: string | null;
};

type Props = {
  workspaceId: string;
  connections: ConnectionView[];
  pagesByConnection: Record<string, PageLite[]>;
  orphanPages: PageLite[];
  brands: { id: string; name: string }[];
};

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: "🟢 Hoạt động", cls: "bg-green-50 text-green-700" },
  EXPIRED: { label: "⏳ Token hết hạn", cls: "bg-yellow-50 text-yellow-700" },
  ERROR: { label: "🔴 Lỗi", cls: "bg-red-50 text-red-700" },
  DISABLED: { label: "⚪ Đã tắt", cls: "bg-gray-100 text-gray-600" },
};

/** Form đồng bộ Pages cho MỘT connection — dùng useActionState đúng chữ ký action. */
function SyncForm({ conn }: { conn: ConnectionView }) {
  const [state, action, pending] = useActionState(
    syncFacebookPages,
    null as PageActionState
  );

  return (
    <form
      action={action}
      className="mt-4 flex flex-wrap items-end gap-2 rounded-xl bg-gray-50 p-3"
      data-testid={`fbapps-sync-${conn.appId}`}
    >
      <input type="hidden" name="connectionId" value={conn.id} />
      <label className="flex-1 text-xs">
        <span className="mb-1 block font-medium text-gray-600">
          User Access Token của App này (quyền pages_show_list,
          pages_manage_posts, pages_read_engagement)
        </span>
        <input
          name="userToken"
          placeholder="EAAG…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? "Đang đồng bộ…" : "🔄 Đồng bộ Pages"}
      </button>
      {state?.error && (
        <p
          className="w-full text-sm text-red-600"
          data-testid="fbapps-sync-error"
        >
          {state.error}
        </p>
      )}
      {state?.ok && state.message && (
        <p
          className="w-full text-sm text-green-700"
          data-testid="fbapps-sync-ok"
        >
          {state.message}
        </p>
      )}
    </form>
  );
}

export default function FacebookAppsClient({
  workspaceId,
  connections,
  pagesByConnection,
  orphanPages,
  brands,
}: Props) {
  const [saveState, saveAction, savePending] = useActionState(
    saveFacebookConnection,
    null as PageActionState
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<ConnectionView | null>(null);
  const [pending, startTransition] = useTransition();
  // "now" snapshot cập nhật theo interval — tránh gọi Date.now trong render
  const [now, setNow] = useState<number>(0);
  useEffect(() => {
    const sync = () => setNow(Date.now());
    sync();
    const timer = setInterval(sync, 60_000);
    return () => clearInterval(timer);
  }, []);

  const daysLeft = (iso: string | null) => {
    if (!iso || !now) return null;
    const ms = new Date(iso).getTime() - now;
    return Math.ceil(ms / 86400000);
  };

  return (
    <div className="space-y-6" data-testid="fbapps-root">
      {/* Form thêm/sửa connection */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900">
          {editing ? `Sửa "${editing.name}"` : "➕ Thêm Facebook App"}
        </h2>
        <p className="mt-1 text-xs text-gray-500">
          Mỗi Facebook App có App ID + Secret riêng. Thêm nhiều App để lấy được
          nhiều nhóm Page (Facebook giới hạn số Page mỗi App).
        </p>

        <form action={saveAction} className="mt-4 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          {editing && <input type="hidden" name="id" value={editing.id} />}

          <label className="text-sm">
            <span className="mb-1 block font-medium text-gray-700">Tên gợi nhớ</span>
            <input
              name="name"
              required
              defaultValue={editing?.name ?? ""}
              placeholder="Ví dụ: App Shop Chính"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              data-testid="fbapps-name"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-medium text-gray-700">App ID</span>
            <input
              name="appId"
              required
              defaultValue={editing?.appId ?? ""}
              placeholder="1234567890"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              data-testid="fbapps-appid"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-medium text-gray-700">
              App Secret {editing?.hasSecret && <em className="text-gray-400">(đã lưu — bỏ trống để giữ)</em>}
            </span>
            <input
              name="appSecret"
              type="password"
              required={!editing}
              placeholder={editing?.hasSecret ? "•••••••• (giữ nguyên)" : "App Secret"}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              data-testid="fbapps-secret"
            />
          </label>

          <label className="text-sm">
            <span className="mb-1 block font-medium text-gray-700">Graph API Version</span>
            <input
              name="graphVersion"
              defaultValue={editing?.graphVersion ?? "v25.0"}
              placeholder="v25.0"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={savePending}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
              data-testid="fbapps-save"
            >
              {savePending ? "Đang lưu…" : editing ? "💾 Cập nhật" : "➕ Thêm App"}
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="ml-2 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                Hủy
              </button>
            )}
            {saveState?.error && (
              <p className="mt-2 text-sm text-red-600" data-testid="fbapps-error">
                {saveState.error}
              </p>
            )}
            {saveState?.ok && saveState.message && (
              <p className="mt-2 text-sm text-green-700" data-testid="fbapps-ok">
                {saveState.message}
              </p>
            )}
          </div>
        </form>
      </section>

      {/* Danh sách connections */}
      <section className="space-y-4">
        <h2 className="text-base font-semibold text-gray-900">
          Facebook Apps trong workspace ({connections.length})
        </h2>

        {connections.length === 0 && (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500">
            Chưa có Facebook App nào. Thêm App đầu tiên ở trên.
          </p>
        )}

        {connections.map((conn) => {
          const status = STATUS_LABEL[conn.status] ?? STATUS_LABEL.ACTIVE;
          const pages = pagesByConnection[conn.id] ?? [];
          const left = daysLeft(conn.tokenExpiresAt);
          return (
            <article
              key={conn.id}
              className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
              data-testid={`fbapps-conn-${conn.appId}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-gray-900">
                    {conn.name}{" "}
                    <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${status.cls}`}>
                      {status.label}
                    </span>
                  </h3>
                  <p className="mt-0.5 text-xs text-gray-500">
                    App ID: <code className="rounded bg-gray-100 px-1">{conn.appId}</code> ·
                    Graph {conn.graphVersion} · {pages.length} Page
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditing(conn);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    ✏️ Sửa
                  </button>
                  <button
                    onClick={() =>
                      startTransition(async () => {
                        await deleteFacebookConnection(conn.id);
                        setNotice(
                          pages.length > 0
                            ? `Không xóa được "${conn.name}" — còn ${pages.length} Page đang dùng.`
                            : `Đã xóa "${conn.name}".`
                        );
                      })
                    }
                    disabled={pending}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
                  >
                    🗑️ Xóa
                  </button>
                </div>
              </div>

              {left !== null && left <= 7 && (
                <p className="mt-2 rounded-lg bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
                  ⚠️ Token của App này hết hạn sau {left} ngày — dán token mới rồi
                  đồng bộ lại.
                </p>
              )}
              {conn.lastError && (
                <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                  Lỗi gần nhất: {conn.lastError}
                </p>
              )}

              {/* Form đồng bộ Page theo connection này */}
              <SyncForm conn={conn} />

              {/* Pages của connection */}
              {pages.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-gray-600">
                    Pages đồng bộ qua App này:
                  </p>
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {pages.map((p) => {
                      const brandName = brands.find((b) => b.id === p.brandId)?.name;
                      const pDays = daysLeft(p.tokenExpiresAt);
                      return (
                        <li
                          key={p.id}
                          className={`rounded-full border px-2.5 py-1 text-xs ${
                            p.isActive
                              ? "border-gray-200 bg-white text-gray-700"
                              : "border-gray-200 bg-gray-100 text-gray-400"
                          }`}
                        >
                          {p.isActive ? "📄" : "⏸"} {p.name}
                          {brandName && (
                            <span className="ml-1 text-blue-600">[{brandName}]</span>
                          )}
                          {pDays !== null && pDays <= 7 && (
                            <span className="ml-1 text-yellow-600">
                              (token {pDays}d)
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </article>
          );
        })}

        {/* Pages chưa gắn connection (dữ liệu cũ) */}
        {orphanPages.length > 0 && (
          <article className="rounded-2xl border border-dashed border-yellow-300 bg-yellow-50/40 p-4">
            <p className="text-sm font-semibold text-yellow-800">
              ⚠️ {orphanPages.length} Page chưa gắn Facebook App
            </p>
            <p className="mt-1 text-xs text-yellow-700">
              Các Page này được tạo trước khi có tính năng đa App. Chúng vẫn đăng
              bài bình thường nhưng nên đồng bộ lại qua một App để quản lý token.
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {orphanPages.map((p) => (
                <li
                  key={p.id}
                  className="rounded-full border border-yellow-200 bg-white px-2.5 py-1 text-xs text-gray-700"
                >
                  📄 {p.name}
                </li>
              ))}
            </ul>
          </article>
        )}
      </section>

      {notice && (
        <p className="rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-700" data-testid="fbapps-notice">
          {notice}
        </p>
      )}
    </div>
  );
}
