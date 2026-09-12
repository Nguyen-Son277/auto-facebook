"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { markAllReadAction, markReadAction } from "@/app/actions/notifications";

// ============================================================
// Trang hộp thư đầy đủ (/notifications).
//
// Server render danh sách ban đầu (items) + số chưa đọc; client giữ
// trạng thái乐观 khi đánh dấu đã đọc rồi gọi server action. Bộ lọc
// "Chưa đọc / Tất cả" đổi query param ?filter=all để SSR lại trang.
// ============================================================

export type NotificationItem = {
  id: string;
  type: "ACTIVITY" | "ADMIN" | "SYSTEM";
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
};

const ICON: Record<NotificationItem["type"], string> = {
  ACTIVITY: "📝",
  ADMIN: "🛡️",
  SYSTEM: "⚙️",
};

const TYPE_LABEL: Record<NotificationItem["type"], string> = {
  ACTIVITY: "Bài viết",
  ADMIN: "Quản trị",
  SYSTEM: "Hệ thống",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return "vừa xong";
  const m = Math.floor(diff / 60000);
  if (m < 1) return "vừa xong";
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} ngày trước`;
  return new Date(iso).toLocaleDateString("vi-VN");
}

export default function NotificationsClient({
  initialUnread,
  showAll,
  items,
}: {
  initialUnread: number;
  showAll: boolean;
  items: NotificationItem[];
}) {
  const router = useRouter();
  const [unread, setUnread] = useState(initialUnread);
  const [rows, setRows] = useState(items);
  const [pending, startTransition] = useTransition();

  function openItem(item: NotificationItem) {
    if (!item.read) {
      // Cập nhật lạc quan trước, server action chạy nền
      setRows((prev) =>
        prev.map((x) => (x.id === item.id ? { ...x, read: true } : x))
      );
      setUnread((n) => Math.max(0, n - 1));
      void markReadAction([item.id]);
    }
    if (item.link) router.push(item.link);
  }

  function onMarkAll() {
    if (unread === 0) return;
    setRows((prev) => prev.map((x) => ({ ...x, read: true })));
    setUnread(0);
    startTransition(async () => {
      await markAllReadAction();
      router.refresh();
    });
  }

  const unreadIds = rows.filter((x) => !x.read).map((x) => x.id);

  return (
    <div>
      {/* Thanh công cụ: bộ lọc + đánh dấu đã đọc */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          className="flex rounded-xl border border-gray-200 bg-white p-1"
        >
          <Link
            href="/notifications"
            role="tab"
            aria-selected={!showAll}
            data-testid="notifications-filter-unread"
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
              !showAll
                ? "bg-blue-600 text-white"
                : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            Chưa đọc {unread > 0 && `(${unread})`}
          </Link>
          <Link
            href="/notifications?filter=all"
            role="tab"
            aria-selected={showAll}
            data-testid="notifications-filter-all"
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
              showAll
                ? "bg-blue-600 text-white"
                : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            Tất cả
          </Link>
        </div>

        <button
          type="button"
          onClick={onMarkAll}
          disabled={unread === 0 || pending}
          data-testid="notifications-mark-all"
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-600 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-white"
        >
          ✅ Đánh dấu tất cả đã đọc
        </button>
      </div>

      {/* Danh sách */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        {rows.length === 0 && (
          <div
            data-testid="notifications-empty"
            className="px-6 py-16 text-center"
          >
            <p className="text-4xl">📭</p>
            <p className="mt-3 text-sm font-medium text-gray-900">
              {showAll
                ? "Chưa có thông báo nào."
                : "Bạn đã đọc hết thông báo."}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Thông báo mới về bài đăng và tin từ quản trị sẽ xuất hiện ở đây.
            </p>
          </div>
        )}

        {rows.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => openItem(item)}
            data-testid={`notification-item-${item.read ? "read" : "unread"}`}
            className={`flex w-full items-start gap-4 border-b border-gray-50 px-5 py-4 text-left transition last:border-b-0 hover:bg-gray-50 ${
              item.read ? "opacity-75" : "bg-blue-50/40"
            }`}
          >
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-xl">
              {ICON[item.type]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-gray-900">
                  {item.title}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    item.type === "ADMIN"
                      ? "bg-purple-100 text-purple-700"
                      : item.type === "SYSTEM"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-blue-100 text-blue-700"
                  }`}
                >
                  {TYPE_LABEL[item.type]}
                </span>
                {!item.read && (
                  <span
                    data-testid="notification-dot"
                    className="h-2 w-2 shrink-0 rounded-full bg-blue-600"
                  />
                )}
              </span>
              {item.body && (
                <span className="mt-1 block text-sm leading-relaxed text-gray-600">
                  {item.body}
                </span>
              )}
              <span className="mt-1.5 block text-[11px] text-gray-400">
                {timeAgo(item.createdAt)}
                {item.link && (
                  <span className="ml-1 font-medium text-blue-600">
                    · Xem chi tiết →
                  </span>
                )}
              </span>
            </span>
          </button>
        ))}
      </div>

      {rows.length > 0 && unreadIds.length > 0 && (
        <p className="mt-3 text-center text-xs text-gray-400">
          Còn {unreadIds.length} thông báo chưa đọc
        </p>
      )}
    </div>
  );
}
