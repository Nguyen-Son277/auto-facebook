"use client";

import { useState, useTransition } from "react";
import {
  adminCreateNotification,
  adminDeleteNotification,
  adminUpdateNotification,
  type AdminNotifyState,
} from "@/app/actions/admin-notifications";

// ============================================================
// Giao diện admin quản lý thông báo:
//  - Form soạn mới (đích: tất cả / chỉ admin / 1 user cụ thể)
//  - Danh sách 100 tin gần đây kèm sửa / xoá
// ============================================================

export type NotificationRow = {
  id: string;
  userId: string;
  type: "ACTIVITY" | "ADMIN" | "SYSTEM";
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
  userEmail: string;
  userName: string | null;
  userRole: string;
};

export type UserOption = { id: string; label: string };

export default function NotificationsAdminClient({
  notifications,
  users,
}: {
  notifications: NotificationRow[];
  users: UserOption[];
}) {
  const [notice, setNotice] = useState<AdminNotifyState>(null);
  const [busy, startBusy] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function run(fn: () => Promise<AdminNotifyState>): Promise<AdminNotifyState> {
    let res: AdminNotifyState = null;
    await new Promise<void>((resolve) => {
      startBusy(async () => {
        res = await fn();
        setNotice(res);
        resolve();
      });
    });
    return res;
  }

  return (
    <div className="space-y-6">
      {notice?.error && (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">✗ {notice.error}</p>
      )}
      {notice?.ok && notice.message && (
        <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          ✓ {notice.message}
        </p>
      )}

      {/* ===== Soạn thông báo mới ===== */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Soạn thông báo mới</h2>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            {showForm ? "Đóng" : "＋ Soạn thông báo"}
          </button>
        </div>

        {showForm && (
          <form
            action={async (fd) => {
              const res = await run(() => adminCreateNotification(null, fd));
              if (res?.ok) setShowForm(false);
            }}
            className="mt-4 space-y-3"
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-sm">
                <span className="mb-1 block font-medium text-gray-700">Gửi tới</span>
                <select
                  name="target"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  defaultValue="all"
                >
                  <option value="all">Tất cả người dùng</option>
                  <option value="admins">Chỉ admin</option>
                  {users.map((u) => (
                    <option key={u.id} value={`user:${u.id}`}>
                      Riêng: {u.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-gray-700">Loại</span>
                <select
                  name="type"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  defaultValue="ADMIN"
                >
                  <option value="ADMIN">🛡️ Từ Admin</option>
                  <option value="SYSTEM">⚙️ Hệ thống</option>
                  <option value="ACTIVITY">📝 Hoạt động</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-gray-700">
                  Link nội bộ <em className="text-gray-400">(tùy chọn, ví dụ /docs)</em>
                </span>
                <input
                  name="link"
                  placeholder="/docs"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">Tiêu đề *</span>
              <input
                name="title"
                required
                maxLength={200}
                placeholder="Ví dụ: 📢 Bảo trì hệ thống lúc 22:00"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">Nội dung</span>
              <textarea
                name="body"
                rows={3}
                maxLength={2000}
                placeholder="Nội dung chi tiết..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? "Đang gửi..." : "📣 Gửi thông báo"}
            </button>
          </form>
        )}
      </section>

      {/* ===== Danh sách thông báo đã gửi ===== */}
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="font-semibold text-gray-900">
            Thông báo gần đây ({notifications.length})
          </h2>
        </div>

        {notifications.length === 0 && (
          <p className="px-5 py-10 text-center text-sm text-gray-500">
            Chưa có thông báo nào.
          </p>
        )}

        <ul className="divide-y divide-gray-100">
          {notifications.map((n) => (
            <li key={n.id} className="px-5 py-3" data-testid={`admin-notify-${n.id}`}>
              {editingId === n.id ? (
                <form
                  action={async (fd) => {
                    const res = await run(() => adminUpdateNotification(null, fd));
                    if (res?.ok) setEditingId(null);
                  }}
                  className="space-y-2"
                >
                  <input type="hidden" name="id" value={n.id} />
                  <div className="grid gap-2 sm:grid-cols-3">
                    <select
                      name="type"
                      defaultValue={n.type}
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
                    >
                      <option value="ADMIN">🛡️ Admin</option>
                      <option value="SYSTEM">⚙️ Hệ thống</option>
                      <option value="ACTIVITY">📝 Hoạt động</option>
                    </select>
                    <input
                      name="link"
                      defaultValue={n.link ?? ""}
                      placeholder="/link"
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs"
                    />
                    <input
                      name="title"
                      required
                      defaultValue={n.title}
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs sm:col-span-3"
                    />
                    <textarea
                      name="body"
                      rows={2}
                      defaultValue={n.body ?? ""}
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs sm:col-span-3"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={busy}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      💾 Lưu
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600"
                    >
                      Huỷ
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900">
                      {n.title}
                      {!n.read && (
                        <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                          chưa đọc
                        </span>
                      )}
                    </p>
                    {n.body && <p className="mt-0.5 text-xs text-gray-600">{n.body}</p>}
                    <p className="mt-1 text-[11px] text-gray-400">
                      → {n.userName || n.userEmail}
                      {n.userRole === "ADMIN" && " (admin)"} ·{" "}
                      {new Date(n.createdAt).toLocaleString("vi-VN")}
                      {n.link && ` · ${n.link}`}
                    </p>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditingId(n.id)}
                      className="rounded-lg border border-blue-300 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
                    >
                      ✏️ Sửa
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Xoá thông báo "${n.title}"?`)) {
                          run(() => adminDeleteNotification(n.id));
                        }
                      }}
                      className="rounded-lg border border-red-300 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      🗑 Xoá
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
