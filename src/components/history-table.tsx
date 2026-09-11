"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { deleteHistoryPost, retryPostAction } from "@/app/actions/history";

export type HistoryRow = {
  id: string;
  content: string;
  hashtags: string | null;
  status: string;
  statusLabel: string;
  statusCls: string;
  pageName: string | null;
  fbPostId: string | null;
  errorMessage: string | null;
  createdAt: string;
  publishedAt: string | null;
  mediaCount: number;
};

/** Định dạng thời gian kiểu Việt Nam, ổn định giữa server và client. */
function formatTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}`;
}

function permalinkOf(fbPostId: string) {
  return `https://www.facebook.com/${fbPostId.replace("_", "/posts/")}`;
}

export default function HistoryTable({
  rows,
  query,
}: {
  rows: HistoryRow[];
  query: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  function onRetry(id: string) {
    setBusyId(id);
    setNotice(null);
    startTransition(async () => {
      const res = await retryPostAction(id);
      setBusyId(null);
      setNotice(
        res.ok
          ? { ok: true, text: res.message ?? "Đăng lại thành công!" }
          : { ok: false, text: res.error ?? "Đăng lại thất bại." }
      );
      router.refresh();
    });
  }

  function onDelete(id: string) {
    if (!window.confirm("Xóa bài này khỏi lịch sử? Hành động không thể hoàn tác.")) return;
    setBusyId(id);
    setNotice(null);
    startTransition(async () => {
      const res = await deleteHistoryPost(id);
      setBusyId(null);
      setNotice(
        res.ok
          ? { ok: true, text: res.message ?? "Đã xóa." }
          : { ok: false, text: res.error ?? "Xóa thất bại." }
      );
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <div
        data-testid="history-empty"
        className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-12 text-center"
      >
        <p className="text-sm font-medium text-gray-700">
          {query ? `Không tìm thấy bài nào chứa "${query}"` : "Chưa có bài đăng nào"}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          {query
            ? "Thử từ khóa khác hoặc xóa bộ lọc."
            : "Vào trang Soạn bài để tạo và đăng bài đầu tiên."}
        </p>
        <Link
          href="/composer"
          className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          ✍️ Soạn bài mới
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {notice && (
        <p
          data-testid="history-notice"
          className={`rounded-lg px-3 py-2 text-sm font-medium ${
            notice.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
          }`}
        >
          {notice.ok ? "✅" : "⚠"} {notice.text}
        </p>
      )}

      <ul className="space-y-3" data-testid="history-list">
        {rows.map((row) => {
          const isBusy = busyId === row.id && pending;
          const failed = row.status === "FAILED";
          const open = expanded === row.id;

          return (
            <li
              key={row.id}
              data-testid="history-item"
              data-status={row.status}
              className={`rounded-2xl border bg-white p-4 ${
                failed ? "border-red-200" : "border-gray-200"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  data-testid="history-status"
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${row.statusCls}`}
                >
                  {row.statusLabel}
                </span>
                <span className="text-xs text-gray-500">{formatTime(row.createdAt)}</span>
                {row.pageName && (
                  <span
                    data-testid="history-page"
                    className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600"
                  >
                    📄 {row.pageName}
                  </span>
                )}
                {row.mediaCount > 0 && (
                  <span className="rounded bg-cyan-50 px-2 py-0.5 text-[11px] text-cyan-700">
                    🖼️ {row.mediaCount} media
                  </span>
                )}
                {row.publishedAt && (
                  <span className="text-[11px] text-emerald-600">
                    Đăng lúc {formatTime(row.publishedAt)}
                  </span>
                )}
              </div>

              <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-gray-800">
                {row.content}
              </p>
              {row.hashtags && (
                <p className="mt-1 text-xs text-blue-600">{row.hashtags}</p>
              )}

              {/* Lỗi: hiện lý do và cho xem chi tiết đầy đủ */}
              {failed && row.errorMessage && (
                <div className="mt-3 rounded-lg bg-red-50 px-3 py-2">
                  <p className="text-xs font-semibold text-red-700">Lý do lỗi</p>
                  <p
                    data-testid="history-error"
                    className={`mt-0.5 whitespace-pre-wrap text-xs text-red-700 ${
                      open ? "" : "line-clamp-2"
                    }`}
                  >
                    {row.errorMessage}
                  </p>
                  {row.errorMessage.length > 120 && (
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : row.id)}
                      className="mt-1 text-[11px] font-semibold text-red-800 underline"
                    >
                      {open ? "Thu gọn" : "Xem chi tiết"}
                    </button>
                  )}
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {failed && (
                  <button
                    type="button"
                    onClick={() => onRetry(row.id)}
                    disabled={isBusy}
                    data-testid="history-retry"
                    className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isBusy ? "⏳ Đang đăng lại…" : "🔁 Đăng lại"}
                  </button>
                )}
                {row.fbPostId && row.status === "PUBLISHED" && (
                  <a
                    href={permalinkOf(row.fbPostId)}
                    target="_blank"
                    rel="noreferrer"
                    data-testid="history-permalink"
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
                  >
                    🔗 Xem trên Facebook
                  </a>
                )}
                {row.status === "FAILED" && (
                  <Link
                    href="/composer"
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50"
                  >
                    ✏️ Sửa &amp; đăng lại
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => onDelete(row.id)}
                  disabled={isBusy}
                  data-testid="history-delete"
                  className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  🗑️ Xóa
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
