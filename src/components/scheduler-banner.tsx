import Link from "next/link";
import type { SchedulerStatus } from "@/lib/scheduler";
import SchedulerToggle from "@/components/scheduler-toggle";

/**
 * Banner trạng thái tự động đăng bài.
 *
 * Mục đích: người dùng phải biết ngay tính năng này đang bật hay tắt — nếu tắt
 * (hoặc vòng lặp chết) thì bài hẹn giờ sẽ KHÔNG bao giờ được đăng, và đó là
 * kiểu lỗi im lặng rất dễ khiến người dùng mất niềm tin vào tính năng hẹn giờ.
 */

function formatTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}`;
}

/** Mô tả vòng lặp đang chạy ở đâu. */
function sourceLabel(source: SchedulerStatus["source"]): string {
  switch (source) {
    case "server":
      return "chạy trong app";
    case "worker":
      return "do worker bên ngoài";
    case "cron":
      return "do cron bên ngoài";
    case "manual":
      return "chạy thủ công";
    default:
      return "";
  }
}

export default function SchedulerBanner({
  status,
  canManage = false,
}: {
  status: SchedulerStatus;
  /** Chỉ ADMIN được nhìn thấy và bấm công tắc. */
  canManage?: boolean;
}) {
  const neverRan = !status.lastRunAt;
  const minutes = status.minutesSinceLastRun;

  // Đang bật, chưa chạy nhịp nào mà cũng không có bài nào chờ → không cần làm phiền
  if (status.enabled && neverRan && status.pending === 0 && status.awaitingRetry === 0) {
    return null;
  }

  const active = status.enabled && status.workerAlive;

  const tone = !status.enabled
    ? "border-gray-300 bg-gray-50"
    : active
      ? "border-emerald-200 bg-emerald-50"
      : "border-amber-200 bg-amber-50";
  const dot = !status.enabled ? "bg-gray-400" : active ? "bg-emerald-500" : "bg-amber-500";

  const agoText =
    minutes === null
      ? ""
      : minutes === 0
        ? "vừa xong"
        : minutes >= 60
          ? `${Math.floor(minutes / 60)} giờ trước`
          : `${minutes} phút trước`;

  return (
    <div data-testid="scheduler-banner" className={`mt-6 rounded-2xl border p-4 ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
          <div>
            <p className="text-sm font-semibold text-gray-900" data-testid="scheduler-state">
              {!status.enabled
                ? "Tự động đăng bài đang TẮT"
                : active
                  ? "Tự động đăng bài đang hoạt động"
                  : "Tự động đăng bài chưa chạy nhịp nào"}
            </p>
            <p className="mt-0.5 text-xs text-gray-600">
              {!status.enabled ? (
                <>
                  {canManage
                    ? <>Bài hẹn giờ sẽ nằm chờ và <strong>không</strong> được đăng cho tới khi bạn bật lại.</>
                    : <>Quản trị viên đang tạm ngưng đăng tự động — bài hẹn giờ sẽ nằm chờ và được đăng ngay khi bật lại.</>}
                </>
              ) : active ? (
                <>
                  Vòng lặp kiểm tra mỗi phút {sourceLabel(status.source)}
                  {agoText && ` · lần cuối ${agoText}`}.
                </>
              ) : (
                <>
                  Chưa thấy nhịp nào{agoText && ` (lần cuối ${agoText})`}. Nếu tình trạng này kéo
                  dài, xem log của server để biết vì sao vòng lặp không chạy.
                </>
              )}
              {status.pending > 0 && ` Đang chờ đăng: ${status.pending} bài.`}
              {status.awaitingRetry > 0 && ` Chờ thử lại: ${status.awaitingRetry} bài.`}
              {status.nextScheduledAt && ` Bài gần nhất: ${formatTime(status.nextScheduledAt)}.`}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-start gap-2">
          {canManage && <SchedulerToggle enabled={status.enabled} />}
          <Link href="/calendar" className="text-xs font-medium text-blue-600 hover:underline">
            📅 Xem lịch đăng →
          </Link>
        </div>
      </div>
    </div>
  );
}
