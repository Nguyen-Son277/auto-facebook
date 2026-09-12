"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  generateContent,
  loadDraft,
  removePost,
  submitPost,
} from "@/app/actions/composer";
import { searchPexelsMedia, suggestKeywords } from "@/app/actions/media";
import { GOALS, LENGTHS, TONES } from "@/lib/ai-prompts";
import {
  countChars,
  MAX_PHOTOS_PER_POST,
  validateAttachments,
  type AttachedMedia,
} from "@/lib/posts";
import type { KeywordState, MediaSearchState, MediaType, PexelsMediaItem } from "@/lib/pexels-types";
import MediaBrowser, { toAttachment } from "@/components/media-browser";

export type ComposerPageOption = {
  id: string;
  name: string;
  fbPageId: string;
  /** Brand Page thuộc về (nếu đã gán) — để đồng bộ dropdown AI */
  brandId?: string | null;
  /** Tên thương hiệu Page thuộc về (nếu đã gán) */
  brandName?: string | null;
  /** Tên Facebook App cấp token cho Page */
  connectionName?: string | null;
};

export type ComposerBrandOption = {
  id: string;
  name: string;
  /** Ngành hàng + sản phẩm chính (từ hồ sơ) — cho gợi ý từ khóa tìm media */
  industry?: string | null;
  products?: string | null;
};

export type DraftItem = {
  id: string;
  content: string;
  hashtags: string | null;
  pageName: string | null;
  updatedAt: string;
};

export type HistoryItem = {
  id: string;
  content: string;
  status: string;
  pageName: string | null;
  createdAt: string;
  errorMessage: string | null;
  permalink: string | null;
};

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none";
const labelCls = "mb-1 block text-sm font-medium text-gray-700";
const selectCls = `${inputCls} bg-white`;

const badgeOf = (status: string) =>
  ({
    DRAFT: { label: "Nháp", cls: "bg-gray-100 text-gray-600" },
    SCHEDULED: { label: "Đã lên lịch", cls: "bg-amber-100 text-amber-700" },
    PUBLISHING: { label: "Đang đăng", cls: "bg-blue-100 text-blue-700" },
    PUBLISHED: { label: "Đã đăng", cls: "bg-emerald-100 text-emerald-700" },
    FAILED: { label: "Lỗi", cls: "bg-red-100 text-red-700" },
  })[status] ?? { label: status, cls: "bg-gray-100 text-gray-600" };

/** Chuyển Date → giá trị cho <input type="datetime-local"> theo giờ địa phương. */
function toLocalInputValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(
    d.getMinutes()
  )}`;
}

/** Khung giờ gợi ý nhanh — tính từ lúc bấm nên luôn ở tương lai. */
const QUICK_SCHEDULES = [
  { label: "+1 giờ", at: () => new Date(Date.now() + 60 * 60 * 1000) },
  { label: "20:00 hôm nay", at: () => atHour(20, 0) },
  { label: "08:00 mai", at: () => atHour(8, 1) },
  { label: "20:00 mai", at: () => atHour(20, 1) },
];

/** Thời điểm ở giờ:phút cho trước; nếu đã qua thì lấy ngày kế tiếp. */
function atHour(hour: number, dayOffset: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d;
}

export default function ComposerStudio({
  pages,
  brands = [],
  drafts,
  history,
  aiReady,
  pexelsReady,
  libraryProviderIds,
}: {
  pages: ComposerPageOption[];
  brands?: ComposerBrandOption[];
  drafts: DraftItem[];
  history: HistoryItem[];
  aiReady: boolean;
  pexelsReady: boolean;
  libraryProviderIds: string[];
}) {
  const router = useRouter();

  // ---------- Form AI ----------
  const [genState, genAction, genPending] = useActionState(generateContent, null);
  const [topic, setTopic] = useState("");
  const [tone, setTone] = useState("friendly");
  const [goal, setGoal] = useState("engagement");
  const [length, setLength] = useState("medium");
  const [audience, setAudience] = useState("");
  const [keywords, setKeywords] = useState("");
  const [variantCount, setVariantCount] = useState("3");

  // ---------- Trình soạn thảo ----------
  const [subState, subAction, subPending] = useActionState(submitPost, null);
  const [pageId, setPageId] = useState("");
  const [content, setContent] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [attachments, setAttachments] = useState<AttachedMedia[]>([]);
  const [hideResult, setHideResult] = useState(false);
  const [usedIndex, setUsedIndex] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scheduledAt, setScheduledAt] = useState("");

  // ---------- Viết theo thương hiệu ----------
  // brandOverride = "" (chưa đụng dropdown) → derive theo Page; đụng rồi → theo người dùng.
  // Derive khi render thay vì useEffect — tránh cascading render.
  const [brandOverride, setBrandOverride] = useState<string | null>(null);
  const pageBrandId = pages.find((x) => x.id === pageId)?.brandId ?? null;
  const brandId = brandOverride ?? pageBrandId ?? "";
  const selectedBrand = brands.find((b) => b.id === brandId) ?? null;
  const setBrandId = setBrandOverride;

  // ---------- Tìm media nhanh (inline) ----------
  const [quickQuery, setQuickQuery] = useState("");
  const [quickType, setQuickType] = useState<MediaType>("IMAGE");
  const [quickResult, setQuickResult] = useState<MediaSearchState>(null);
  const [quickSearching, startQuickSearch] = useTransition();
  const [quickKw, setQuickKw] = useState<KeywordState>(null);
  const [quickSuggesting, startQuickSuggest] = useTransition();

  function runQuickSearch(query: string, mediaType: MediaType = quickType) {
    const q = query.trim();
    if (!q) return;
    startQuickSearch(async () => {
      const fd = new FormData();
      fd.set("query", q);
      fd.set("mediaType", mediaType);
      fd.set("page", "1");
      const res = await searchPexelsMedia(null, fd);
      setQuickResult(res);
    });
  }

  function onQuickSuggest() {
    if (content.trim().length < 10) {
      setQuickKw({
        ok: false,
        error: "Nhập ít nhất 10 ký tự nội dung rồi bấm gợi ý từ khóa.",
      });
      return;
    }
    startQuickSuggest(async () => {
      const fd = new FormData();
      fd.set("content", content);
      // Bám ngành hàng thương hiệu đang chọn — từ khóa sát nội dung hơn
      if (selectedBrand?.industry) fd.set("industry", selectedBrand.industry);
      if (selectedBrand?.products) fd.set("products", selectedBrand.products);
      const res = await suggestKeywords(null, fd);
      setQuickKw(res);
    });
  }

  function quickAdd(item: PexelsMediaItem) {
    const att = toAttachment(item);
    const next = [...attachments, att];
    const check = validateAttachments(next);
    if (!check.ok) {
      setMediaNotice(check.error);
      return;
    }
    addMedia([att]);
  }

  const editorRef = useRef<HTMLDivElement>(null);
  const [loadingDraft, startLoadDraft] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const selectedPage = pages.find((p) => p.id === pageId);
  const chars = countChars(content);
  const firstLine = content.split("\n")[0]?.trim() ?? "";
  const firstLineLong = firstLine.length > 125;

  const variants = genState?.variants ?? [];

  function applyVariant(index: number) {
    const v = variants[index];
    if (!v) return;
    setContent(v.content);
    setHashtags(v.hashtags);
    setUsedIndex(index);
    setHideResult(false);
    editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function startNewPost() {
    setContent("");
    setHashtags("");
    setAttachments([]);
    setMediaNotice(null);
    setUsedIndex(null);
    setScheduledAt("");
    setHideResult(true);
  }

  function onEditDraft(id: string) {
    startLoadDraft(async () => {
      const draft = await loadDraft(id);
      if (!draft) return;
      setContent(draft.content);
      setHashtags(draft.hashtags);
      setAttachments(draft.attachments);
      if (draft.pageId) setPageId(draft.pageId);
      setMediaNotice(null);
      setUsedIndex(null);
      setHideResult(true);
      editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function addMedia(items: AttachedMedia[]) {
    setAttachments((prev) => {
      const seen = new Set(prev.map((m) => m.remoteUrl));
      const merged = [...prev];
      for (const m of items) {
        if (seen.has(m.remoteUrl)) continue;
        seen.add(m.remoteUrl);
        merged.push(m);
      }
      return merged;
    });
    setMediaNotice(null);
  }

  function removeMedia(url: string) {
    const target = attachments.find((m) => m.remoteUrl === url);
    setAttachments((prev) => prev.filter((m) => m.remoteUrl !== url));
    setMediaNotice(null);

    // Video tải từ máy: xóa file trên server để không chiếm dung lượng
    if (target?.source === "UPLOAD" && target.storageKey) {
      void fetch(`/api/uploads/${target.storageKey}`, { method: "DELETE" }).catch(() => {
        // Không chặn UI nếu xóa file thất bại
      });
    }
  }

  /**
   * Tải video từ máy lên server. Dùng XMLHttpRequest (không phải fetch)
   * vì cần theo dõi tiến trình tải — video có thể vài trăm MB.
   */
  function onUploadVideo(file: File) {
    setUploadError(null);

    if (videoCount > 0) {
      setUploadError("Bài đã có 1 video — bỏ video hiện tại trước khi thêm video mới.");
      return;
    }
    if (photoCount > 0) {
      setUploadError("Facebook không cho trộn video với ảnh — bỏ ảnh trước.");
      return;
    }

    const maxMb = 200;
    if (file.size > maxMb * 1024 * 1024) {
      setUploadError(
        `File ${(file.size / 1024 / 1024).toFixed(0)}MB vượt giới hạn ${maxMb}MB.`
      );
      return;
    }

    const form = new FormData();
    form.append("file", file);

    setUploading(true);
    setUploadPct(0);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setUploadPct(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      setUploading(false);
      let payload: {
        ok?: boolean;
        error?: string;
        storageKey?: string;
        size?: number;
        mimeType?: string;
        previewUrl?: string;
      } = {};
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        setUploadError(`Máy chủ trả về dữ liệu không hợp lệ (HTTP ${xhr.status}).`);
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300 && payload.ok && payload.storageKey) {
        addMedia([
          {
            remoteUrl: payload.previewUrl ?? `/api/uploads/${payload.storageKey}`,
            previewUrl: payload.previewUrl ?? undefined,
            type: "VIDEO",
            source: "UPLOAD",
            storageKey: payload.storageKey,
            mimeType: payload.mimeType,
            sizeBytes: payload.size,
            alt: file.name,
          },
        ]);
        setMediaNotice(`Đã tải lên "${file.name}" — bấm Đăng ngay để đăng video này.`);
      } else {
        setUploadError(payload.error ?? `Tải lên thất bại (HTTP ${xhr.status}).`);
      }
    };

    xhr.onerror = () => {
      setUploading(false);
      setUploadError("Không kết nối được máy chủ — kiểm tra mạng rồi thử lại.");
    };

    xhr.onabort = () => setUploading(false);

    xhr.send(form);
  }

  const photoCount = attachments.filter((m) => m.type === "IMAGE").length;
  const videoCount = attachments.filter((m) => m.type === "VIDEO").length;

  async function onDeletePost(id: string) {
    if (!window.confirm("Xóa bài này? Hành động không thể hoàn tác.")) return;
    setDeletingId(id);
    await removePost(id);
    setDeletingId(null);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {/* ================= AI viết nội dung ================= */}
      <div className="rounded-2xl border border-violet-200 bg-white p-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-xl">
            ✨
          </span>
          <div>
            <h2 className="font-semibold text-gray-900">AI viết nội dung</h2>
            <p className="text-xs text-gray-500">
              Nhập chủ đề, chọn giọng điệu — AI viết 2–3 phương án để bạn chọn
            </p>
          </div>
        </div>

        {!aiReady && (
          <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Chưa cấu hình AI Provider.{" "}
            <a href="/settings" className="font-medium underline">
              Vào Cài đặt
            </a>{" "}
            để nhập Base URL + API Key rồi chọn model.
          </div>
        )}

        <form
          action={genAction}
          onSubmit={() => {
            setHideResult(false);
            setUsedIndex(null);
          }}
          className="space-y-3"
        >
          <input type="hidden" name="pageName" value={selectedPage?.name ?? ""} />

          <div>
            <label className={labelCls}>
              Viết theo thương hiệu
            </label>
            <select
              name="brandId"
              className={selectCls}
              value={brandId}
              onChange={(e) => setBrandId(e.target.value)}
              data-testid="composer-brand-select"
            >
              <option value="">— Không dùng hồ sơ thương hiệu —</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              {selectedBrand
                ? `AI sẽ dùng hồ sơ, trụ cột và kho tài liệu của "${selectedBrand.name}" để viết đúng chất thương hiệu.`
                : brands.length > 0
                  ? "Chọn thương hiệu để AI viết đúng chất — hoặc để trống nếu chỉ cần bài generic."
                  : "Chưa có thương hiệu nào — tạo ở trang Thương hiệu để AI viết đúng chất hơn."}
            </p>
          </div>

          <div>
            <label className={labelCls}>Chủ đề / ý tưởng bài đăng</label>
            <textarea
              name="topic"
              rows={3}
              required
              className={inputCls}
              placeholder="Ví dụ: Khai trương cửa hàng trà sữa tại Quận 1, giảm 30% cho khách đến trong tuần đầu"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={labelCls}>Giọng điệu</label>
              <select
                name="tone"
                className={selectCls}
                value={tone}
                onChange={(e) => setTone(e.target.value)}
              >
                {TONES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Mục tiêu</label>
              <select
                name="goal"
                className={selectCls}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              >
                {GOALS.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Độ dài</label>
              <select
                name="length"
                className={selectCls}
                value={length}
                onChange={(e) => setLength(e.target.value)}
              >
                {LENGTHS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>
                Đối tượng độc giả <span className="text-gray-400">(tùy chọn)</span>
              </label>
              <input
                name="audience"
                type="text"
                className={inputCls}
                placeholder="Ví dụ: sinh viên, dân văn phòng, mẹ bỉm sữa"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>
                Từ khóa cần có <span className="text-gray-400">(tùy chọn)</span>
              </label>
              <input
                name="keywords"
                type="text"
                className={inputCls}
                placeholder="Ví dụ: trà sữa, khai trương, giảm giá"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className={labelCls}>Số phương án</label>
              <select
                name="variantCount"
                className={`${selectCls} w-28`}
                value={variantCount}
                onChange={(e) => setVariantCount(e.target.value)}
              >
                <option value="2">2</option>
                <option value="3">3</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={genPending || !aiReady}
              className="rounded-lg bg-violet-600 px-5 py-2.5 font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {genPending ? "AI đang viết..." : "✨ Sinh nội dung"}
            </button>
            {genPending && (
              <span className="text-xs text-gray-500">
                Thường mất 5–30 giây tùy model...
              </span>
            )}
          </div>
        </form>

        {genState?.error && (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            ✗ {genState.error}
          </div>
        )}

        {genState?.ok && variants.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-emerald-700">
                ✓ {genState.message}
              </p>
              <p className="text-xs text-gray-400">
                model: {genState.model}
                {genState.usage?.totalTokens
                  ? ` · ${genState.usage.totalTokens} token`
                  : ""}
              </p>
            </div>

            <div className="grid gap-3">
              {variants.map((v, i) => (
                <div
                  key={i}
                  className={`rounded-xl border p-4 transition ${
                    usedIndex === i
                      ? "border-violet-400 bg-violet-50 ring-2 ring-violet-200"
                      : "border-gray-200 bg-gray-50 hover:border-violet-300"
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-700">
                      Phương án {i + 1} · {v.angle}
                    </span>
                    <span className="shrink-0 text-xs text-gray-400">
                      {countChars(v.content)} ký tự
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-gray-800">
                    {v.content}
                  </p>
                  {v.hashtags && (
                    <p className="mt-2 text-xs text-blue-600">{v.hashtags}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => applyVariant(i)}
                    className="mt-3 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-700"
                  >
                    {usedIndex === i ? "✓ Đang dùng phương án này" : "Dùng phương án này"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ================= Trình soạn thảo & đăng bài ================= */}
      <div
        ref={editorRef}
        className="scroll-mt-4 rounded-2xl border border-gray-200 bg-white p-5"
      >
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-xl">
            📝
          </span>
          <div>
            <h2 className="font-semibold text-gray-900">Nội dung bài đăng</h2>
            <p className="text-xs text-gray-500">
              Chỉnh sửa lại nội dung AI viết, hoặc tự viết từ đầu
            </p>
          </div>
        </div>

        <form
          action={subAction}
          onSubmit={(e) => {
            const check = validateAttachments(attachments);
            if (!check.ok) {
              e.preventDefault();
              setMediaNotice(check.error);
              return;
            }
            setMediaNotice(null);
            setHideResult(false);
          }}
          className="space-y-4"
        >
          <div>
            <label className={labelCls}>Page đăng bài</label>
            <select
              name="pageId"
              className={selectCls}
              value={pageId}
              onChange={(e) => setPageId(e.target.value)}
            >
              <option value="">— Chưa chọn Page (chỉ lưu nháp) —</option>
              {pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.brandName ? ` — ${p.brandName}` : ""}
                </option>
              ))}
            </select>
            {pages.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">
                Chưa có Page hoạt động — đồng bộ Pages ở trang Facebook Pages để đăng được bài.
              </p>
            )}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className={`${labelCls} mb-0`}>Nội dung</label>
              <span className="text-xs text-gray-400">{chars} ký tự</span>
            </div>
            <textarea
              name="content"
              rows={10}
              className={inputCls}
              placeholder="Nội dung bài đăng... (bấm ✨ Sinh nội dung ở trên để AI viết hộ)"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            {firstLineLong && (
              <p className="mt-1 text-xs text-amber-600">
                ⚠ Dòng đầu dài {firstLine.length} ký tự — Facebook chỉ hiện ~125 ký tự đầu,
                nên đưa ý hấp dẫn nhất lên đầu.
              </p>
            )}
          </div>

          <div>
            <label className={labelCls}>
              Hashtag <span className="text-gray-400">(cách nhau bởi dấu cách)</span>
            </label>
            <input
              name="hashtags"
              type="text"
              className={inputCls}
              placeholder="#marketing #khuyenmai"
              value={hashtags}
              onChange={(e) => setHashtags(e.target.value)}
            />
          </div>

          {/* ================= Tìm media nhanh trên bài viết ================= */}
          <div className="rounded-xl border border-cyan-200 bg-cyan-50/40 p-4">
            <div className="mb-3 flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-100 text-lg">
                🔎
              </span>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Tìm ảnh/video nhanh trên Pexels</h3>
                <p className="text-xs text-gray-500">
                  Gõ từ khóa hoặc để AI gợi ý theo nội dung
                  {selectedBrand ? ` và ngành hàng của "${selectedBrand.name}"` : ""} — bấm ➕ để đính kèm
                </p>
              </div>
            </div>

            {!pexelsReady ? (
              <p className="text-sm text-gray-600">
                Chưa cấu hình Pexels API.{" "}
                <a href="/settings" className="font-medium text-blue-600 underline">
                  Vào Cài đặt
                </a>{" "}
                để nhập API Key (miễn phí).
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    className={`${inputCls} max-w-xs`}
                    placeholder="Ví dụ: curtain, window, interior…"
                    value={quickQuery}
                    onChange={(e) => setQuickQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        runQuickSearch(quickQuery);
                      }
                    }}
                    data-testid="quick-media-input"
                  />
                  <div className="flex overflow-hidden rounded-lg border border-gray-300">
                    <button
                      type="button"
                      onClick={() => setQuickType("IMAGE")}
                      className={`px-3 py-1.5 text-xs font-medium ${
                        quickType === "IMAGE" ? "bg-cyan-600 text-white" : "bg-white text-gray-600"
                      }`}
                    >
                      Ảnh
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuickType("VIDEO")}
                      className={`px-3 py-1.5 text-xs font-medium ${
                        quickType === "VIDEO" ? "bg-cyan-600 text-white" : "bg-white text-gray-600"
                      }`}
                    >
                      Video
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => runQuickSearch(quickQuery)}
                    disabled={quickSearching || !quickQuery.trim()}
                    data-testid="quick-media-search"
                    className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {quickSearching ? "Đang tìm..." : "🔍 Tìm"}
                  </button>
                  <button
                    type="button"
                    onClick={onQuickSuggest}
                    disabled={quickSuggesting}
                    data-testid="quick-suggest-btn"
                    className="rounded-lg border border-violet-300 bg-white px-3 py-2 text-sm font-medium text-violet-700 transition hover:bg-violet-50 disabled:opacity-60"
                    title="AI gợi ý từ khóa tìm ảnh/video theo nội dung bài viết"
                  >
                    {quickSuggesting ? "Đang gợi ý..." : "✨ Gợi ý từ khóa"}
                  </button>
                </div>

                {/* Chips từ khóa AI gợi ý */}
                {quickKw?.error ? (
                  <p className="mt-2 text-sm text-red-600">✗ {quickKw.error}</p>
                ) : null}
                {quickKw?.ok && quickKw.keywords?.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {quickKw.keywords.map((k) => (
                      <button
                        key={k.query}
                        type="button"
                        onClick={() => {
                          setQuickQuery(k.query);
                          runQuickSearch(k.query);
                        }}
                        className="rounded-full border border-cyan-300 bg-white px-3 py-1 text-xs font-medium text-cyan-800 transition hover:bg-cyan-100"
                      >
                        {k.label}
                      </button>
                    ))}
                  </div>
                ) : null}

                {/* Kết quả tìm */}
                {quickResult?.error ? (
                  <p className="mt-3 text-sm text-red-600">✗ {quickResult.error}</p>
                ) : null}
                {quickResult?.ok && quickResult.items?.length ? (
                  <div
                    className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
                    data-testid="quick-media-grid"
                  >
                    {quickResult.items.map((item) => {
                      const itemKey = `${item.type}:${item.id}`;
                      const attached =
                        item.type === "VIDEO"
                          ? videoCount > 0
                          : photoCount >= MAX_PHOTOS_PER_POST || videoCount > 0;
                      const already = attachments.some(
                        (m) => m.providerId === item.id && m.type === item.type
                      );
                      return (
                        <div
                          key={itemKey}
                          className="group relative overflow-hidden rounded-lg border border-gray-200 bg-white"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={item.previewUrl}
                            alt={"alt" in item ? item.alt : ""}
                            className="h-24 w-full object-cover"
                            loading="lazy"
                          />
                          {item.type === "VIDEO" ? (
                            <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                              ▶ {Math.round((item.duration ?? 0) / 60)}:{String((item.duration ?? 0) % 60).padStart(2, "0")}
                            </span>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => quickAdd(item)}
                            disabled={attached}
                            className={`absolute inset-0 flex items-center justify-center bg-black/0 text-2xl font-bold text-white opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100 ${
                              attached ? "cursor-not-allowed bg-black/40 opacity-100" : ""
                            }`}
                            title={
                              already
                                ? "Đã đính kèm trong bài"
                                : attached
                                  ? "Đã đủ số lượng cho phép"
                                  : "Đính kèm vào bài"
                            }
                          >
                            {already ? "✓" : attached ? "✕" : "➕"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {quickResult?.ok && quickResult.items?.length === 0 ? (
                  <p className="mt-3 text-sm text-gray-500">
                    Không tìm thấy kết quả — thử từ khóa khác (Pexels ưu tiên từ khóa tiếng Anh).
                  </p>
                ) : null}
              </>
            )}
          </div>

          <div>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <label className={`${labelCls} mb-0`}>
                Ảnh / video đính kèm{" "}
                <span className="text-gray-400">
                  ({photoCount}/{MAX_PHOTOS_PER_POST} ảnh
                  {videoCount > 0 ? " · 1 video" : ""})
                </span>
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-cyan-700"
                >
                  🖼️ Chọn ảnh/video từ Pexels
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  data-testid="upload-video-btn"
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {uploading ? `⏫ Đang tải ${uploadPct}%` : "⏫ Tải video từ máy"}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm,video/x-msvideo,video/x-matroska"
                  className="hidden"
                  data-testid="upload-video-input"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onUploadVideo(f);
                    // Cho phép chọn lại đúng file đó ở lần sau
                    e.target.value = "";
                  }}
                />
              </div>
            </div>

            {/* Media đã chọn — gửi lên server qua hidden input "media" */}
            <input type="hidden" name="media" value={JSON.stringify(attachments)} />

            {uploading && (
              <div className="mb-2" data-testid="upload-progress">
                <div className="mb-1 flex justify-between text-[11px] text-gray-500">
                  <span>Đang tải video lên máy chủ…</span>
                  <span>{uploadPct}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all"
                    style={{ width: `${uploadPct}%` }}
                  />
                </div>
              </div>
            )}

            {uploadError && (
              <p
                data-testid="upload-error"
                className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
              >
                ⚠ {uploadError}
              </p>
            )}

            {attachments.length === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-300 px-3 py-4 text-center text-xs text-gray-400">
                Chưa chọn media — bấm &quot;Chọn ảnh/video từ Pexels&quot; để tìm ảnh theo từ khóa,
                hoặc &quot;Tải video từ máy&quot; để đăng video của bạn.
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {attachments.map((m) => (
                  <li
                    key={m.remoteUrl}
                    data-testid="tray-item"
                    className="relative overflow-hidden rounded-lg border border-gray-200"
                  >
                    <div className="relative aspect-[4/3] bg-gray-100">
                      {(m.previewUrl ?? (m.type === "IMAGE" ? m.remoteUrl : "")) && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={m.previewUrl ?? m.remoteUrl}
                          alt={m.alt ?? ""}
                          className="h-full w-full object-cover"
                        />
                      )}
                      {m.type === "VIDEO" && (
                        <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] font-medium text-white">
                          ▶ video
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeMedia(m.remoteUrl)}
                      title="Bỏ media này"
                      data-testid="tray-remove"
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs font-bold text-white transition hover:bg-red-600"
                    >
                      ×
                    </button>
                    <p className="truncate px-1.5 py-1 text-[10px] text-gray-500">
                      {m.source === "UPLOAD"
                        ? `${m.alt ?? "Video từ máy"}${
                            m.sizeBytes
                              ? ` · ${(m.sizeBytes / 1024 / 1024).toFixed(1)}MB`
                              : ""
                          }`
                        : `${m.photographer ?? (m.source === "PEXELS" ? "Pexels" : "URL")}${
                            m.width ? ` · ${m.width}×${m.height}` : ""
                          }`}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            {mediaNotice && (
              <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                ⚠ {mediaNotice}
              </p>
            )}
          </div>

          {subState?.error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              ✗ {subState.error}
            </div>
          )}

          {subState?.ok && !hideResult && (
            <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              <p className="font-medium">✓ {subState.message}</p>
              {subState.permalink && (
                <a
                  href={subState.permalink}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-xs underline"
                >
                  Xem bài trên Facebook →
                </a>
              )}
              {subState.kind === "publish" && (
                <button
                  type="button"
                  onClick={startNewPost}
                  className="mt-2 block rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  ✍️ Soạn bài mới
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              name="intent"
              value="draft"
              disabled={subPending || !content.trim()}
              className="rounded-lg border border-gray-300 px-5 py-2.5 font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {subPending ? "Đang xử lý..." : "💾 Lưu nháp"}
            </button>
            <button
              type="submit"
              name="intent"
              value="publish"
              disabled={subPending || pages.length === 0 || !content.trim()}
              className="rounded-lg bg-blue-600 px-5 py-2.5 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {subPending ? "Đang đăng lên Facebook..." : "🚀 Đăng ngay"}
            </button>
          </div>

          {/* ---------- Hẹn giờ đăng ---------- */}
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
            <p className="mb-2 text-xs font-semibold text-amber-900">
              ⏰ Hoặc hẹn giờ để hệ thống tự đăng
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="datetime-local"
                name="scheduledAt"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                data-testid="schedule-input"
                className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
              />
              <button
                type="submit"
                name="intent"
                value="schedule"
                disabled={subPending || pages.length === 0 || !content.trim() || !scheduledAt}
                data-testid="schedule-submit"
                title={
                  pages.length === 0
                    ? "Chọn Page trước"
                    : !content.trim()
                      ? "Nhập nội dung trước"
                      : !scheduledAt
                        ? "Chọn thời gian hẹn trước"
                        : ""
                }
                className="rounded-lg bg-amber-600 px-5 py-2.5 font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {subPending ? "Đang lưu..." : "⏰ Hẹn đăng"}
              </button>

              {/* Gợi ý nhanh cho các khung giờ hay dùng */}
              {QUICK_SCHEDULES.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => setScheduledAt(toLocalInputValue(q.at()))}
                  className="rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs font-medium text-amber-800 transition hover:bg-amber-100"
                >
                  {q.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-amber-800">
              Cần chạy worker để tự đăng: <code className="rounded bg-white px-1">npm run worker</code>.
              Trạng thái worker xem ở trang Lịch đăng.
            </p>
          </div>
        </form>
      </div>

      {/* ================= Modal chọn media Pexels ================= */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <div className="my-8 w-full max-w-4xl rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-100 text-xl">
                  🖼️
                </span>
                <div>
                  <h2 className="font-semibold text-gray-900">Chọn ảnh/video từ Pexels</h2>
                  <p className="text-xs text-gray-500">
                    Ảnh miễn phí bản quyền — chọn tối đa {MAX_PHOTOS_PER_POST} ảnh hoặc 1 video
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-gray-500 transition hover:bg-gray-100"
              >
                ✕
              </button>
            </div>

            <MediaBrowser
              mode="pick"
              pexelsReady={pexelsReady}
              postContent={content}
              savedProviderIds={libraryProviderIds}
              existingCounts={{ photos: photoCount, videos: videoCount }}
              onAdd={addMedia}
              onClose={() => setPickerOpen(false)}
            />
          </div>
        </div>
      )}

      {/* ================= Nháp & lịch sử ================= */}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
            <h2 className="font-semibold text-gray-900">Bản nháp</h2>
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
              {drafts.length}
            </span>
          </div>
          {drafts.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-gray-500">
              Chưa có bản nháp nào.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {drafts.map((d) => (
                <li key={d.id} className="px-5 py-3">
                  <p className="line-clamp-2 text-sm text-gray-900">{d.content}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {d.pageName ?? "Chưa chọn Page"} ·{" "}
                    {new Date(d.updatedAt).toLocaleString("vi-VN")}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => onEditDraft(d.id)}
                      disabled={loadingDraft}
                      className="rounded-lg border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                    >
                      {loadingDraft ? "Đang mở..." : "✏️ Sửa"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDeletePost(d.id)}
                      disabled={deletingId === d.id}
                      className="rounded-lg border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
                    >
                      {deletingId === d.id ? "Đang xóa..." : "Xóa"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-5 py-4">
            <h2 className="font-semibold text-gray-900">Lịch sử gần đây</h2>
          </div>
          {history.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-gray-500">
              Chưa đăng bài nào.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {history.map((post) => {
                const badge = badgeOf(post.status);
                return (
                  <li key={post.id} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                        {post.content || "(không có nội dung)"}
                      </p>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {post.pageName ?? "—"} ·{" "}
                      {new Date(post.createdAt).toLocaleString("vi-VN")}
                    </p>
                    {post.permalink && (
                      <a
                        href={post.permalink}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-xs text-blue-600 underline"
                      >
                        Xem trên Facebook →
                      </a>
                    )}
                    {post.errorMessage && (
                      <p className="mt-1 rounded bg-red-50 px-2 py-1 font-mono text-xs text-red-600">
                        {post.errorMessage.slice(0, 160)}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
