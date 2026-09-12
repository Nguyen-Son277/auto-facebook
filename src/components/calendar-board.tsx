"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  cancelScheduleAction,
  deleteScheduledPostAction,
  publishScheduledNowAction,
  reschedulePostAction,
} from "@/app/actions/schedule";

export type CalendarPost = {
  id: string;
  content: string;
  status: string;
  /** Thời điểm đặt bài lên lịch (hẹn hoặc đã đăng). */
  at: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  pageName: string | null;
  mediaCount: number;
  errorMessage: string | null;
  attempts: number;
  fbPostId: string | null;
  /** MANUAL = bạn soạn tay; AUTOPILOT = hệ thống tự viết. */
  origin: string;
  /** Trụ cột nội dung (chỉ có với bài tự động). */
  pillarName: string | null;
};

type SchedulerInfo = {
  lastRunAt: string | null;
  pending: number;
  awaitingRetry: number;
  nextScheduledAt: string | null;
  /** Tính sẵn ở server — xem getSchedulerStatus() trong lib/scheduler.ts */
  workerAlive: boolean;
  minutesSinceLastRun: number | null;
  enabled: boolean;
  source: "server" | "worker" | "cron" | "manual" | null;
};

const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

const STATUS_STYLE: Record<string, { label: string; chip: string; dot: string }> = {
  PENDING_REVIEW: {
    label: "Chờ duyệt",
    chip: "bg-purple-100 text-purple-800",
    dot: "bg-purple-500",
  },
  SCHEDULED: { label: "Đã hẹn", chip: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  PUBLISHING: { label: "Đang đăng", chip: "bg-blue-100 text-blue-800", dot: "bg-blue-500" },
  PUBLISHED: { label: "Đã đăng", chip: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
  FAILED: { label: "Lỗi", chip: "bg-red-100 text-red-800", dot: "bg-red-500" },
};

function styleOf(status: string) {
  return STATUS_STYLE[status] ?? { label: status, chip: "bg-gray-100 text-gray-700", dot: "bg-gray-400" };
}

/** Khóa ngày theo giờ địa phương: "YYYY-MM-DD". */
function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function dateTimeLabel(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())} ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function toLocalInputValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(
    d.getMinutes()
  )}`;
}

export default function CalendarBoard({
  year,
  month,
  posts,
  scheduler,
  hasActivePage,
}: {
  year: number;
  month: number;
  posts: CalendarPost[];
  scheduler: SchedulerInfo;
  hasActivePage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [rescheduleValue, setRescheduleValue] = useState("");

  const todayKey = dayKey(new Date());

  // ---- Dựng lưới tháng (tuần bắt đầu Thứ Hai) ----
  const firstOfMonth = new Date(year, month - 1, 1);
  // getDay(): 0=CN. Đổi sang chỉ số tuần bắt đầu Thứ Hai: T2=0 … CN=6
  const leading = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();

  const cells: { key: string; date: Date; inMonth: boolean }[] = [];
  for (let i = 0; i < leading; i++) {
    const d = new Date(year, month - 1, 1 - (leading - i));
    cells.push({ key: dayKey(d), date: d, inMonth: false });
  }
  for (let i = 1; i <= daysInMonth; i++) {
    const d = new Date(year, month - 1, i);
    cells.push({ key: dayKey(d), date: d, inMonth: true });
  }
  // Lấp cho đủ số hàng tuần
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    const d = new Date(last);
    d.setDate(d.getDate() + 1);
    cells.push({ key: dayKey(d), date: d, inMonth: false });
  }

  const byDay = new Map<string, CalendarPost[]>();
  for (const p of posts) {
    const k = dayKey(new Date(p.at));
    const list = byDay.get(k) ?? [];
    list.push(p);
    byDay.set(k, list);
  }

  function monthHref(offset: number): string {
    const d = new Date(year, month - 1 + offset, 1);
    return `/calendar?month=${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  const monthLabel = `Tháng ${month}/${year}`;
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const thisMonthHref = `/calendar?month=${currentMonthKey}`;

  const selectedPosts = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  // Nhịp tim đã được tính ở server, component chỉ hiển thị
  const mins = scheduler.minutesSinceLastRun;
  const ago =
    mins === null
      ? ""
      : mins === 0
        ? "vừa xong"
        : mins >= 60
          ? `${Math.floor(mins / 60)} giờ trước`
          : `${mins} phút trước`;

  const where =
    scheduler.source === "server"
      ? "trong app"
      : scheduler.source === "worker"
        ? "worker ngoài"
        : scheduler.source === "cron"
          ? "cron ngoài"
          : "thủ công";

  const health = {
    alive: scheduler.enabled && scheduler.workerAlive,
    text: !scheduler.enabled
      ? "TẮT — bài hẹn giờ sẽ không tự đăng"
      : !scheduler.lastRunAt
        ? "đang bật · chờ nhịp đầu tiên"
        : scheduler.workerAlive
          ? `đang chạy ${where} · lần cuối ${ago}`
          : `chưa thấy nhịp nào · lần cuối ${ago}`,
    cls: !scheduler.enabled
      ? "bg-gray-200 text-gray-700"
      : scheduler.workerAlive
        ? "bg-emerald-100 text-emerald-800"
        : "bg-amber-100 text-amber-800",
  };

  function run(action: () => Promise<{ ok: boolean; message?: string; error?: string }>, id: string) {
    setBusyId(id);
    setNotice(null);
    startTransition(async () => {
      const res = await action();
      setBusyId(null);
      setNotice(
        res.ok
          ? { ok: true, text: res.message ?? "Thành công." }
          : { ok: false, text: res.error ?? "Thao tác thất bại." }
      );
      setRescheduleId(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* ================= Trạng thái worker ================= */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span
              data-testid="worker-status"
              data-enabled={scheduler.enabled ? "1" : "0"}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${health.cls}`}
            >
              {health.alive ? "🟢" : scheduler.enabled ? "⚪" : "⏸"} Tự động đăng:{" "}
              {health.text}
            </span>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">
              ⏳ Chờ đăng: <strong>{scheduler.pending}</strong>
            </span>
            {scheduler.awaitingRetry > 0 && (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs text-amber-800">
                🔁 Chờ thử lại: <strong>{scheduler.awaitingRetry}</strong>
              </span>
            )}
            {scheduler.nextScheduledAt && (
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-800">
                ⏰ Bài gần nhất: {dateTimeLabel(scheduler.nextScheduledAt)}
              </span>
            )}
          </div>
        </div>

        {!hasActivePage && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            ⚠ Chưa có Facebook Page nào đang hoạt động — bài hẹn giờ sẽ không đăng được.
            Vào <Link href="/pages" className="underline">Facebook Pages</Link> để bật một Page.
          </p>
        )}
      </div>

      {notice && (
        <p
          data-testid="calendar-notice"
          className={`rounded-lg px-3 py-2 text-sm font-medium ${
            notice.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
          }`}
        >
          {notice.ok ? "✅" : "⚠"} {notice.text}
        </p>
      )}

      {/* ================= Lưới tháng ================= */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Link
              href={monthHref(-1)}
              data-testid="calendar-prev"
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50"
            >
              ←
            </Link>
            <h2 data-testid="calendar-month" className="min-w-40 text-center text-lg font-bold text-gray-900">
              {monthLabel}
            </h2>
            <Link
              href={monthHref(1)}
              data-testid="calendar-next"
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50"
            >
              →
            </Link>
            <Link
              href={thisMonthHref}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
            >
              Tháng này
            </Link>
          </div>
          <Link
            href="/composer"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            ✍️ Hẹn bài mới
          </Link>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-gray-500">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-1">
              {w}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {cells.map((cell) => {
            const list = byDay.get(cell.key) ?? [];
            const isToday = cell.key === todayKey;
            const isSelected = cell.key === selectedDay;
            return (
              <button
                key={cell.key}
                type="button"
                onClick={() => setSelectedDay(isSelected ? null : cell.key)}
                data-testid="calendar-day"
                data-day={cell.key}
                data-count={list.length}
                className={`min-h-24 rounded-lg border p-1.5 text-left align-top transition ${
                  isSelected
                    ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                    : isToday
                      ? "border-blue-300 bg-blue-50/40"
                      : "border-gray-200 hover:bg-gray-50"
                } ${cell.inMonth ? "" : "opacity-45"}`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-xs font-semibold ${
                      isToday ? "rounded-full bg-blue-600 px-1.5 text-white" : "text-gray-700"
                    }`}
                  >
                    {cell.date.getDate()}
                  </span>
                  {list.length > 0 && (
                    <span className="text-[10px] font-semibold text-gray-400">{list.length}</span>
                  )}
                </div>
                <div className="mt-1 space-y-0.5">
                  {list.slice(0, 2).map((p) => {
                    const st = styleOf(p.status);
                    return (
                      <div
                        key={p.id}
                        className={`flex items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] ${st.chip}`}
                      >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${st.dot}`} />
                        <span className="shrink-0 font-medium">{timeLabel(p.at)}</span>
                        <span className="truncate">{p.content.slice(0, 24)}</span>
                      </div>
                    );
                  })}
                  {list.length > 2 && (
                    <div className="px-1 text-[10px] text-gray-400">+{list.length - 2} bài khác</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ================= Chi tiết ngày được chọn ================= */}
      {selectedDay && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4" data-testid="calendar-detail">
          <h3 className="mb-3 font-semibold text-gray-900">
            Bài trong ngày {selectedDay.split("-").reverse().join("/")}
            <span className="ml-2 text-sm font-normal text-gray-500">
              ({selectedPosts.length} bài)
            </span>
          </h3>

          {selectedPosts.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-300 px-3 py-6 text-center text-sm text-gray-400">
              Ngày này chưa có bài nào. Bấm &quot;Hẹn bài mới&quot; để tạo.
            </p>
          ) : (
            <ul className="space-y-3">
              {selectedPosts.map((p) => {
                const st = styleOf(p.status);
                const busy = busyId === p.id && pending;
                return (
                  <li
                    key={p.id}
                    data-testid="calendar-post"
                    data-status={p.status}
                    className="rounded-xl border border-gray-200 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${st.chip}`}>
                        {st.label}
                      </span>
                      <span className="text-xs font-medium text-gray-700">
                        {p.scheduledAt
                          ? `Hẹn ${timeLabel(p.scheduledAt)}`
                          : p.publishedAt
                            ? `Đăng ${timeLabel(p.publishedAt)}`
                            : ""}
                      </span>
                      {p.pageName && (
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
                          📄 {p.pageName}
                        </span>
                      )}
                      {p.mediaCount > 0 && (
                        <span className="rounded bg-cyan-50 px-2 py-0.5 text-[11px] text-cyan-700">
                          🖼️ {p.mediaCount}
                        </span>
                      )}
                      {p.origin === "AUTOPILOT" && (
                        <span
                          data-testid="calendar-autopilot"
                          className="rounded bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700"
                          title="Bài do chế độ tự động viết"
                        >
                          🤖 {p.pillarName ?? "Tự động"}
                        </span>
                      )}
                      {p.attempts > 0 && p.status !== "PUBLISHED" && (
                        <span className="rounded bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                          đã thử {p.attempts} lần
                        </span>
                      )}
                    </div>

                    <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-gray-800">
                      {p.content}
                    </p>

                    {p.status === "FAILED" && p.errorMessage && (
                      <p
                        data-testid="calendar-error"
                        className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700"
                      >
                        ⚠ {p.errorMessage}
                      </p>
                    )}

                    {/* Đổi lịch */}
                    {rescheduleId === p.id ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <input
                          type="datetime-local"
                          value={rescheduleValue}
                          onChange={(e) => setRescheduleValue(e.target.value)}
                          data-testid="reschedule-input"
                          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                        />
                        <button
                          type="button"
                          disabled={busy || !rescheduleValue}
                          data-testid="reschedule-save"
                          onClick={() => run(() => reschedulePostAction(p.id, rescheduleValue), p.id)}
                          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                        >
                          {busy ? "Đang lưu…" : "Lưu lịch mới"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setRescheduleId(null)}
                          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-600"
                        >
                          Hủy
                        </button>
                      </div>
                    ) : (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Link
                          href={`/posts/${p.id}`}
                          data-testid="calendar-detail-link"
                          className="rounded-lg border border-blue-300 px-3 py-1.5 text-xs font-medium text-blue-700 transition hover:bg-blue-50"
                        >
                          ✏️ Xem & sửa
                        </Link>
                        {p.status === "PENDING_REVIEW" && (
                          <Link
                            href="/autopilot"
                            data-testid="calendar-review-link"
                            className="rounded-lg border border-purple-300 px-3 py-1.5 text-xs font-medium text-purple-700 transition hover:bg-purple-50"
                          >
                            ✓ Duyệt ở trang Tự động đăng
                          </Link>
                        )}
                        {p.status === "SCHEDULED" && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              data-testid="calendar-reschedule"
                              onClick={() => {
                                setRescheduleId(p.id);
                                const base = p.scheduledAt ? new Date(p.scheduledAt) : new Date();
                                setRescheduleValue(toLocalInputValue(base));
                              }}
                              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
                            >
                              🕘 Đổi lịch
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              data-testid="calendar-publish-now"
                              onClick={() => run(() => publishScheduledNowAction(p.id), p.id)}
                              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                            >
                              {busy ? "Đang đăng…" : "🚀 Đăng ngay"}
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              data-testid="calendar-cancel"
                              onClick={() => run(() => cancelScheduleAction(p.id), p.id)}
                              className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-50 disabled:opacity-60"
                            >
                              ⏸ Hủy lịch
                            </button>
                          </>
                        )}
                        {p.status === "PUBLISHED" && p.fbPostId && (
                          <a
                            href={`https://www.facebook.com/${p.fbPostId.replace("_", "/posts/")}`}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
                          >
                            🔗 Xem trên Facebook
                          </a>
                        )}
                        {p.status !== "PUBLISHED" && (
                          <button
                            type="button"
                            disabled={busy}
                            data-testid="calendar-delete"
                            onClick={() => {
                              if (window.confirm("Xóa bài này? Hành động không thể hoàn tác.")) {
                                run(() => deleteScheduledPostAction(p.id), p.id);
                              }
                            }}
                            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-60"
                          >
                            🗑️ Xóa
                          </button>
                        )}
                        <Link
                          href="/history"
                          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
                        >
                          Xem lịch sử
                        </Link>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Chú thích màu */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
        <span className="font-semibold">Chú thích:</span>
        {Object.entries(STATUS_STYLE).map(([key, st]) => (
          <span key={key} className="flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${st.dot}`} />
            {st.label}
          </span>
        ))}
      </div>
    </div>
  );
}
