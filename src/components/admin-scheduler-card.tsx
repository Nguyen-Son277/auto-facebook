import { getSchedulerStatus } from "@/lib/scheduler";
import { prisma } from "@/lib/prisma";
import SchedulerToggle from "@/components/scheduler-toggle";

/**
 * Bảng điều khiển "Tự động đăng bài" dành RIÊNG cho admin.
 *
 * Trước đây nằm ở /settings và mọi user đều thấy — nhưng đây là công tắc
 * cấp hệ thống (một vòng lặp cho tất cả mọi người) nên chuyển về
 * trang Quản trị. Server action phía sau cũng chặn role != ADMIN.
 */
export default async function AdminSchedulerCard({ userId }: { userId: string }) {
  const scheduler = await getSchedulerStatus(userId);
  // Đếm TOÀN HỆ THỐNG (không chỉ bài của admin) — admin cần thấy tổng tải
  const [pending, awaitingRetry] = await Promise.all([
    prisma.post.count({ where: { status: "SCHEDULED" } }),
    prisma.post.count({ where: { status: "SCHEDULED", nextAttemptAt: { not: null } } }),
  ]);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-1 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-xl">
          ⏰
        </span>
        <div>
          <h2 className="font-semibold text-gray-900">Tự động đăng bài (toàn hệ thống)</h2>
          <p className="text-xs text-gray-500">
            Công tắc cấp hệ thống — tắt là bài hẹn giờ của MỌI user đều nằm chờ
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            data-testid="settings-scheduler-state"
            className={`rounded-full px-3 py-1 font-semibold ${
              !scheduler.enabled
                ? "bg-gray-200 text-gray-700"
                : scheduler.workerAlive
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-amber-100 text-amber-800"
            }`}
          >
            {!scheduler.enabled
              ? "⏸ Đang tắt"
              : scheduler.workerAlive
                ? "🟢 Đang chạy"
                : "⚪ Chờ nhịp đầu tiên"}
          </span>
          {pending > 0 && (
            <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">
              ⏳ {pending} bài đang chờ đăng (mọi user)
            </span>
          )}
          {awaitingRetry > 0 && (
            <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">
              🔁 {awaitingRetry} bài chờ thử lại
            </span>
          )}
        </div>

        <SchedulerToggle enabled={scheduler.enabled} />

        <p className="text-xs text-gray-500">
          Khi tắt, bài đã hẹn giờ vẫn được giữ nguyên và sẽ đăng ngay khi bật lại
          (nếu đã quá giờ hẹn). User thường không nhìn thấy khu vực này.
        </p>
      </div>
    </section>
  );
}
