"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { markReadAction } from "@/app/actions/notifications";

// ============================================================
// Toast thông báo — popup nhỏ ở GÓC DƯỚI TRÁI.
//
// Poll /api/notifications mỗi 30s; tin mới (id chưa thấy trong phiên)
// hiện popup nhỏ, tự ẩn sau ~7 giây. Bấm vào = đánh dấu đã đọc +
// điều hướng tới link. ID đã hiện lưu sessionStorage — refresh trang
// không hiện lại tin cũ.
// ============================================================

type ToastItem = {
  id: string;
  type: "ACTIVITY" | "ADMIN" | "SYSTEM";
  title: string;
  body: string | null;
  link: string | null;
};

const POLL_MS = 30_000;
const AUTO_HIDE_MS = 7_000;
const SEEN_KEY = "dsh-notification-toast-seen";

const ICON: Record<ToastItem["type"], string> = {
  ACTIVITY: "📝",
  ADMIN: "🛡️",
  SYSTEM: "⚙️",
};

function loadSeen(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(SEEN_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveSeen(seen: Set<string>) {
  try {
    // Giữ tối đa 200 id — tránh phình sessionStorage
    sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-200)));
  } catch {
    // sessionStorage đầy/bị chặn — bỏ qua
  }
}

export default function NotificationToast() {
  const router = useRouter();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seenRef = useRef<Set<string> | null>(null);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const pushToasts = useCallback(
    (items: ToastItem[]) => {
      if (!seenRef.current) seenRef.current = loadSeen();
      const seen = seenRef.current;
      const fresh = items.filter((n) => !seen.has(n.id));
      if (fresh.length === 0) return;

      for (const n of fresh) seen.add(n.id);
      saveSeen(seen);

      setToasts((prev) => [...fresh, ...prev].slice(0, 3));
      for (const n of fresh) {
        const timer = setTimeout(() => dismiss(n.id), AUTO_HIDE_MS);
        timersRef.current.set(n.id, timer);
      }
    },
    [dismiss]
  );

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=5", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        unread: number;
        items: { id: string; type: ToastItem["type"]; title: string; body: string | null; link: string | null; read: boolean }[];
      };
      // Chỉ hiện tin CHƯA ĐỌC — tin đã đọc (kể cả chưa từng thấy) bỏ qua
      pushToasts(
        data.items
          .filter((n) => !n.read)
          .map(({ id, type, title, body, link }) => ({ id, type, title, body, link }))
      );
    } catch {
      // Mạng lỗi — nhịp poll sau sẽ ăn
    }
  }, [pushToasts]);

  useEffect(() => {
    // Chờ 2 nhịp đầu để tránh bắn tin ngay khi vừa login (tin cũ đã đọc
    // không bị lọc kịp). Poll lần đầu sau 3 giây.
    const timers = timersRef.current;
    const first = setTimeout(poll, 3_000);
    const id = setInterval(poll, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, [poll]);

  function openToast(t: ToastItem) {
    void markReadAction([t.id]);
    dismiss(t.id);
    if (t.link) router.push(t.link);
  }

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 left-4 z-[60] flex w-80 max-w-[90vw] flex-col gap-2"
      data-testid="notification-toast"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          className="pointer-events-auto overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl"
        >
          <div className="flex items-start gap-3 px-4 py-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-base">
              {ICON[t.type]}
            </span>
            <button
              type="button"
              onClick={() => openToast(t)}
              className="min-w-0 flex-1 text-left"
              data-testid={`toast-item-${t.id}`}
            >
              <p className="truncate text-sm font-semibold text-gray-900">{t.title}</p>
              {t.body && (
                <p className="mt-0.5 line-clamp-2 text-xs text-gray-600">{t.body}</p>
              )}
            </button>
            <button
              type="button"
              aria-label="Đóng thông báo"
              onClick={() => dismiss(t.id)}
              className="shrink-0 rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
            >
              ✕
            </button>
          </div>
          {/* Thanh đếm thời gian tự ẩn */}
          <div className="h-0.5 w-full bg-blue-600" style={{ animation: `toast-life ${AUTO_HIDE_MS}ms linear forwards` }} />
        </div>
      ))}
      <style>{`@keyframes toast-life { from { width: 100% } to { width: 0% } }`}</style>
    </div>
  );
}
