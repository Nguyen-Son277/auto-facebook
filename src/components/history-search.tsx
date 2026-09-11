"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * Ô tìm kiếm ở trang Lịch sử.
 *
 * Dùng state có kiểm soát (controlled) thay vì defaultValue: trang này là
 * Server Component nên mỗi lần điều hướng/revalidate sẽ render lại, và input
 * uncontrolled sẽ bị xóa sạch chữ người dùng đang gõ.
 */
export default function HistorySearch({
  initialQuery,
  status,
  clearHref,
}: {
  initialQuery: string;
  /** Trạng thái đang lọc — gửi kèm để không mất bộ lọc khi tìm. */
  status: string;
  /** Link xóa toàn bộ bộ lọc. */
  clearHref: string;
}) {
  const [value, setValue] = useState(initialQuery);

  return (
    <form method="GET" action="/history" className="flex flex-wrap gap-2">
      {status !== "ALL" && <input type="hidden" name="status" value={status} />}
      <input
        type="search"
        name="q"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Tìm theo nội dung bài…"
        data-testid="history-search"
        className="min-w-56 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      />
      <button
        type="submit"
        data-testid="history-search-btn"
        className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-gray-700"
      >
        🔍 Tìm
      </button>
      {(value || status !== "ALL") && (
        <Link
          href={clearHref}
          onClick={() => setValue("")}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
        >
          Xóa lọc
        </Link>
      )}
    </form>
  );
}
