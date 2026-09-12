"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setThemePreference, type ThemePreference } from "@/app/actions/settings";

// ============================================================
// Chọn theme Sáng / Tối / Theo hệ thống.
//
// Bấm: áp ngay (toggle class .dark + ghi localStorage) → gọi server
// action lưu UserSetting + cookie (script no-flash ở root layout dùng
// cho lần tải trang kế tiếp). Thêm .theme-anim tạm để chuyển màu mượt.
// ============================================================

const OPTIONS: { value: ThemePreference; label: string; icon: string; desc: string }[] = [
  { value: "light", label: "Sáng", icon: "☀️", desc: "Nền trắng, chữ đậm" },
  { value: "dark", label: "Tối", icon: "🌙", desc: "Nền xanh than, dịu mắt" },
  { value: "system", label: "Hệ thống", icon: "💻", desc: "Theo máy của bạn" },
];

function applyTheme(pref: ThemePreference) {
  const html = document.documentElement;
  html.classList.add("theme-anim");
  const dark =
    pref === "dark" ||
    (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  html.classList.toggle("dark", dark);
  html.dataset.themePref = pref;
  localStorage.setItem("theme", pref);
  window.setTimeout(() => html.classList.remove("theme-anim"), 300);
}

export default function ThemeSelector({ current }: { current: ThemePreference }) {
  const router = useRouter();
  const [selected, setSelected] = useState<ThemePreference>(current);
  const [pending, startTransition] = useTransition();

  function choose(pref: ThemePreference) {
    setSelected(pref);
    applyTheme(pref);
    startTransition(async () => {
      await setThemePreference(pref);
      router.refresh();
    });
  }

  return (
    <div className="grid grid-cols-3 gap-2" data-testid="theme-selector">
      {OPTIONS.map((opt) => {
        const active = selected === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={pending}
            onClick={() => choose(opt.value)}
            data-testid={`theme-${opt.value}`}
            aria-pressed={active}
            className={`flex flex-col items-center gap-1 rounded-xl border px-3 py-3 text-center transition disabled:opacity-60 ${
              active
                ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
            }`}
          >
            <span className="text-2xl" aria-hidden>
              {opt.icon}
            </span>
            <span className="text-sm font-semibold text-gray-900">{opt.label}</span>
            <span className="text-[11px] leading-tight text-gray-500">{opt.desc}</span>
            {active && (
              <span className="text-[10px] font-semibold text-blue-600">Đang dùng</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
