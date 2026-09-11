"use client";

import { useCallback, useState, useTransition } from "react";
import { saveToLibrary, searchPexelsMedia, suggestKeywords } from "@/app/actions/media";
import type {
  KeywordState,
  MediaSearchState,
  MediaType,
  PexelsMediaItem,
} from "@/lib/pexels-types";
import type { MediaKeyword } from "@/lib/ai-prompts";
import { MAX_PHOTOS_PER_POST, type AttachedMedia } from "@/lib/posts";

const keyOf = (item: PexelsMediaItem) => `${item.type}:${item.id}`;

export function toAttachment(item: PexelsMediaItem): AttachedMedia {
  return {
    remoteUrl: item.remoteUrl,
    previewUrl: item.previewUrl,
    type: item.type,
    source: "PEXELS",
    providerId: item.id,
    photographer: item.photographer,
    photographerUrl: item.photographerUrl,
    sourcePageUrl: item.pageUrl,
    alt: "alt" in item ? item.alt : undefined,
    width: item.width,
    height: item.height,
    duration: item.type === "VIDEO" ? item.duration : undefined,
  };
}

function fmtDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function MediaBrowser({
  mode,
  initialQuery = "",
  initialResult = null,
  postContent = "",
  pexelsReady,
  onAdd,
  onClose,
  savedProviderIds = [],
  existingCounts = { photos: 0, videos: 0 },
}: {
  mode: "pick" | "library";
  initialQuery?: string;
  /** Kết quả tải sẵn từ server (tránh gọi Pexels trong useEffect). */
  initialResult?: MediaSearchState;
  postContent?: string;
  pexelsReady: boolean;
  onAdd?: (items: AttachedMedia[]) => void;
  onClose?: () => void;
  /** providerId đã có trong thư viện — hiển thị nhãn "Đã lưu". */
  savedProviderIds?: string[];
  /** Media đã đính kèm trong bài — để chặn trộn ảnh/video và vượt số lượng. */
  existingCounts?: { photos: number; videos: number };
}) {
  const [query, setQuery] = useState(initialQuery);
  const [mediaType, setMediaType] = useState<MediaType>("IMAGE");
  const [result, setResult] = useState<MediaSearchState>(initialResult);
  const [selected, setSelected] = useState<Map<string, PexelsMediaItem>>(new Map());
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [keywords, setKeywords] = useState<MediaKeyword[]>([]);
  const [kwState, setKwState] = useState<KeywordState>(null);
  const [savingIds, setSavingIds] = useState<string[]>([]);

  const [searching, startSearch] = useTransition();
  const [suggesting, startSuggest] = useTransition();
  const [savingLib, startSaveLib] = useTransition();

  const items = result?.items ?? [];
  const selectedList = Array.from(selected.values());
  const selectedPhotos = selectedList.filter((i) => i.type === "IMAGE").length;
  const selectedVideos = selectedList.filter((i) => i.type === "VIDEO").length;

  const runSearch = useCallback(
    (opts: { query: string; mediaType: MediaType; page: number }) => {
      setNotice(null);
      startSearch(async () => {
        const fd = new FormData();
        fd.set("query", opts.query);
        fd.set("mediaType", opts.mediaType);
        fd.set("page", String(opts.page));
        setResult(await searchPexelsMedia(null, fd));
      });
    },
    []
  );

  function changeType(next: MediaType) {
    setMediaType(next);
    setSelected(new Map());
    runSearch({ query, mediaType: next, page: 1 });
  }

  function toggle(item: PexelsMediaItem) {
    const k = keyOf(item);
    const next = new Map(selected);
    if (next.has(k)) {
      next.delete(k);
      setNotice(null);
    } else {
      // Tính cả media đã có trong bài, không chỉ những mục đang chọn ở đây
      const photos =
        existingCounts.photos + Array.from(next.values()).filter((i) => i.type === "IMAGE").length;
      const videos =
        existingCounts.videos + Array.from(next.values()).filter((i) => i.type === "VIDEO").length;

      if (item.type === "IMAGE" && videos > 0) {
        setNotice({ ok: false, text: "Facebook không cho trộn ảnh với video — bỏ video trước." });
        return;
      }
      if (item.type === "VIDEO" && photos > 0) {
        setNotice({ ok: false, text: "Facebook không cho trộn video với ảnh — bỏ ảnh trước." });
        return;
      }
      if (item.type === "VIDEO" && videos >= 1) {
        setNotice({ ok: false, text: "Mỗi bài chỉ đăng được 1 video." });
        return;
      }
      if (item.type === "IMAGE" && photos >= MAX_PHOTOS_PER_POST) {
        setNotice({
          ok: false,
          text: `Tối đa ${MAX_PHOTOS_PER_POST} ảnh mỗi bài — bỏ bớt ảnh đã chọn.`,
        });
        return;
      }

      next.set(k, item);
      setNotice(null);
    }
    setSelected(next);
  }

  function onSuggest() {
    setKwState(null);
    startSuggest(async () => {
      const fd = new FormData();
      fd.set("content", postContent);
      const res = await suggestKeywords(null, fd);
      setKwState(res);
      setKeywords(res?.keywords ?? []);
    });
  }

  function applyKeyword(k: MediaKeyword) {
    setQuery(k.query);
    runSearch({ query: k.query, mediaType, page: 1 });
  }

  function handlePrimary() {
    if (selectedList.length === 0) return;

    if (mode === "pick") {
      onAdd?.(selectedList.map(toAttachment));
      onClose?.();
      return;
    }

    // mode === "library": lưu từng mục, báo cáo tổng kết
    startSaveLib(async () => {
      let saved = 0;
      let skipped = 0;
      for (const item of selectedList) {
        setSavingIds((ids) => [...ids, item.id]);
        const fd = new FormData();
        fd.set("item", JSON.stringify(item));
        const res = await saveToLibrary(null, fd);
        if (res?.ok && res.message === "Media này đã có trong thư viện.") skipped++;
        else if (res?.ok) saved++;
      }
      setSavingIds([]);
      setSelected(new Map());
      setNotice({
        ok: true,
        text:
          `Đã lưu ${saved} mục vào thư viện.` +
          (skipped > 0 ? ` Bỏ qua ${skipped} mục đã có sẵn.` : ""),
      });
    });
  }

  const savedSet = new Set(savedProviderIds);
  const busy = searching || suggesting || savingLib;

  return (
    <div className="space-y-4">
      {!pexelsReady && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Chưa cấu hình Pexels API Key.{" "}
          <a href="/settings" className="font-medium underline">
            Vào Cài đặt
          </a>{" "}
          để nhập key (miễn phí tại pexels.com/api).
        </div>
      )}

      {/* ---------- Thanh tìm kiếm ---------- */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runSearch({ query, mediaType, page: 1 });
              }
            }}
            placeholder="Tìm ảnh/video... (từ khóa tiếng Anh cho kết quả tốt nhất)"
            className="min-w-[200px] flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => runSearch({ query, mediaType, page: 1 })}
            disabled={busy || !pexelsReady}
            data-testid="media-search-btn"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {searching ? "Đang tìm..." : "🔍 Tìm"}
          </button>
          {mode === "pick" && (
            <button
              type="button"
              onClick={onSuggest}
              disabled={busy || !postContent.trim()}
              data-testid="ai-keyword-btn"
              title={
                postContent.trim()
                  ? "AI đọc nội dung bài để gợi ý từ khóa"
                  : "Nhập nội dung bài đăng trước để AI gợi ý từ khóa"
              }
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {suggesting ? "AI đang đọc..." : "✨ AI gợi ý từ khóa"}
            </button>
          )}
        </div>

        {/* Tab loại media */}
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1 text-sm">
          {(
            [
              ["IMAGE", "🖼️ Ảnh"],
              ["VIDEO", "🎬 Video"],
            ] as [MediaType, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              data-testid={`media-tab-${value}`}
              onClick={() => changeType(value)}
              className={`flex-1 rounded-md px-3 py-1.5 font-medium transition ${
                mediaType === value
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {kwState?.error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            ✗ {kwState.error}
          </p>
        )}
        {keywords.length > 0 && (
          <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-2.5">
            <p className="mb-1.5 text-xs font-medium text-violet-900">
              ✨ AI gợi ý từ khóa (bấm để tìm):
            </p>
            <div className="flex flex-wrap gap-1.5">
              {keywords.map((k) => (
                <button
                  key={k.query}
                  type="button"
                  data-testid="keyword-suggestion"
                  onClick={() => applyKeyword(k)}
                  disabled={busy}
                  className="rounded-full border border-violet-300 bg-white px-2.5 py-1 text-xs text-violet-700 transition hover:bg-violet-100 disabled:opacity-60"
                  title={`Tìm: ${k.query}`}
                >
                  {k.label} <span className="text-violet-400">· {k.query}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ---------- Kết quả ---------- */}
      {result?.error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          ✗ {result.error}
        </div>
      )}

      {result?.ok && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
          <span>
            {result.curated
              ? "Ảnh/video phổ biến"
              : `${(result.totalResults ?? 0).toLocaleString("vi-VN")} kết quả cho "${result.keyword}"`}
            {result.cached && <span className="ml-2 text-emerald-600">· từ cache</span>}
          </span>
          <span>Trang {result.page}</span>
        </div>
      )}

      {!result && !searching && pexelsReady && mode === "pick" && (
        <p className="rounded-lg border border-dashed border-gray-300 px-3 py-8 text-center text-sm text-gray-500">
          Nhập từ khóa rồi bấm <span className="font-medium">🔍 Tìm</span> — hoặc bấm{" "}
          <span className="font-medium">Để trống + Tìm</span> để xem ảnh phổ biến.
        </p>
      )}

      {searching && items.length === 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-[4/3] animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      )}

      {!searching && result?.ok && items.length === 0 && (
        <p className="rounded-lg bg-gray-50 px-3 py-8 text-center text-sm text-gray-500">
          Không tìm thấy {mediaType === "VIDEO" ? "video" : "ảnh"} nào cho &quot;{result.keyword}
          &quot; — thử từ khóa khác.
        </p>
      )}

      {items.length > 0 && (
        <div className="grid max-h-[420px] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3">
          {items.map((item) => {
            const k = keyOf(item);
            const isSelected = selected.has(k);
            const inLibrary = savedSet.has(item.id);
            return (
              <button
                key={k}
                type="button"
                data-testid="media-tile"
                data-media-type={item.type}
                data-selected={isSelected ? "1" : "0"}
                onClick={() => toggle(item)}
                className={`group relative overflow-hidden rounded-xl border-2 text-left transition ${
                  isSelected
                    ? "border-blue-500 ring-2 ring-blue-200"
                    : "border-transparent hover:border-gray-300"
                }`}
              >
                <div className="relative aspect-[4/3] w-full bg-gray-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.previewUrl}
                    alt={"alt" in item ? (item.alt ?? "") : ""}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                  {item.type === "VIDEO" && (
                    <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      ▶ {fmtDuration(item.duration)}
                    </span>
                  )}
                  {inLibrary && mode === "pick" && (
                    <span className="absolute left-1.5 top-1.5 rounded bg-emerald-600/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      Đã lưu
                    </span>
                  )}
                  {isSelected && (
                    <span className="absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                      {Array.from(selected.keys()).indexOf(k) + 1}
                    </span>
                  )}
                </div>
                <div className="bg-white px-2 py-1.5">
                  <p className="truncate text-[11px] text-gray-600">
                    {item.photographer ?? "—"}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    {item.width}×{item.height}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ---------- Phân trang ---------- */}
      {result?.ok && (items.length > 0 || (result.page ?? 1) > 1) && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            disabled={busy || (result.page ?? 1) <= 1}
            onClick={() =>
              runSearch({ query, mediaType, page: Math.max((result.page ?? 1) - 1, 1) })
            }
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            ← Trang trước
          </button>
          <span className="text-xs text-gray-400">Trang {result.page ?? 1}</span>
          <button
            type="button"
            disabled={busy || !result.hasNextPage}
            onClick={() => runSearch({ query, mediaType, page: (result.page ?? 1) + 1 })}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Trang sau →
          </button>
        </div>
      )}

      {/* ---------- Thông báo + nút hành động ---------- */}
      {notice && (
        <div
          data-testid="media-notice"
          className={`rounded-lg px-3 py-2 text-sm ${
            notice.ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"
          }`}
        >
          {notice.ok ? "✓ " : "⚠ "}
          {notice.text}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-3">
        <p className="text-xs text-gray-500" data-testid="selected-summary">
          {existingCounts.photos + existingCounts.videos > 0 && (
            <span className="mr-2 text-gray-600">
              Bài đang có {existingCounts.photos} ảnh
              {existingCounts.videos > 0 ? ` + ${existingCounts.videos} video` : ""} ·
            </span>
          )}
          Đã chọn {selectedList.length} mục
          {selectedPhotos > 0 && ` · ${selectedPhotos}/${MAX_PHOTOS_PER_POST} ảnh`}
          {selectedVideos > 0 && " · 1 video"}
          <span className="ml-2 text-gray-400">
            (ảnh tối đa {MAX_PHOTOS_PER_POST}, video tối đa 1, không trộn lẫn)
          </span>
        </p>
        <div className="flex gap-2">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              Đóng
            </button>
          )}
          <button
            type="button"
            onClick={handlePrimary}
            disabled={selectedList.length === 0 || busy || !pexelsReady}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {savingLib
              ? `Đang lưu ${savingIds.length}...`
              : mode === "pick"
                ? `Thêm ${selectedList.length} mục vào bài`
                : `Lưu ${selectedList.length} mục vào thư viện`}
          </button>
        </div>
      </div>
    </div>
  );
}
