"use client";

import { useState, useTransition } from "react";
import { assignPageToBrand } from "@/app/actions/pages";

// ============================================================
// Ô chọn thương hiệu cho một Facebook Page.
//
// Vì sao cần: trụ cột nội dung và hồ sơ thương hiệu nay thuộc Brand, nhưng
// trước đây KHÔNG có control nào gán Page vào Brand — `FacebookPage.brandId`
// mãi là null. Hệ quả: trang Thương hiệu không thấy Page nào, và AutoPilot
// không tìm ra trụ cột nên không bật được.
//
// Server action trả về kết quả nên lỗi hiện ngay tại đây thay vì thất bại im lặng.
// ============================================================

export default function PageBrandSelect({
  pageId,
  brandId,
  brands,
}: {
  pageId: string;
  brandId: string | null;
  brands: { id: string; name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const noBrands = brands.length === 0;

  const onChange = (next: string | null) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await assignPageToBrand(pageId, next).catch((err) => ({
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      }));

      if (res && res.ok) {
        setNotice(res.details?.[0] ?? "Đã lưu.");
      } else {
        setError(res?.error ?? "Không lưu được thương hiệu cho Page.");
      }
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <select
        data-testid="page-brand-select"
        aria-label="Thương hiệu của Page"
        value={brandId ?? ""}
        disabled={pending || noBrands}
        onChange={(e) => onChange(e.currentTarget.value || null)}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900 transition focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="">— Chưa gắn thương hiệu —</option>
        {brands.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>

      {noBrands ? (
        <span className="text-xs text-amber-600">
          Chưa có thương hiệu nào — tạo ở trang Thương hiệu.
        </span>
      ) : null}

      {pending ? <span className="text-xs text-gray-400">Đang lưu…</span> : null}

      {error ? (
        <span className="text-xs text-red-600" data-testid="page-brand-error">
          ✗ {error}
        </span>
      ) : null}

      {!error && notice ? (
        <span className="text-xs text-amber-700" data-testid="page-brand-notice">
          ⚠ {notice}
        </span>
      ) : null}
    </div>
  );
}
