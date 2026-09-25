"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import {
  createBrand,
  deleteBrand,
  updateBrand,
  type BrandState,
} from "@/app/actions/brand";
import { autoPilotConfirmPrompt } from "@/lib/brand-scope";

// ============================================================
// Danh sách thương hiệu + tạo/sửa/xóa.
// Chọn brand qua Link (?brand=) để page server render editor.
// ============================================================

type BrandItem = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  pageCount: number;
  pillarCount: number;
  docCount: number;
  postCount: number;
  profileFilled: number;
};

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none";
const btnPrimary =
  "rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60";
const btnGhost =
  "rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";

function Alert({ state }: { state: BrandState }) {
  if (!state || (!state.ok && !state.error)) return null;
  return (
    <div
      data-testid="brand-crud-alert"
      className={`rounded-lg px-3 py-2 text-sm ${
        state.error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
      }`}
    >
      {state.error ? `✗ ${state.error}` : `✓ ${state.message}`}
    </div>
  );
}

export default function BrandListClient({
  workspaceId,
  brands,
  pages,
  selectedBrandId,
}: {
  workspaceId: string;
  brands: BrandItem[];
  pages: { id: string; name: string; brandId: string | null }[];
  selectedBrandId: string | null;
}) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [createState, createAction, creating_] = useActionState(createBrand, null);
  const [editState, editAction, editing_] = useActionState(updateBrand, null);

  const busy = creating_ || editing_ || pending;

  /**
   * Xoá thương hiệu theo luồng 2 bước.
   *
   * Bước 1 (`confirmAutoPilotOff = false`): server trả về danh sách Page đang
   * bật tự động đăng nếu thao tác này sẽ làm chúng mất thông tin doanh nghiệp.
   * Bước 2: người dùng đồng ý → gọi lại kèm cờ `true` để server tắt AutoPilot
   * rồi mới xoá. Xem src/lib/brand-scope.ts.
   */
  const runDelete = (brand: BrandItem, confirmAutoPilotOff: boolean) => {
    setDeleteError(null);
    startTransition(async () => {
      // Annotate kiểu: nhánh catch không có các trường tuỳ chọn của BrandState.
      const res: BrandState = await deleteBrand(brand.id, confirmAutoPilotOff).catch((err) => ({
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      }));

      if (res && res.ok) return;

      if (res?.needsAutoPilotConfirmation) {
        if (
          confirm(
            autoPilotConfirmPrompt(`Xoá thương hiệu "${brand.name}"`, res.affectedPages ?? [])
          )
        ) {
          runDelete(brand, true);
        }
        return;
      }

      setDeleteError(res?.error ?? "Không xoá được thương hiệu.");
    });
  };

  return (
    <div className="space-y-4">
      {deleteError ? (
        <div
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
          data-testid="brand-delete-error"
        >
          ✗ {deleteError}
        </div>
      ) : null}
      {/* ===== Form tạo thương hiệu ===== */}
      <div className="rounded-xl border border-gray-200 bg-white p-4" data-testid="brand-create-panel">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Thêm thương hiệu</h2>
          {!creating ? (
            <button type="button" onClick={() => setCreating(true)} className={btnGhost} data-testid="brand-create-open">
              ➕ Thương hiệu mới
            </button>
          ) : (
            <button type="button" onClick={() => setCreating(false)} className={btnGhost}>
              Đóng
            </button>
          )}
        </div>

        {creating ? (
          <form action={createAction} className="mt-3 space-y-3">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Tên thương hiệu</label>
                <input name="name" className={inputCls} placeholder="Ví dụ: Rèm Cửa Bình Dương" required maxLength={100} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Mô tả (tùy chọn)</label>
                <input name="description" className={inputCls} placeholder="Mô tả ngắn về thương hiệu" maxLength={500} />
              </div>
            </div>
            <Alert state={createState} />
            <button type="submit" disabled={creating_} className={btnPrimary}>
              {creating_ ? "Đang tạo..." : "Tạo thương hiệu"}
            </button>
          </form>
        ) : null}
      </div>

      {/* ===== Danh sách thương hiệu ===== */}
      {brands.length > 0 ? (
        <div className="grid gap-3" data-testid="brand-list">
          {brands.map((b) => {
            const isSelected = b.id === selectedBrandId;
            const isEditing = editingId === b.id;
            return (
              <div
                key={b.id}
                className={`rounded-xl border p-4 transition ${
                  isSelected ? "border-blue-500 bg-blue-50/40" : "border-gray-200 bg-white"
                }`}
                data-testid="brand-card"
              >
                {isEditing ? (
                  <form action={editAction} className="space-y-3">
                    <input type="hidden" name="brandId" value={b.id} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">Tên thương hiệu</label>
                        <input name="name" className={inputCls} defaultValue={b.name} required maxLength={100} />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-gray-700">Mô tả</label>
                        <input name="description" className={inputCls} defaultValue={b.description ?? ""} maxLength={500} />
                      </div>
                    </div>
                    <Alert state={editState} />
                    <div className="flex gap-2">
                      <button type="submit" disabled={editing_} className={btnPrimary}>
                        {editing_ ? "Đang lưu..." : "Lưu"}
                      </button>
                      <button type="button" onClick={() => setEditingId(null)} className={btnGhost}>
                        Hủy
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{b.name}</span>
                        {isSelected ? (
                          <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white">
                            Đang xem
                          </span>
                        ) : null}
                      </div>
                      {b.description ? (
                        <p className="mt-0.5 line-clamp-1 text-sm text-gray-500">{b.description}</p>
                      ) : null}
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                        <span>📄 {b.pageCount} Page</span>
                        <span>🧱 {b.pillarCount} trụ cột</span>
                        <span>📚 {b.docCount} tài liệu</span>
                        <span>📝 {b.postCount} bài</span>
                        <span className={b.profileFilled >= 3 ? "text-emerald-600" : "text-amber-600"}>
                          {b.profileFilled >= 3 ? `✓ hồ sơ ${b.profileFilled}/5` : `⚠ hồ sơ ${b.profileFilled}/5`}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Link
                        href={`/brand?brand=${b.id}`}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                        data-testid="brand-select"
                      >
                        Hồ sơ &amp; nội dung
                      </Link>
                      <button type="button" onClick={() => setEditingId(b.id)} className={btnGhost}>
                        Sửa
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          const pageNames = pages
                            .filter((p) => p.brandId === b.id)
                            .map((p) => p.name)
                            .join(", ");
                          const msg =
                            `Xóa thương hiệu "${b.name}"?\n\n` +
                            `- Hồ sơ, trụ cột, tài liệu của thương hiệu sẽ bị xóa.\n` +
                            `- ${b.pageCount} Page (${pageNames || "không có"}) sẽ được giữ lại, chỉ bỏ gán.\n` +
                            `- ${b.postCount} bài đã đăng được giữ nguyên.`;
                          // Hộp thoại này chỉ xác nhận việc xoá. Nếu thương hiệu
                          // đang có Page bật tự động đăng, server sẽ trả về yêu
                          // cầu xác nhận riêng (kèm tên Page) ở bước sau.
                          if (confirm(msg)) runDelete(b, false);
                        }}
                        className={`${btnGhost} text-red-600 hover:bg-red-50`}
                        data-testid="brand-delete"
                      >
                        Xóa
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
