"use client";

import { useState, useTransition } from "react";
import { assignPageToBrand, type PageActionState } from "@/app/actions/pages";
import { autoPilotConfirmPrompt } from "@/lib/brand-scope";

// ============================================================
// Panel "Page thuộc thương hiệu" — gán / bỏ gán ngay tại trang Thương hiệu.
//
// Trước đây panel này chỉ hiển thị và bảo người dùng "Gán Page ở trang Pages",
// nhưng trang Pages không có control nào để gán — ngõ cụt khiến brandId của
// mọi Page mãi là null và AutoPilot không tìm ra trụ cột nội dung.
// ============================================================

type PageItem = { id: string; name: string; brandId: string | null };

export default function BrandPagesPanel({
  brandId,
  pages,
}: {
  brandId: string;
  pages: PageItem[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const linked = pages.filter((p) => p.brandId === brandId);
  const available = pages.filter((p) => p.brandId !== brandId);

  /**
   * Gán/bỏ gắn Page vào thương hiệu — luồng 2 bước khi Page đang bật tự động đăng.
   *
   * Bỏ gắn Brand khỏi một Page đang tự động đăng làm AutoPilot của Page đó hết
   * dữ liệu để viết bài. Server trả `needsAutoPilotConfirmation`; ở đây hỏi lại
   * rồi gọi lần hai kèm cờ xác nhận.
   *
   * Xem khối giải thích ở src/lib/brand-scope.ts.
   */
  const run = (pageId: string, nextBrandId: string | null, confirmAutoPilotOff = false) => {
    setError(null);
    startTransition(async () => {
      // Annotate kiểu: nhánh catch không có các trường tuỳ chọn của PageActionState.
      const res: PageActionState = await assignPageToBrand(
        pageId,
        nextBrandId,
        confirmAutoPilotOff
      ).catch((err) => ({
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      }));

      if (res && res.ok) return;

      if (res?.needsAutoPilotConfirmation) {
        const pageName = pages.find((p) => p.id === pageId)?.name ?? "Page này";
        const verb = nextBrandId
          ? `Chuyển "${pageName}" sang thương hiệu khác`
          : `Bỏ gắn thương hiệu khỏi "${pageName}"`;
        if (confirm(autoPilotConfirmPrompt(verb, res.affectedPages ?? []))) {
          run(pageId, nextBrandId, true);
        }
        return;
      }

      setError(res?.error ?? "Không lưu được thương hiệu cho Page.");
    });
  };

  return (
    <div
      className="mb-4 rounded-xl border border-gray-200 bg-white p-4"
      data-testid="brand-pages-panel"
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Page thuộc thương hiệu</h3>
        <span className="text-xs text-gray-500">
          {linked.length} Page gắn vào thương hiệu này
        </span>
      </div>

      {error ? (
        <p className="mb-2 text-xs text-red-600" data-testid="brand-pages-error">
          ✗ {error}
        </p>
      ) : null}

      {linked.length === 0 ? (
        <p className="text-sm text-gray-500">
          Chưa có Page nào gắn vào thương hiệu này.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2" data-testid="brand-pages-linked">
          {linked.map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-800"
            >
              {p.name}
              <button
                type="button"
                disabled={pending}
                onClick={() => run(p.id, null)}
                title="Bỏ gắn khỏi thương hiệu"
                aria-label={`Bỏ gắn ${p.name} khỏi thương hiệu`}
                className="text-blue-500 transition hover:text-red-600 disabled:opacity-50"
                data-testid="brand-page-unassign"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {available.length > 0 ? (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <p className="mb-2 text-xs font-medium text-gray-500">
            Gắn thêm Page vào thương hiệu này:
          </p>
          <div className="flex flex-wrap gap-2" data-testid="brand-pages-available">
            {available.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={pending}
                onClick={() => run(p.id, brandId)}
                className="rounded-full border border-gray-300 px-3 py-1 text-sm text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                data-testid="brand-page-assign"
              >
                + {p.name}
                {p.brandId ? (
                  <span className="ml-1 text-xs text-gray-400">
                    (đang ở thương hiệu khác)
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
