// ============================================================
// Áp dụng theme NGAY trên client (không cần reload).
//
// Dùng chung cho trang Cài đặt (ThemeSelector) và nút chuyển nhanh
// Sáng/Tối ở topbar — cả hai đều: đổi class .dark → ghi cookie +
// localStorage → gọi server action lưu theo tài khoản.
// ============================================================

import { setThemePreference, type ThemePreference } from "@/app/actions/settings";

export function isDarkNow(): boolean {
  return document.documentElement.classList.contains("dark");
}

export function applyTheme(pref: ThemePreference) {
  const html = document.documentElement;
  html.classList.add("theme-anim");
  const dark =
    pref === "dark" ||
    (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  html.classList.toggle("dark", dark);
  html.dataset.themePref = pref;
  // Cookie để lần tải trang kế tiếp không nhấp nháy (script no-flash ở root layout)
  document.cookie = `theme=${pref}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  localStorage.setItem("theme", pref);
  window.setTimeout(() => html.classList.remove("theme-anim"), 300);
  return dark;
}

/** Chuyển nhanh Sáng ⇄ Tối (nút ở topbar) — lưu cả theo tài khoản. */
export function toggleTheme(): { next: ThemePreference; dark: boolean } {
  const next: ThemePreference = isDarkNow() ? "light" : "dark";
  const dark = applyTheme(next);
  void setThemePreference(next);
  return { next, dark };
}
