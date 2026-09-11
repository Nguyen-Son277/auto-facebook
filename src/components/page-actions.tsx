"use client";

import { useTransition } from "react";
import { deletePage, togglePageActive } from "@/app/actions/pages";

export function PageToggleActiveButton({
  pageId,
  isActive,
}: {
  pageId: string;
  isActive: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => togglePageActive(pageId).catch(console.error))}
      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
    >
      {pending ? "..." : isActive ? "Tạm dừng" : "Kích hoạt"}
    </button>
  );
}

export function PageDeleteButton({ pageId }: { pageId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (confirm("Xóa Page này khỏi hệ thống? Các bài đã đăng sẽ vẫn còn trong lịch sử.")) {
          start(() => deletePage(pageId).catch(console.error));
        }
      }}
      className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-50 disabled:opacity-50"
    >
      {pending ? "..." : "Xóa"}
    </button>
  );
}
