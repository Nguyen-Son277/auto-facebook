"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import MediaBrowser from "@/components/media-browser";
import DriveLibraryPanel, { type DriveFolderOption } from "@/components/drive-library-panel";
import { deleteLibraryMedia } from "@/app/actions/media";
import type { MediaSearchState } from "@/lib/pexels-types";

export type SavedMediaItem = {
  id: string;
  type: string;
  remoteUrl: string;
  previewUrl: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  photographer: string | null;
  photographerUrl: string | null;
  sourcePageUrl: string | null;
  alt: string | null;
  providerId: string | null;
};

export default function MediaLibrary({
  saved,
  pexelsReady,
  quotaUsed,
  quotaLimit,
  initialResult,
  drive,
}: {
  saved: SavedMediaItem[];
  pexelsReady: boolean;
  quotaUsed: number;
  quotaLimit: number;
  initialResult: MediaSearchState;
  /** Trạng thái Google Drive + danh sách brand đã gắn thư mục Drive. */
  drive: {
    connected: boolean;
    /** Brand (trong workspace của user) để gán ảnh Drive vào. */
    folders: DriveFolderOption[];
    /** Google Picker API key (server truyền xuống, không nhúng vào bundle). */
    pickerApiKey: string;
  };
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"search" | "library" | "drive">("search");
  const [filter, setFilter] = useState<"ALL" | "IMAGE" | "VIDEO">("ALL");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, startDelete] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);

  const providerIds = saved
    .map((m) => m.providerId)
    .filter((id): id is string => Boolean(id));

  const visible = saved.filter((m) => filter === "ALL" || m.type === filter);
  const quotaPercent = quotaLimit > 0 ? Math.min(100, Math.max(0, (quotaUsed / quotaLimit) * 100)) : 0;

  function onDelete(id: string) {
    if (!window.confirm("Xóa media này khỏi thư viện?")) return;
    setDeletingId(id);
    startDelete(async () => {
      await deleteLibraryMedia(id);
      setDeletingId(null);
      router.refresh();
    });
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* Quota + tab */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="ui-segmented w-full sm:w-auto">
          {(
            [
              ["search", "🔍 Tìm trên Pexels"],
              ["library", `📚 Thư viện của tôi (${saved.length})`],
              // Tab Drive chỉ hiện khi người dùng đã kết nối Drive
              ...(drive.connected
                ? ([["drive", "📁 Google Drive"]] as ["drive", string][])
                : []),
            ] as ["search" | "library" | "drive", string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              aria-pressed={tab === value}
              className={`min-h-10 flex-1 sm:flex-none ${tab === value ? "is-active" : ""}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="w-full space-y-2 rounded-xl border border-gray-200 bg-surface px-4 py-3 sm:w-auto sm:min-w-64">
          <p className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-gray-500">
            <span>Pexels · 1 giờ qua</span>
            <span
              className={
                quotaLimit > 0 && quotaUsed > quotaLimit * 0.8
                  ? "font-semibold tabular-nums text-amber-600"
                  : "font-semibold tabular-nums text-gray-700"
              }
            >
              {quotaLimit > 0 ? `${quotaUsed}/${quotaLimit} request` : `${quotaUsed} request · chưa có hạn mức`}
            </span>
          </p>
          <div
            className="ui-progress"
            role="progressbar"
            aria-label="Số request Pexels đã sử dụng trong 1 giờ qua"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={quotaPercent}
            aria-valuetext={quotaLimit > 0 ? `${quotaUsed} trên ${quotaLimit} request` : "Chưa có hạn mức request"}
          >
            <span style={{ width: `${quotaPercent}%` }} />
          </div>
        </div>
      </div>

      {tab === "search" ? (
        <div className="ui-card p-4 sm:p-5">
          <MediaBrowser
            mode="library"
            pexelsReady={pexelsReady}
            initialResult={initialResult}
            savedProviderIds={providerIds}
          />
        </div>
      ) : tab === "drive" ? (
        <div className="ui-card p-4 sm:p-5">
          <DriveLibraryPanel folders={drive.folders} pickerApiKey={drive.pickerApiKey} />
        </div>
      ) : (
        <div className="ui-card p-4 sm:p-5">
          {saved.length === 0 ? (
            <div className="ui-dropzone px-5 py-12 text-center">
              <span aria-hidden="true" className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100 text-2xl">🖼️</span>
              <p className="font-semibold text-gray-900">Thư viện đang chờ ý tưởng đầu tiên</p>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-gray-500">
                Sang tab <span className="font-medium text-blue-700">Tìm trên Pexels</span> để lưu ảnh/video,
                sẵn sàng dùng lại cho những bài đăng tiếp theo.
              </p>
            </div>
          ) : (
            <>
              <div className="ui-segmented mb-4">
                {(
                  [
                    ["ALL", `Tất cả (${saved.length})`],
                    ["IMAGE", `Ảnh (${saved.filter((m) => m.type === "IMAGE").length})`],
                    ["VIDEO", `Video (${saved.filter((m) => m.type === "VIDEO").length})`],
                  ] as ["ALL" | "IMAGE" | "VIDEO", string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFilter(value)}
                    aria-pressed={filter === value}
                    className={`min-h-10 ${filter === value ? "is-active" : ""}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {visible.length === 0 && (
                <div className="ui-dropzone mb-4 px-5 py-10 text-center">
                  <p className="text-sm font-semibold text-gray-700">Chưa có media ở bộ lọc này</p>
                  <p className="mt-1 text-sm text-gray-500">Chọn “Tất cả” để xem những nội dung đã lưu.</p>
                </div>
              )}

              <ul className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {visible.map((m) => (
                  <li
                    key={m.id}
                    className="ui-card-hover overflow-hidden rounded-xl border border-gray-200 bg-surface"
                  >
                    <div className="relative aspect-[4/3] bg-gray-100">
                      {(m.previewUrl ?? (m.type === "IMAGE" ? m.remoteUrl : null)) && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={m.previewUrl ?? m.remoteUrl}
                          alt={m.alt ?? ""}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      )}
                      {m.type === "VIDEO" && (
                        <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                          ▶ video
                        </span>
                      )}
                    </div>
                    <div className="space-y-3 p-3">
                      <p className="truncate text-xs text-gray-500">
                        {m.photographer ?? "Pexels"}
                        {m.width ? ` · ${m.width}×${m.height}` : ""}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => void copyUrl(m.remoteUrl)}
                          className="ui-btn ui-btn-ghost ui-btn-sm min-h-10"
                        >
                          {copied === m.remoteUrl ? "✓ Đã chép" : "Chép URL"}
                        </button>
                        {m.sourcePageUrl && (
                          <a
                            href={m.sourcePageUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="ui-btn ui-btn-ghost ui-btn-sm min-h-10"
                          >
                            Nguồn
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => onDelete(m.id)}
                          disabled={deletingId === m.id}
                          className="ui-btn ui-btn-danger ui-btn-sm min-h-10"
                        >
                          {deletingId === m.id ? "..." : "Xóa"}
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              <p className="mt-4 text-xs text-gray-400">
                Ảnh/video từ Pexels được phép dùng miễn phí, kể cả cho mục đích thương mại.
                Ghi công tác giả được khuyến khích — bấm &quot;Nguồn&quot; để mở trang tác giả.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
