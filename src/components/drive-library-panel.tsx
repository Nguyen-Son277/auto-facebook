"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rememberPickedDriveFiles } from "@/app/actions/drive";
import { useDrivePicker } from "@/components/drive-picker";
import { startDriveConnect } from "@/lib/drive-connect";

// ============================================================
// Bảng "Google Drive" trong Thư viện Media.
//
// ═══ VÌ SAO KHÔNG CÒN DUYỆT NỘI DUNG THƯ MỤC ═══
// Bản đầu tiên cho chọn một thư mục rồi liệt kê ảnh trong đó. Cách đó không chạy
// trên thực tế: scope `drive.file` cấp quyền theo TỪNG tài nguyên người dùng
// chọn, nên `files.get(folderId)` trả 200 (đọc được tên thư mục) mà
// `files.list` bên trong trả RỖNG không kèm lỗi → app tưởng thư mục trống.
//
// Cách chạy được: người dùng CHỌN ẢNH qua Google Picker (chọn nhiều tấm một
// lúc), app ghi nhớ từng tệp. Bảng này làm đúng việc đó và hiển thị những gì
// đã ghi nhớ (ảnh cũng nằm trong tab "Thư viện của tôi").
// ============================================================

export type DriveFolderOption = {
  brandId: string;
  brandName: string;
  folderName: string | null;
};

export default function DriveLibraryPanel({
  folders,
  pickerApiKey,
}: {
  /** Thương hiệu user có thể gán ảnh vào (rỗng = chưa tạo thương hiệu). */
  folders: DriveFolderOption[];
  pickerApiKey: string;
}) {
  const router = useRouter();
  const picker = useDrivePicker();
  const [brandId, setBrandId] = useState(folders[0]?.brandId ?? "");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const connected = Boolean(pickerApiKey);

  /** Mở Picker cho chọn nhiều ảnh/video rồi ghi nhớ vào thư viện. */
  async function onPick() {
    setMessage(null);

    if (!pickerApiKey) {
      setMessage({
        ok: false,
        text: "Máy chủ chưa cấu hình GOOGLE_PICKER_API_KEY nên không mở được Google Picker.",
      });
      return;
    }

    const docs = await picker.open("media", pickerApiKey);
    if (docs.length === 0) return; // huỷ, hoặc lỗi đã hiện ở picker.error

    const ids = docs.map((d) => d.id).filter((id): id is string => Boolean(id));
    if (ids.length === 0) {
      setMessage({ ok: false, text: "Google Picker không trả về tệp nào." });
      return;
    }

    startTransition(async () => {
      const res = await rememberPickedDriveFiles(brandId, ids);
      setMessage({
        ok: Boolean(res?.ok),
        text: res?.message ?? res?.error ?? "Không ghi nhớ được tệp.",
      });
      if (res?.ok) router.refresh();
    });
  }

  const alert = picker.error ? { ok: false, text: picker.error } : message;

  return (
    <div className="space-y-4" data-testid="drive-library">
      <div className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <p className="font-medium">Chọn ảnh/video trực tiếp từ Google Drive</p>
        <p className="mt-1 text-xs">
          Mở Google Picker, đi vào thư mục của bạn rồi <strong>chọn các tấm ảnh</strong> (giữ
          Ctrl/Cmd để chọn nhiều). App ghi nhớ đúng những ảnh bạn chọn, nên chúng dùng được ngay
          ở đây, khi soạn bài và cho AutoPilot.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {folders.length > 0 ? (
          <>
            <label className="text-sm font-medium text-gray-700" htmlFor="drive-brand">
              Gán vào thương hiệu
            </label>
            <select
              id="drive-brand"
              data-testid="drive-brand-select"
              value={brandId}
              onChange={(e) => setBrandId(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
            >
              {folders.map((f) => (
                <option key={f.brandId} value={f.brandId}>
                  {f.brandName}
                </option>
              ))}
            </select>
          </>
        ) : null}

        <button
          type="button"
          onClick={onPick}
          disabled={pending || picker.loading}
          data-testid="drive-pick"
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {picker.loading ? "Đang mở Google Picker..." : "📷 Chọn ảnh/video từ Drive"}
        </button>

        <button
          type="button"
          onClick={startDriveConnect}
          className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          {connected ? "Cấp quyền lại" : "Kết nối Google Drive"}
        </button>
      </div>

      {alert ? (
        <div
          data-testid="drive-library-alert"
          className={`rounded-lg px-3 py-2 text-sm whitespace-pre-line ${
            alert.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
          }`}
        >
          {alert.ok ? `✓ ${alert.text}` : `✗ ${alert.text}`}
        </div>
      ) : null}

      <p className="text-xs text-gray-500">
        Ảnh đã chọn nằm trong tab <strong>📚 Thư viện của tôi</strong> (nhãn “Drive”), dùng lại
        được nhiều lần. Muốn xem vì sao một thư mục không đọc được, vào trang{" "}
        <strong>Thương hiệu</strong> → khối “Ảnh/video từ Google Drive” → <strong>Chẩn đoán thư mục</strong>.
      </p>
    </div>
  );
}
