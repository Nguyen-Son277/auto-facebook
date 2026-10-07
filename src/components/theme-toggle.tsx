"use client";

import { useSyncExternalStore } from "react";
import { toggleTheme } from "@/lib/theme";

// ============================================================
// Nút chuyển nhanh Sáng ⇄ Tối ở topbar.
//
// Trạng thái đọc qua useSyncExternalStore + MutationObserver trên <html>:
// - không cần setState trong useEffect (tránh render cascade),
// - tự cập nhật khi đổi theme ở trang Cài đặt hoặc ở tab khác.
// ============================================================

const EMPTY = () => () => {};

function subscribe(onChange: () => void) {
  if (typeof document === "undefined") return EMPTY();
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function readDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

function readDarkServer(): boolean {
  return false;
}

export default function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, readDark, readDarkServer);

  return (
    <button
      type="button"
      onClick={() => toggleTheme()}
      aria-label={dark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"}
      title={dark ? "Giao diện sáng" : "Giao diện tối"}
      data-testid="theme-toggle"
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-surface text-base transition hover:border-gray-300 hover:bg-gray-50"
    >
      <span aria-hidden>{dark ? "☀️" : "🌙"}</span>
    </button>
  );
}
