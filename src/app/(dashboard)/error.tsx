"use client";

import { useEffect } from "react";

/**
 * Lỗi trong nhóm trang dashboard — hiển thị thân thiện thay vì
 * stack trace thô. Sự cố workspace của user mới đã được DAL tự vá
 * (ensureWorkspaceForUser), còn đây là lưới an toàn cuối.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { message?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard]", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-3xl">
        ⚠️
      </div>
      <h2 className="text-lg font-bold text-gray-900">Có lỗi xảy ra</h2>
      <p className="mt-2 text-sm text-gray-600">
        {error.message || "Hệ thống gặp sự cố khi tải trang này."}
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          Thử lại
        </button>
        <a
          href="/dashboard"
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Về trang chính
        </a>
      </div>
    </div>
  );
}
