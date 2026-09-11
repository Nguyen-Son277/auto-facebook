"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import MediaBrowser from "@/components/media-browser";
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
}: {
  saved: SavedMediaItem[];
  pexelsReady: boolean;
  quotaUsed: number;
  quotaLimit: number;
  initialResult: MediaSearchState;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"search" | "library">("search");
  const [filter, setFilter] = useState<"ALL" | "IMAGE" | "VIDEO">("ALL");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, startDelete] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);

  const providerIds = saved
    .map((m) => m.providerId)
    .filter((id): id is string => Boolean(id));

  const visible = saved.filter((m) => filter === "ALL" || m.type === filter);

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
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1 text-sm">
          {(
            [
              ["search", "🔍 Tìm trên Pexels"],
              ["library", `📚 Thư viện của tôi (${saved.length})`],
            ] as ["search" | "library", string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`rounded-md px-3 py-1.5 font-medium transition ${
                tab === value
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <p className="text-xs text-gray-500">
          Pexels:{" "}
          <span
            className={
              quotaUsed > quotaLimit * 0.8 ? "font-medium text-amber-600" : "text-gray-600"
            }
          >
            {quotaUsed}/{quotaLimit}
          </span>{" "}
          request trong 1 giờ qua
        </p>
      </div>

      {tab === "search" ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <MediaBrowser
            mode="library"
            pexelsReady={pexelsReady}
            initialResult={initialResult}
            savedProviderIds={providerIds}
          />
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          {saved.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-gray-500">
                Thư viện đang trống. Sang tab{" "}
                <span className="font-medium">Tìm trên Pexels</span> để lưu ảnh/video dùng lại.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap gap-2">
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
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                      filter === value
                        ? "bg-blue-600 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {visible.map((m) => (
                  <li
                    key={m.id}
                    className="overflow-hidden rounded-xl border border-gray-200 bg-white"
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
                    <div className="space-y-1 p-2">
                      <p className="truncate text-[11px] text-gray-500">
                        {m.photographer ?? "Pexels"}
                        {m.width ? ` · ${m.width}×${m.height}` : ""}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => void copyUrl(m.remoteUrl)}
                          className="rounded border border-gray-300 px-1.5 py-0.5 text-[10px] text-gray-600 hover:bg-gray-50"
                        >
                          {copied === m.remoteUrl ? "✓ Đã chép" : "Chép URL"}
                        </button>
                        {m.sourcePageUrl && (
                          <a
                            href={m.sourcePageUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded border border-gray-300 px-1.5 py-0.5 text-[10px] text-gray-600 hover:bg-gray-50"
                          >
                            Nguồn
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => onDelete(m.id)}
                          disabled={deletingId === m.id}
                          className="rounded border border-red-200 px-1.5 py-0.5 text-[10px] text-red-600 hover:bg-red-50 disabled:opacity-60"
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
