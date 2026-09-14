"use client";

import Link from "next/link";
import { useTransition } from "react";
import { toggleAllAutoPilots, toggleAutoPilot, type AutoPilotState } from "@/app/actions/autopilot";
import type { AutoPilotConfigRow } from "@/lib/autopilot";
import { pushToast } from "@/components/toast-provider";

const DAYS_SHORT = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

function daysLabel(daysOfWeek: string): string {
  const days = daysOfWeek.split(",").map((d) => Number(d)).filter((d) => d >= 0 && d <= 6);
  if (days.length === 7) return "Mỗi ngày";
  if (days.length === 0) return "—";
  return days.map((d) => DAYS_SHORT[d]).join(" ");
}

// ============================================================
// Bảng mọi cấu hình tự động — mỗi Page một dòng.
// Nút bật/tắt từng dòng + bulk "tất cả". Link sang chi tiết ?page=.
// ============================================================

export default function AutopilotListClient({
  configs,
}: {
  configs: AutoPilotConfigRow[];
}) {
  const [pending, startTransition] = useTransition();

  // Kết quả thao tác đi thẳng ra toast — trang không còn khối chữ inline.
  const run = (fn: () => Promise<AutoPilotState>) => {
    startTransition(async () => {
      const res = await fn();
      if (!res || (!res.ok && !res.error)) return;
      pushToast({
        kind: res.error ? "error" : "ok",
        title: res.error ?? res.message ?? "Đã xong.",
        testId: "ap-list-alert",
      });
    });
  };

  return (
    <div className="space-y-4">

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm" data-testid="ap-config-table">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3">Page</th>
              <th className="px-4 py-3">Thương hiệu</th>
              <th className="px-4 py-3">Trạng thái</th>
              <th className="px-4 py-3">Chế độ</th>
              <th className="px-4 py-3">Nhịp đăng</th>
              <th className="px-4 py-3">7 ngày tới</th>
              <th className="px-4 py-3 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {configs.map((c) => (
              <tr key={c.pageId} className="border-b border-gray-100 last:border-0" data-testid="ap-config-row">
                <td className="px-4 py-3">
                  <span className="font-medium text-gray-900">{c.pageName}</span>
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {c.brandName ?? (
                    <Link
                      href="/pages"
                      className="text-amber-700 underline decoration-dotted hover:text-amber-800"
                      data-testid="ap-brand-missing"
                      title="Page chưa gắn thương hiệu — bấm để gán ở trang Pages"
                    >
                      ⚠ chưa gán
                    </Link>
                  )}
                </td>
                <td className="px-4 py-3">
                  {c.lastPlanError ? (
                    <span
                      className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700"
                      title={c.lastPlanError}
                    >
                      ⚠ Lỗi
                    </span>
                  ) : c.enabled ? (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                      🟢 Đang chạy
                    </span>
                  ) : (
                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                      ⏸ Tắt
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {c.mode === "AUTO" ? (
                    <span className="text-gray-700">Tự đăng</span>
                  ) : (
                    <span className="text-gray-700">Chờ duyệt</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {c.hasConfig ? (
                    <>
                      {c.postsPerDay} bài/ngày · {c.windowStart}–{c.windowEnd}
                      <div className="text-xs text-gray-400">{daysLabel(c.daysOfWeek)}</div>
                    </>
                  ) : (
                    <span className="text-gray-400">chưa cấu hình</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600">{c.plannedNext7Days} bài</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Link
                      href={`/autopilot?page=${c.pageId}`}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                      data-testid="ap-config-open"
                    >
                      {c.hasConfig ? "Cấu hình" : "Thiết lập"}
                    </Link>
                    {c.hasConfig ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(() => toggleAutoPilot(c.pageId, !c.enabled))}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:opacity-60 ${
                          c.enabled
                            ? "border-gray-300 text-gray-700 hover:bg-gray-50"
                            : "border-emerald-500 text-emerald-700 hover:bg-emerald-50"
                        }`}
                        data-testid="ap-toggle"
                      >
                        {c.enabled ? "Tắt" : "Bật"}
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ===== Bulk ===== */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-4">
        <span className="text-sm font-medium text-gray-700">Tất cả cấu hình:</span>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => toggleAllAutoPilots(true))}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
          data-testid="ap-enable-all"
        >
          Bật tất cả
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => toggleAllAutoPilots(false))}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
          data-testid="ap-disable-all"
        >
          Tắt tất cả
        </button>
        {pending ? <span className="text-xs text-gray-500">Đang xử lý…</span> : null}
      </div>

      <p className="text-sm text-gray-500">
        Chưa gán thương hiệu cho Page nào? Vào{" "}
        <Link href="/pages" className="font-medium text-blue-600 hover:underline">
          trang Pages
        </Link>{" "}
        để gán — trụ cột nội dung và hồ sơ thương hiệu áp dụng cho mọi Page của cùng một thương hiệu.
      </p>
    </div>
  );
}
