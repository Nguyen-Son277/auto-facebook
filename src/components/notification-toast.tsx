"use client";

import { useCallback, useEffect, useRef } from "react";
import { pushToast } from "./toast-provider";

// ============================================================
// PRODUCER thông báo — poll /api/notifications rồi đẩy lên <ToastHost />.
//
// Việc hiển thị nằm hoàn toàn ở toast-provider; component này chỉ lo lấy dữ
// liệu và chống hiện lặp. ID đã hiện lưu ở sessionStorage — refresh trang
// không hiện lại tin cũ.
// ============================================================

type Incoming = {
  id: string;
  type: "ACTIVITY" | "ADMIN" | "SYSTEM";
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
};

const POLL_MS = 30_000;
const SEEN_KEY = "dsh-notification-toast-seen";

/** Giữ đúng biểu tượng theo loại thông báo như trước. */
const ICON: Record<Incoming["type"], string> = {
  ACTIVITY: "📝",
  ADMIN: "🛡️",
  SYSTEM: "⚙️",
};

const KIND: Record<Incoming["type"], "ok" | "error" | "info"> = {
  ACTIVITY: "ok",
  ADMIN: "info",
  SYSTEM: "error",
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
  const seenRef = useRef<Set<string> | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=5", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { unread: number; items: Incoming[] };

      if (!seenRef.current) seenRef.current = loadSeen();
      const seen = seenRef.current;

      // Chỉ hiện tin CHƯA ĐỌC — tin đã đọc (kể cả chưa từng thấy) bỏ qua
      for (const n of data.items) {
        if (n.read || seen.has(n.id)) continue;
        seen.add(n.id);
        pushToast({
          kind: KIND[n.type],
          icon: ICON[n.type],
          title: n.title,
          body: n.body,
          link: n.link,
          notificationId: n.id,
          testId: `toast-item-${n.id}`,
        });
      }
      if (data.items.length > 0) saveSeen(seen);
    } catch {
      // Mạng lỗi — nhịp poll sau sẽ ăn
    }
  }, []);

  useEffect(() => {
    // Poll lần đầu sau 3 giây để tránh bắn tin ngay khi vừa login
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
    };
  }, [poll]);

  return null;
}
