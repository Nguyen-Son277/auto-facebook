"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  diagnoseDriveFolder,
  linkBrandFolder,
  linkBrandFolderByUrl,
  unlinkBrandFolder,
} from "@/app/actions/drive";
import { useDrivePicker } from "@/components/drive-picker";
import { startDriveConnect } from "@/lib/drive-connect";

// ============================================================
// Khối "Thư mục Google Drive của thương hiệu".
//
// VÌ SAO CẦN
// App chỉ xin scope "drive.file": nó chỉ thấy tệp do app tạo hoặc do người
// dùng CHỌN TƯỜNG MINH. Vì vậy mỗi thương hiệu phải được gắn một thư mục
// trên Drive — đó là nguồn ảnh/video riêng cho thương hiệu đó.
//
// Người dùng có thể bỏ trống: khi đó thương hiệu dùng Pexels / tải từ máy.
// Đây là lựa chọn, không phải bắt buộc.
// ============================================================

export type BrandDriveState = {
  linked: boolean;
  folderId: string | null;
  folderName: string | null;
  lastError: string | null;
  connectionStatus: string | null;
  /** Số ảnh/video đọc được trong thư mục; null = chưa kiểm tra được. */
  fileCount?: number | null;
  /** Cảnh báo khi gắn được thư mục nhưng nội dung không đọc được. */
  contentWarning?: string | null;
};

export default function BrandDrivePanel({
  brandId,
  state,
  driveConnected,
  pickerReady,
  pickerApiKey,
}: {
  brandId: string;
  state: BrandDriveState;
  /** Người dùng đã kết nối Drive ở trang Cài đặt chưa. */
  driveConnected: boolean;
  /** Máy chủ đã có GOOGLE_PICKER_API_KEY chưa. */
  pickerReady: boolean;
  pickerApiKey: string;
}) {
  const router = useRouter();
  const picker = useDrivePicker();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [url, setUrl] = useState("");
  const [showManual, setShowManual] = useState(false);

  async function onChooseFolder() {
    setMessage(null);
    const docs = await picker.open("folder", pickerApiKey);
    if (docs.length === 0) return; // người dùng huỷ hoặc picker báo lỗi (đã hiện ở picker.error)

    const folderId = docs[0]?.id;
    if (!folderId) {
      setMessage({ ok: false, text: "Google Picker không trả về ID thư mục." });
      return;
    }

    startTransition(async () => {
      const res = await linkBrandFolder(brandId, folderId);
      if (res?.ok) {
        setMessage({ ok: true, text: res.message ?? "Đã gắn thư mục Drive." });
        router.refresh();
      } else {
        setMessage({ ok: false, text: res?.error ?? "Không gắn được thư mục Drive." });
      }
    });
  }

  function onUnlink() {
    startTransition(async () => {
      const res = await unlinkBrandFolder(brandId);
      setConfirming(false);
      if (res?.ok) {
        setMessage({ ok: true, text: res.message ?? "Đã bỏ thư mục Drive." });
        router.refresh();
      } else {
        setMessage({ ok: false, text: res?.error ?? "Không bỏ được thư mục Drive." });
      }
    });
  }

  /** Gắn thư mục bằng link dán tay (khi Google Picker không chạy được). */
  function onLinkByUrl() {
    setMessage(null);
    startTransition(async () => {
      const res = await linkBrandFolderByUrl(brandId, url);
      if (res?.ok) {
        setMessage({ ok: true, text: res.message ?? "Đã gắn thư mục Drive từ link." });
        setUrl("");
        router.refresh();
      } else {
        setMessage({ ok: false, text: res?.error ?? "Không gắn được thư mục từ link." });
      }
    });
  }

  /**
   * Chẩn đoán: "vì sao thư mục có ảnh mà không thấy ảnh nào?".
   * Dùng chung cho cả nút kiểm tra quyền đọc lẫn nút chẩn đoán.
   */
  function onTest() {
    setMessage(null);
    startTransition(async () => {
      const res = await diagnoseDriveFolder(brandId, url || undefined);
      setMessage({
        ok: Boolean(res?.ok),
        text: res?.message ?? res?.error ?? "Không có kết quả chẩn đoán.",
      });
    });
  }

  const pickerError = picker.error;
  const alert = pickerError
    ? { ok: false, text: pickerError }
    : message;

  return (
    <details
      className="mt-4 rounded-2xl border border-gray-200 bg-white"
      data-testid="brand-drive-panel"
      open={state.linked}
    >
      <summary className="cursor-pointer list-none px-5 py-4">
        <span className="flex flex-wrap items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-yellow-100 text-lg">
            📁
          </span>
          <span className="font-semibold text-gray-900">
            Ảnh/video từ Google Drive
          </span>
          {state.linked ? (
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                state.fileCount === 0
                  ? "bg-amber-100 text-amber-800"
                  : "bg-emerald-100 text-emerald-700"
              }`}
              data-testid="brand-drive-status"
            >
              {state.fileCount === 0
                ? `⚠ Đã gắn nhưng thư mục trống: ${state.folderName ?? state.folderId}`
                : `Đã gắn: ${state.folderName ?? state.folderId}${
                    typeof state.fileCount === "number" ? ` · ${state.fileCount} ảnh/video` : ""
                  }`}
            </span>
          ) : (
            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500">
              Chưa gắn thư mục (không bắt buộc)
            </span>
          )}
        </span>
      </summary>

      <div className="border-t border-gray-100 px-5 py-4">
        <p className="text-sm text-gray-600">
          Gắn một thư mục trên Drive của bạn làm nguồn ảnh/video riêng cho thương hiệu này.
          AutoPilot và trình soạn bài sẽ lấy tệp trong thư mục đó. Bỏ trống cũng được —
          thương hiệu vẫn dùng được Pexels hoặc tải tệp từ máy.
        </p>

        {!driveConnected ? (
          <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Bạn chưa kết nối Google Drive.{" "}
            <button
              type="button"
              onClick={startDriveConnect}
              className="font-medium underline"
            >
              Kết nối ngay
            </button>{" "}
            rồi quay lại chọn thư mục.
          </div>
        ) : null}

        {state.connectionStatus === "NEEDS_REAUTH" ? (
          <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Kết nối Drive cần cấp quyền lại.{" "}
            <button
              type="button"
              onClick={startDriveConnect}
              className="font-medium underline"
            >
              Cấp quyền lại
            </button>
            .
          </div>
        ) : null}

        {state.linked && state.contentWarning ? (
          <div
            className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"
            data-testid="brand-drive-content-warning"
          >
            ⚠ {state.contentWarning}
          </div>
        ) : null}

        {state.linked && state.lastError ? (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            Lần đọc thư mục gần nhất lỗi: {state.lastError}
          </div>
        ) : null}

        {alert ? (
          <div
            data-testid="brand-drive-alert"
            className={`mt-3 rounded-lg px-3 py-2 text-sm whitespace-pre-line ${
              alert.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
            }`}
          >
            {alert.ok ? `✓ ${alert.text}` : `✗ ${alert.text}`}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onChooseFolder}
            disabled={pending || picker.loading || !driveConnected || !pickerReady}
            data-testid="brand-drive-choose"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {picker.loading
              ? "Đang mở Google Picker..."
              : state.linked
                ? "Đổi thư mục khác"
                : "Chọn thư mục trên Drive"}
          </button>

          <button
            type="button"
            onClick={() => setShowManual((v) => !v)}
            data-testid="brand-drive-manual-toggle"
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            {showManual ? "Ẩn ô dán link" : "Dán link thư mục thay thế"}
          </button>

          {state.linked && !confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              data-testid="brand-drive-unlink"
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              Bỏ thư mục
            </button>
          ) : null}

          {confirming ? (
            <span className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              Bỏ thư mục Drive của thương hiệu?
              <button
                type="button"
                onClick={onUnlink}
                disabled={pending}
                className="rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
              >
                {pending ? "Đang bỏ..." : "Bỏ"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-700"
              >
                Huỷ
              </button>
            </span>
          ) : null}
        </div>

        {/* ===== Dán link thay cho Google Picker =====
            Picker phụ thuộc script apis.google.com + Picker API, có môi trường
            chặn mất. Ô này là lối tắt, nhưng KHÔNG tự cấp quyền: nút "Kiểm tra"
            gọi thẳng Drive API để nói ngay thư mục có đọc được hay không. */}
        {showManual ? (
          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3" data-testid="brand-drive-manual">
            <label className="block text-sm font-medium text-gray-700" htmlFor="drive-folder-url">
              Dán link thư mục Google Drive
            </label>
            <p className="mt-1 text-xs text-gray-500">
              Mở thư mục chứa ảnh trên Drive → copy link trên thanh địa chỉ (dạng{" "}
              <span className="font-mono">drive.google.com/drive/folders/&lt;ID&gt;</span>) → dán vào đây.
            </p>
            <input
              id="drive-folder-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://drive.google.com/drive/folders/1AbC..."
              data-testid="brand-drive-url"
              className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs text-gray-900 focus:border-blue-500 focus:outline-none"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onLinkByUrl}
                disabled={pending || !url.trim()}
                data-testid="brand-drive-link-url"
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending ? "Đang kiểm tra..." : "Gắn thư mục này"}
              </button>
              <button
                type="button"
                onClick={onTest}
                disabled={pending}
                data-testid="brand-drive-test"
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
              >
                Chẩn đoán thư mục
              </button>
            </div>
            <p className="mt-2 text-xs text-amber-800">
              ⚠️ Dán link <strong>không cấp quyền</strong> cho app. Nếu báo 403/404, hãy dùng
              Google Picker (nút xanh) — cách đó cấp quyền thật, hoặc để thư mục ở chế độ
              “Bất kỳ ai có link”.
            </p>
          </div>
        ) : null}

        {!pickerReady ? (
          <p className="mt-3 text-xs text-amber-700">
            Máy chủ thiếu <span className="font-mono">GOOGLE_PICKER_API_KEY</span> nên chưa chọn
            được thư mục.
          </p>
        ) : null}

        {state.linked && state.folderId ? (
          <p className="mt-3 text-xs text-gray-500">
            Folder ID: <span className="font-mono">{state.folderId}</span>
          </p>
        ) : null}
      </div>
    </details>
  );
}
