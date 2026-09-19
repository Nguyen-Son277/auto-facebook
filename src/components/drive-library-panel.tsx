"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  browseDriveFolder,
  saveDriveFileToLibrary,
  type DriveBrowseItem,
} from "@/app/actions/drive";
import { startDriveConnect } from "@/lib/drive-connect";

// ============================================================
// Bảng duyệt thư mục Google Drive của thương hiệu trong Thư viện Media.
//
// VÌ SAO CẦN riêng bảng này (ngoài Google Picker ở trình soạn bài):
// Picker là lối tắt "chọn nhanh rồi đăng"; còn đây là nơi người dùng XEM nội
// dung thư mục và LƯU vào thư viện để tái sử dụng. Cũng là chỗ duy nhất cho
// biết thư mục nào đang gắn với thương hiệu nào.
// ============================================================

export type DriveFolderOption = {
  brandId: string;
  brandName: string;
  folderName: string | null;
};

export default function DriveLibraryPanel({ folders }: { folders: DriveFolderOption[] }) {
  const router = useRouter();
  const [brandId, setBrandId] = useState(folders[0]?.brandId ?? "");
  const [items, setItems] = useState<DriveBrowseItem[]>([]);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [, startSave] = useTransition();

  const load = useCallback(
    async (targetBrand: string, token?: string, append = false) => {
      if (!targetBrand) return;
      setLoading(true);
      setError(null);
      const res = await browseDriveFolder(targetBrand, token);
      setLoading(false);
      setLoadedOnce(true);
      if (!res.ok) {
        setError(res.error ?? "Không đọc được thư mục Drive.");
        if (!append) setItems([]);
        return;
      }
      setItems((prev) => (append ? [...prev, ...res.items] : res.items));
      setNextToken(res.nextPageToken);
    },
    []
  );

  // Cố ý KHÔNG tự tải trong useEffect: đọc Drive là lời gọi mạng ra Google, mà
  // mở tab chỉ để xem không nên tốn quota. Người dùng bấm nút thì mới tải.

  function onSave(item: DriveBrowseItem) {
    setNotice(null);
    setSavingId(item.id);
    startSave(async () => {
      const res = await saveDriveFileToLibrary({
        fileId: item.id,
        name: item.name,
        type: item.type,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        width: item.width,
        height: item.height,
        duration: item.duration,
      });
      setSavingId(null);
      if (res?.ok) {
        setNotice(res.message ?? "Đã lưu vào thư viện.");
        router.refresh();
      } else {
        setError(res?.error ?? "Không lưu được tệp Drive.");
      }
    });
  }

  if (folders.length === 0) {
    return (
      <div className="py-10 text-center" data-testid="drive-no-folder">
        <p className="text-sm text-gray-600">
          Chưa có thương hiệu nào gắn thư mục Google Drive.
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Vào trang <strong>Thương hiệu</strong> → mở khối “Ảnh/video từ Google Drive” để chọn thư mục.
          Khi đó ảnh/video trong thư mục sẽ hiện ở đây.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="drive-library">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-gray-700" htmlFor="drive-brand">
          Thương hiệu
        </label>
        <select
          id="drive-brand"
          data-testid="drive-brand-select"
          value={brandId}
          onChange={(e) => {
            setBrandId(e.target.value);
            // Đổi thương hiệu = thư mục khác → bỏ danh sách cũ, chờ người dùng tải
            setItems([]);
            setNextToken(null);
            setLoadedOnce(false);
            setError(null);
          }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
        >
          {folders.map((f) => (
            <option key={f.brandId} value={f.brandId}>
              {f.brandName} — {f.folderName ?? "thư mục Drive"}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void load(brandId)}
          disabled={loading}
          data-testid="drive-load"
          className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          {loading ? "Đang tải..." : loadedOnce ? "↻ Tải lại" : "Xem nội dung thư mục"}
        </button>
        <span className="text-xs text-gray-500">
          {loadedOnce && !loading ? `${items.length} tệp trong thư mục` : ""}
        </span>
      </div>

      {error ? (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="drive-error">
          ✗ {error}
          {error.includes("cấp quyền lại") ? (
            <>
              {" "}
              <button type="button" onClick={startDriveConnect} className="font-medium underline">
                Cấp quyền lại →
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">✓ {notice}</div>
      ) : null}

      {!loadedOnce && !loading && !error ? (
        <p className="py-8 text-center text-sm text-gray-500">
          Bấm <strong>“Xem nội dung thư mục”</strong> để tải danh sách ảnh/video từ Google Drive.
          Tệp lấy đúng từ thư mục đã gắn cho thương hiệu — không tốn dung lượng hệ thống.
        </p>
      ) : null}

      {loadedOnce && !loading && items.length === 0 && !error ? (
        <p className="py-8 text-center text-sm text-gray-500">
          Thư mục này chưa có ảnh/video nào. Hãy tải ảnh vào thư mục đó trên Google Drive rồi bấm
          “Tải lại”.
        </p>
      ) : null}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((item) => (
          <li
            key={item.id}
            className="overflow-hidden rounded-xl border border-gray-200 bg-white"
            data-testid="drive-item"
          >
            <div className="relative aspect-[4/3] bg-gray-100">
              {(item.thumbnailUrl ?? (item.type === "IMAGE" ? item.previewUrl : null)) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.thumbnailUrl ?? item.previewUrl}
                  alt={item.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              )}
              {item.type === "VIDEO" ? (
                <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] font-medium text-white">
                  ▶ video
                </span>
              ) : null}
            </div>
            <div className="p-2">
              <p className="truncate text-xs text-gray-700" title={item.name}>
                {item.name}
              </p>
              <p className="mt-0.5 text-[10px] text-gray-500">
                {item.sizeBytes
                  ? `${(item.sizeBytes / 1024 / 1024).toFixed(1)}MB`
                  : item.width
                    ? `${item.width}×${item.height}`
                    : item.mimeType}
              </p>
              <button
                type="button"
                onClick={() => onSave(item)}
                disabled={savingId === item.id}
                className="mt-2 w-full rounded-lg bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
              >
                {savingId === item.id ? "Đang lưu..." : "Lưu vào thư viện"}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {nextToken ? (
        <div className="text-center">
          <button
            type="button"
            onClick={() => void load(brandId, nextToken, true)}
            disabled={loading}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            {loading ? "Đang tải..." : "Tải thêm"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
