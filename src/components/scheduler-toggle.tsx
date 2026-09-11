"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runSchedulerNowAction, toggleSchedulerAction } from "@/app/actions/schedule";

/**
 * Nút bật/tắt tự động đăng + nút chạy ngay.
 *
 * Vòng lặp scheduler chạy trong chính tiến trình server web (src/instrumentation.ts),
 * nên người dùng điều khiển được hoàn toàn từ giao diện — không cần terminal.
 */
export default function SchedulerToggle({
  enabled,
  size = "md",
}: {
  enabled: boolean;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [optimistic, setOptimistic] = useState(enabled);

  function onToggle() {
    const next = !optimistic;
    setOptimistic(next); // phản hồi ngay, không chờ server
    setNotice(null);
    startTransition(async () => {
      const res = await toggleSchedulerAction(next);
      if (!res.ok) {
        setOptimistic(!next); // hoàn tác nếu lỗi
        setNotice({ ok: false, text: res.error ?? "Không đổi được trạng thái." });
      } else {
        setNotice({ ok: true, text: res.message ?? "Đã cập nhật." });
      }
      router.refresh();
    });
  }

  function onRunNow() {
    setNotice(null);
    startTransition(async () => {
      const res = await runSchedulerNowAction();
      setNotice(
        res.ok
          ? { ok: true, text: res.message ?? "Đã chạy." }
          : { ok: false, text: res.error ?? "Chạy thất bại." }
      );
      router.refresh();
    });
  }

  const btn =
    size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          disabled={pending}
          data-testid="scheduler-toggle"
          data-enabled={optimistic ? "1" : "0"}
          aria-pressed={optimistic}
          className={`rounded-lg font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${btn} ${
            optimistic
              ? "bg-amber-600 hover:bg-amber-700"
              : "bg-emerald-600 hover:bg-emerald-700"
          }`}
        >
          {pending
            ? "Đang xử lý…"
            : optimistic
              ? "⏸ Tắt tự động đăng"
              : "▶ Bật tự động đăng"}
        </button>

        <button
          type="button"
          onClick={onRunNow}
          disabled={pending || !optimistic}
          data-testid="scheduler-run-now"
          title={optimistic ? "Chạy một vòng ngay" : "Bật tự động đăng trước"}
          className={`rounded-lg border border-gray-300 bg-white font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 ${btn}`}
        >
          {pending ? "…" : "🔄 Chạy ngay"}
        </button>
      </div>

      {notice && (
        <p
          data-testid="scheduler-toggle-notice"
          className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
            notice.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
          }`}
        >
          {notice.ok ? "✅" : "⚠"} {notice.text}
        </p>
      )}
    </div>
  );
}
