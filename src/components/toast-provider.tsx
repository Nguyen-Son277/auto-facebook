"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { markReadAction } from "@/app/actions/notifications";

// ============================================================
// TOAST DÙNG CHUNG — một chồng popup ở góc dưới phải cho MỌI nguồn.
//
// Trước đây chỉ có NotificationToast (poll DB) tự render. Nay tách làm ba:
//   - pushToast(): store nhỏ ở module, gọi được từ bất kỳ client component
//   - <ToastHost />: chỉ lo hiển thị
//   - NotificationToast: producer, poll DB rồi pushToast
//
// Nhờ vậy kết quả thao tác (bật/tắt tự động, lên kế hoạch ngay…) và thông báo
// hệ thống dùng CHUNG một chỗ hiển thị, không còn khối chữ inline chiếm chỗ
// trên trang.
// ============================================================

export type ToastKind = "ok" | "error" | "info";

export type ToastInput = {
  kind?: ToastKind;
  title: string;
  body?: string | null;
  /** URL nội bộ, bấm toast sẽ điều hướng tới. */
  link?: string | null;
  /** Có thì bấm toast sẽ đánh dấu thông báo này là đã đọc. */
  notificationId?: string;
  /** Gắn vào data-testid của thẻ toast — giữ selector cho test E2E hiện có. */
  testId?: string;
  /** Ghi đè biểu tượng mặc định của `kind` (thông báo dùng icon riêng). */
  icon?: string;
};

type ToastItem = ToastInput & { key: string };

const AUTO_HIDE_MS = 7_000;
const MAX_VISIBLE = 3;
const EMPTY: ToastItem[] = [];

const ICON: Record<ToastKind, string> = { ok: "✅", error: "⚠️", info: "ℹ️" };
const ICON_BG: Record<ToastKind, string> = {
  ok: "bg-emerald-100",
  error: "bg-red-100",
  info: "bg-blue-100",
};

let items: ToastItem[] = EMPTY;
const listeners = new Set<() => void>();
let seq = 0;

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return items;
}

function getServerSnapshot() {
  return EMPTY;
}

/** Bỏ một toast theo khoá nội bộ. */
export function dismissToast(key: string) {
  const next = items.filter((t) => t.key !== key);
  if (next.length === items.length) return;
  items = next;
  emit();
}

/** Đẩy một toast lên góc dưới phải. Gọi được từ bất kỳ client component nào. */
export function pushToast(input: ToastInput): string {
  const key = `toast-${Date.now()}-${seq++}`;
  items = [...items, { ...input, key }].slice(-MAX_VISIBLE);
  emit();
  setTimeout(() => dismissToast(key), AUTO_HIDE_MS);
  return key;
}

/** Hook tiện dụng — trả về chính `pushToast`. */
export function useToast() {
  return pushToast;
}

/** Nơi duy nhất render toast. Đặt một lần trong layout dashboard. */
export function ToastHost() {
  const router = useRouter();
  const list = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const open = useCallback(
    (t: ToastItem) => {
      if (t.notificationId) void markReadAction([t.notificationId]);
      dismissToast(t.key);
      if (t.link) router.push(t.link);
    },
    [router]
  );

  if (list.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[60] flex w-80 max-w-[90vw] flex-col gap-2"
      data-testid="notification-toast"
    >
      {list.map((t) => {
        const kind = t.kind ?? "info";
        return (
          <div
            key={t.key}
            role="alert"
            data-testid={t.testId ?? "toast-item"}
            className="pointer-events-auto overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl"
          >
            <div className="flex items-start gap-3 px-4 py-3">
              <span
                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base ${ICON_BG[kind]}`}
              >
                {t.icon ?? ICON[kind]}
              </span>
              <button
                type="button"
                onClick={() => open(t)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate text-sm font-semibold text-gray-900">{t.title}</p>
                {t.body ? (
                  <p className="mt-0.5 line-clamp-2 text-xs text-gray-600">{t.body}</p>
                ) : null}
              </button>
              <button
                type="button"
                aria-label="Đóng thông báo"
                onClick={() => dismissToast(t.key)}
                className="shrink-0 rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            {/* Thanh đếm thời gian tự ẩn */}
            <div
              className="h-0.5 w-full bg-blue-600"
              style={{ animation: `toast-life ${AUTO_HIDE_MS}ms linear forwards` }}
            />
          </div>
        );
      })}
      <style>{`@keyframes toast-life { from { width: 100% } to { width: 0% } }`}</style>
    </div>
  );
}
