"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  markAllReadAction,
  markReadAction,
} from "@/app/actions/notifications";

// ============================================================
// Chuông thông báo trên header dashboard.
//
// Server-render số chưa đọc (initialUnread) rồi polling mỗi 45s để bắt
// sự kiện mới — đơn giản, không cần WebSocket, và luôn đúng sau mỗi
// lần điều hướng.
// ============================================================

type Item = {
  id: string;
  type: "ACTIVITY" | "ADMIN" | "SYSTEM";
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
};

const ICON: Record<Item["type"], string> = {
  ACTIVITY: "📝",
  ADMIN: "🛡️",
  SYSTEM: "⚙️",
};

const POLL_MS = 45_000;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return "vừa xong";
  const m = Math.floor(diff / 60000);
  if (m < 1) return "vừa xong";
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  return `${Math.floor(h / 24)} ngày trước`;
}

export default function NotificationBell({
  initialUnread,
  testIdSuffix = "",
}: {
  initialUnread: number;
  /** Bản desktop + mobile cùng nằm trong DOM (ẩn bằng CSS) → cần testid riêng. */
  testIdSuffix?: string;
}) {
  const router = useRouter();
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=8", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { unread: number; items: Item[] };
      setUnread(data.unread);
      setItems(data.items);
    } catch {
      // Mạng chập chờn → giữ dữ liệu cũ, nhịp poll sau sẽ ăn.
    }
  }, []);

  // Poll định kỳ + mỗi lần tab quay lại focus
  useEffect(() => {
    const id = setInterval(refresh, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  // Đóng dropdown khi bấm ra ngoài
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function onToggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoading(true);
      await refresh();
      setLoading(false);
    }
  }

  async function openItem(item: Item) {
    if (!item.read) {
      // Cập nhật lạc quan rồi mới gọi server — phản hồi tức thì
      setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, read: true } : x)));
      setUnread((n) => Math.max(0, n - 1));
      void markReadAction([item.id]);
    }
    setOpen(false);
    if (item.link) router.push(item.link);
  }

  async function onMarkAll() {
    if (unread === 0) return;
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));
    setUnread(0);
    await markAllReadAction();
    router.refresh();
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={onToggle}
        aria-label={`Thông báo${unread ? ` (${unread} chưa đọc)` : ""}`}
        data-testid={`notification-bell${testIdSuffix}`}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-lg transition hover:bg-gray-50"
      >
        🔔
        {unread > 0 && (
          <span
            data-testid={`notification-count${testIdSuffix}`}
            className="absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          data-testid={`notification-panel${testIdSuffix}`}
          className="absolute right-0 z-50 mt-2 flex max-h-[min(28rem,75vh)] w-[22rem] max-w-[90vw] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl"
        >
          <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-gray-900">
              Thông báo{" "}
              {unread > 0 && <span className="text-red-600">({unread} mới)</span>}
            </p>
            <button
              type="button"
              onClick={onMarkAll}
              disabled={unread === 0}
              className="text-xs font-medium text-blue-600 hover:underline disabled:text-gray-300 disabled:no-underline"
            >
              Đánh dấu đã đọc
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && items.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-gray-400">Đang tải…</p>
            )}
            {!loading && items.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-gray-400">
                Chưa có thông báo nào.
              </p>
            )}
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openItem(item)}
                className={`flex w-full items-start gap-3 border-b border-gray-50 px-4 py-3 text-left transition hover:bg-gray-50 ${
                  item.read ? "opacity-70" : "bg-blue-50/40"
                }`}
              >
                <span className="mt-0.5 shrink-0 text-lg">{ICON[item.type]}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-gray-900">
                      {item.title}
                    </span>
                    {!item.read && (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-blue-600" />
                    )}
                  </span>
                  {item.body && (
                    <span className="mt-0.5 line-clamp-2 block text-xs text-gray-600">
                      {item.body}
                    </span>
                  )}
                  <span className="mt-1 block text-[11px] text-gray-400">
                    {timeAgo(item.createdAt)}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <a
            href="/notifications"
            className="block shrink-0 border-t border-gray-100 px-4 py-2.5 text-center text-xs font-semibold text-blue-600 hover:bg-blue-50"
          >
            Xem tất cả thông báo →
          </a>
        </div>
      )}
    </div>
  );
}
