"use client";

import { useEffect, useRef } from "react";
import { pushToast } from "./toast-provider";
import { useNotifications } from "./notification-provider";
import type { NotificationItem } from "@/lib/notification-polling";

// ============================================================
// PRODUCER thông báo — dùng dữ liệu chung rồi đẩy lên <ToastHost />.
//
// Việc hiển thị nằm hoàn toàn ở toast-provider; component này chỉ lo lấy dữ
// liệu và chống hiện lặp. ID đã hiện lưu ở sessionStorage — refresh trang
// không hiện lại tin cũ.
// ============================================================

const SEEN_KEY = "dsh-notification-toast-seen";

/** Giữ đúng biểu tượng theo loại thông báo như trước. */
const ICON: Record<NotificationItem["type"], string> = {
  ACTIVITY: "📝",
  ADMIN: "🛡️",
  SYSTEM: "⚙️",
};

const KIND: Record<NotificationItem["type"], "ok" | "error" | "info"> = {
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
  const { items } = useNotifications();
  const seenRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!seenRef.current) seenRef.current = loadSeen();
    const seen = seenRef.current;

    // Giữ limit=5 cũ: chỉ xét 5 tin mới nhất, bỏ tin đã đọc/đã hiện.
    for (const n of items.slice(0, 5)) {
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
    if (items.length > 0) saveSeen(seen);
  }, [items]);

  return null;
}
