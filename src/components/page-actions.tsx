"use client";

import { useState, useTransition } from "react";
import { deletePage, togglePageActive, type PageActionState } from "@/app/actions/pages";
import { autoPilotConfirmPrompt } from "@/lib/brand-scope";

// ============================================================
// Nút thao tác trên một Page: tạm dừng/kích hoạt và xoá.
//
// BẢO VỆ LỊCH ĐĂNG TỰ ĐỘNG: cả hai thao tác đều có thể làm AutoPilot ngừng tạo
// bài (tạm dừng Page → planner bỏ qua; xoá Page → cascade xoá cấu hình). Server
// action trả `needsAutoPilotConfirmation` kèm danh sách Page bị ảnh hưởng; ở đây
// hỏi lại người dùng rồi gọi lần hai kèm cờ xác nhận.
//
// Xem khối giải thích ở src/lib/brand-scope.ts.
// ============================================================

export function PageToggleActiveButton({
  pageId,
  isActive,
}: {
  pageId: string;
  isActive: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (confirmAutoPilotOff: boolean) => {
    setError(null);
    start(async () => {
      // Annotate kiểu: nhánh catch không có các trường tuỳ chọn của PageActionState.
      const res: PageActionState = await togglePageActive(pageId, confirmAutoPilotOff).catch((err) => ({
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      }));

      if (res && res.ok) return;

      // Chưa xác nhận → hỏi rồi thử lại. Đây là bước hai của luồng.
      if (res?.needsAutoPilotConfirmation) {
        const names = res.affectedPages ?? [];
        const verb = isActive ? "Tạm dừng Page" : "Kích hoạt Page";
        if (confirm(autoPilotConfirmPrompt(verb, names))) {
          run(true);
        }
        return;
      }

      setError(res?.error ?? "Không thực hiện được thao tác.");
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => run(false)}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
      >
        {pending ? "..." : isActive ? "Tạm dừng" : "Kích hoạt"}
      </button>
      {error ? (
        <span className="text-xs text-red-600" data-testid="page-toggle-error">
          ✗ {error}
        </span>
      ) : null}
    </div>
  );
}

export function PageDeleteButton({ pageId }: { pageId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (confirmAutoPilotOff: boolean) => {
    setError(null);
    start(async () => {
      const res: PageActionState = await deletePage(pageId, confirmAutoPilotOff).catch((err) => ({
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      }));

      if (res && res.ok) return;

      if (res?.needsAutoPilotConfirmation) {
        const names = res.affectedPages ?? [];
        // Hộp thoại này GỘP cả hai cảnh báo: mất Page và mất lịch đăng tự động.
        if (
          confirm(
            "Xóa Page này khỏi hệ thống? Các bài đã đăng sẽ vẫn còn trong lịch sử.\n\n" +
              autoPilotConfirmPrompt("Xoá Page", names)
          )
        ) {
          run(true);
        }
        return;
      }

      setError(res?.error ?? "Không xoá được Page.");
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => run(false)}
        className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 transition hover:bg-red-50 disabled:opacity-50"
      >
        {pending ? "..." : "Xóa"}
      </button>
      {error ? (
        <span className="text-xs text-red-600" data-testid="page-delete-error">
          ✗ {error}
        </span>
      ) : null}
    </div>
  );
}
