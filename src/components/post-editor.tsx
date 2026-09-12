"use client";

import { APP_TIME_ZONE } from "@/lib/format-date";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useMemo, useState, useTransition } from "react";
import {
  deletePostFromDetail,
  regeneratePostContent,
  regeneratePostMedia,
  updatePostContent,
  updatePostMedia,
  type PostEditState,
} from "@/app/actions/post-detail";
import { approvePlannedPost } from "@/app/actions/autopilot";
import MediaBrowser from "@/components/media-browser";
import {
  analyzeReadability,
  statusBadgeOf,
  validateAttachments,
  type AttachedMedia,
} from "@/lib/posts";

// ============================================================
// Trang chi tiết + chỉnh sửa bài viết.
//
// Vì sao cần trang này: chế độ tự động viết bài thay người dùng, nhưng
// AI không phải lúc nào cũng viết đúng ý. Trước đây muốn sửa phải vào
// tận database. Ở đây người dùng xem bài đúng như nó sẽ hiện trên
// Facebook, sửa chữ, đổi ảnh, đổi giờ rồi duyệt — tất cả trong một chỗ.
// ============================================================

const btnPrimary =
  "rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60";
const btnGhost =
  "rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";
const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none";

export type PostView = {
  id: string;
  content: string;
  hook: string | null;
  hashtags: string | null;
  status: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  origin: string;
  pillarName: string | null;
  topic: string | null;
  errorMessage: string | null;
  attempts: number;
  fbPostId: string | null;
  pageName: string | null;
};

function Alert({ state, testId }: { state: PostEditState; testId?: string }) {
  if (!state || (!state.ok && !state.error)) return null;
  return (
    <div
      data-testid={testId}
      className={`rounded-lg px-3 py-2 text-sm ${
        state.error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
      }`}
    >
      {state.error ? `✗ ${state.error}` : `✓ ${state.message}`}
    </div>
  );
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN", {
    timeZone: APP_TIME_ZONE,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Đổi ISO sang giá trị cho <input type="datetime-local"> (giờ địa phương). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ============================================================
// Xem trước như trên Facebook
// ============================================================

function FacebookPreview({
  pageName,
  content,
  hashtags,
  media,
}: {
  pageName: string | null;
  content: string;
  hashtags: string | null;
  media: AttachedMedia[];
}) {
  const photos = media.filter((m) => m.type === "IMAGE");
  const videos = media.filter((m) => m.type === "VIDEO");

  return (
    <div
      className="overflow-hidden rounded-xl border border-gray-200 bg-white"
      data-testid="post-preview"
    >
      <div className="flex items-center gap-2 border-b border-gray-100 p-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">
          {(pageName ?? "?").slice(0, 1).toUpperCase()}
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-900">{pageName ?? "Chưa gắn Page"}</p>
          <p className="text-xs text-gray-500">Xem trước · chỉ bạn thấy</p>
        </div>
      </div>

      <div className="p-3">
        <p className="text-sm whitespace-pre-wrap text-gray-900">{content}</p>
        {hashtags ? <p className="mt-2 text-sm text-blue-600">{hashtags}</p> : null}
      </div>

      {videos.length > 0 ? (
        <div className="bg-black">
          <video
            src={videos[0].remoteUrl}
            poster={videos[0].previewUrl}
            controls
            className="max-h-96 w-full"
            data-testid="preview-video"
          />
        </div>
      ) : photos.length > 0 ? (
        <div
          className={`grid gap-0.5 ${photos.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}
          data-testid="preview-photos"
        >
          {photos.map((m, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${m.remoteUrl}-${i}`}
              src={m.previewUrl || m.remoteUrl}
              alt={m.alt ?? `Ảnh ${i + 1}`}
              className="h-44 w-full object-cover"
            />
          ))}
        </div>
      ) : (
        <p className="border-t border-gray-100 p-3 text-xs text-gray-400">
          Bài này chưa có ảnh — sẽ đăng dạng chỉ có chữ.
        </p>
      )}
    </div>
  );
}

// ============================================================
// Component chính
// ============================================================

export default function PostEditor({
  post,
  media: initialMedia,
  pexelsReady,
}: {
  post: PostView;
  media: AttachedMedia[];
  pexelsReady: boolean;
}) {
  const [content, setContent] = useState(post.content);
  const [hashtags, setHashtags] = useState(post.hashtags ?? "");
  const [media, setMedia] = useState<AttachedMedia[]>(initialMedia);
  const [picker, setPicker] = useState(false);
  const [notice, setNotice] = useState<PostEditState>(null);

  const router = useRouter();
  const [saveState, saveAction, saving] = useActionState(updatePostContent, null);
  const [mediaState, mediaAction, savingMedia] = useActionState(updatePostMedia, null);
  const [busy, startTransition] = useTransition();

  const badge = statusBadgeOf(post.status);
  const locked = post.status === "PUBLISHED" || post.status === "PUBLISHING";

  // Chấm điểm dễ đọc — tính lại mỗi khi người dùng gõ
  const report = useMemo(() => analyzeReadability(content), [content]);
  const mediaCheck = useMemo(() => validateAttachments(media), [media]);

  const run = (fn: () => Promise<PostEditState>) =>
    startTransition(async () => {
      setNotice(await fn());
    });

  const photos = media.filter((m) => m.type === "IMAGE").length;
  const videos = media.filter((m) => m.type === "VIDEO").length;

  const moveMedia = (from: number, to: number) => {
    if (to < 0 || to >= media.length) return;
    const next = [...media];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setMedia(next);
  };

  return (
    <div className="space-y-4" data-testid="post-editor" data-status={post.status}>
      {/* ---- Thông tin đầu trang ---- */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge.cls}`}>
            {badge.label}
          </span>
          {post.origin === "AUTOPILOT" ? (
            <span
              className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700"
              data-testid="post-autopilot"
            >
              🤖 Bài tự động
            </span>
          ) : (
            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600">
              ✍️ Soạn tay
            </span>
          )}
          {post.pillarName ? (
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-700">
              {post.pillarName}
            </span>
          ) : null}
        </div>

        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-gray-500">Trang</dt>
            <dd className="font-medium text-gray-900">{post.pageName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">
              {post.status === "PUBLISHED" ? "Đã đăng lúc" : "Hẹn đăng lúc"}
            </dt>
            <dd className="font-medium text-gray-900" data-testid="post-when">
              {formatWhen(post.publishedAt ?? post.scheduledAt)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Góc tiếp cận</dt>
            <dd className="font-medium text-gray-900">{post.topic ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Số lần thử đăng</dt>
            <dd className="font-medium text-gray-900">{post.attempts}</dd>
          </div>
        </dl>

        {post.errorMessage ? (
          <p
            className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
            data-testid="post-error"
          >
            ✗ {post.errorMessage}
          </p>
        ) : null}

        {post.fbPostId ? (
          <a
            href={`https://www.facebook.com/${post.fbPostId.replace("_", "/posts/")}`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block text-sm text-blue-600 hover:underline"
            data-testid="post-permalink"
          >
            Xem bài trên Facebook ↗
          </a>
        ) : null}
      </div>

      {notice ? <Alert state={notice} testId="post-notice" /> : null}

      {locked ? (
        <div
          className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"
          data-testid="post-locked"
        >
          {post.status === "PUBLISHING"
            ? "Bài đang được đăng lên Facebook — không sửa được lúc này."
            : "Bài đã đăng lên Facebook nên không sửa được ở đây. Muốn đổi nội dung, hãy sửa trực tiếp trên Facebook."}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---- Cột trái: sửa ---- */}
        <div className="space-y-4">
          <form action={saveAction} className="rounded-xl border border-gray-200 bg-white p-5">
            <input type="hidden" name="postId" value={post.id} />

            <h3 className="text-sm font-semibold text-gray-900">Nội dung bài viết</h3>

            <textarea
              name="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={12}
              disabled={locked}
              className={`${inputCls} mt-2 font-mono`}
              data-testid="post-content"
            />

            <div className="mt-1 flex items-center justify-between text-xs">
              <span className="text-gray-500" data-testid="post-charcount">
                {report.chars} ký tự · {report.paragraphs} đoạn
              </span>
              {report.ok ? (
                <span className="text-emerald-600" data-testid="post-readable">
                  ✓ Dễ đọc trên điện thoại
                </span>
              ) : (
                <span className="text-amber-600">{report.issues.length} điểm cần cải thiện</span>
              )}
            </div>

            {/* Gợi ý cải thiện — lý do cụ thể, không phải điểm số mơ hồ */}
            {report.issues.length > 0 ? (
              <ul className="mt-2 space-y-1" data-testid="post-issues">
                {report.issues.map((issue) => (
                  <li
                    key={issue.code}
                    data-issue={issue.code}
                    className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800"
                  >
                    {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}

            <label className="mt-4 block text-sm font-medium text-gray-700">Hashtag</label>
            <input
              name="hashtags"
              value={hashtags}
              onChange={(e) => setHashtags(e.target.value)}
              disabled={locked}
              placeholder="#remcua #binhduong"
              className={`${inputCls} mt-1`}
              data-testid="post-hashtags"
            />

            {post.status !== "PUBLISHED" ? (
              <>
                <label className="mt-4 block text-sm font-medium text-gray-700">
                  Thời gian đăng
                </label>
                <input
                  type="datetime-local"
                  name="scheduledAt"
                  defaultValue={toLocalInput(post.scheduledAt)}
                  disabled={locked}
                  className={`${inputCls} mt-1`}
                  data-testid="post-scheduledAt"
                />
              </>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="submit"
                className={btnPrimary}
                disabled={saving || locked}
                data-testid="post-save"
              >
                {saving ? "Đang lưu…" : "Lưu thay đổi"}
              </button>

              <button
                type="button"
                className={btnGhost}
                disabled={busy || locked}
                data-testid="post-regenerate"
                onClick={() => {
                  if (confirm("AI sẽ viết lại bài này theo góc khác. Nội dung hiện tại sẽ bị thay. Tiếp tục?")) {
                    run(() => regeneratePostContent(post.id));
                  }
                }}
              >
                ✨ Nhờ AI viết lại
              </button>
            </div>

            <div className="mt-3">
              <Alert state={saveState} testId="post-save-notice" />
            </div>
          </form>

          {/* ---- Ảnh / video ---- */}
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-900">
                Ảnh / video ({media.length})
              </h3>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={btnGhost}
                  disabled={locked || !pexelsReady}
                  data-testid="post-pick-media"
                  onClick={() => setPicker((v) => !v)}
                  title={pexelsReady ? "" : "Chưa cấu hình Pexels API Key"}
                >
                  {picker ? "Đóng kho ảnh" : "🖼 Chọn ảnh khác"}
                </button>
                <button
                  type="button"
                  className={btnGhost}
                  disabled={busy || locked || !pexelsReady}
                  data-testid="post-refind-media"
                  onClick={() => run(() => regeneratePostMedia(post.id))}
                >
                  {busy ? "Đang tìm…" : "🔄 AI tìm ảnh khác"}
                </button>
              </div>
            </div>

            {!mediaCheck.ok ? (
              <p
                className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
                data-testid="post-media-error"
              >
                ✗ {mediaCheck.error}
              </p>
            ) : null}

            {media.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
                Chưa có ảnh nào. Bài sẽ đăng dạng chỉ có chữ.
              </p>
            ) : (
              <ul className="mt-3 space-y-2" data-testid="post-media-list">
                {media.map((m, i) => (
                  <li
                    key={`${m.remoteUrl}-${i}`}
                    data-testid="post-media-item"
                    data-type={m.type}
                    className="flex items-center gap-3 rounded-lg border border-gray-200 p-2"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={m.previewUrl || m.remoteUrl}
                      alt={m.alt ?? ""}
                      className="h-14 w-20 rounded object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs text-gray-700">
                        {m.type === "VIDEO" ? "🎬 Video" : "🖼 Ảnh"}
                        {m.photographer ? ` · ${m.photographer}` : ""}
                      </p>
                      <p className="truncate text-xs text-gray-400">{m.remoteUrl}</p>
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className={btnGhost}
                        disabled={locked || i === 0}
                        onClick={() => moveMedia(i, i - 1)}
                        title="Lên trên"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className={btnGhost}
                        disabled={locked || i === media.length - 1}
                        onClick={() => moveMedia(i, i + 1)}
                        title="Xuống dưới"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className={`${btnGhost} text-red-600`}
                        disabled={locked}
                        data-testid="post-media-remove"
                        onClick={() => setMedia(media.filter((_, idx) => idx !== i))}
                      >
                        Xóa
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* Lưu media qua form riêng để không đụng tới nội dung đang gõ dở */}
            <form action={mediaAction} className="mt-3">
              <input type="hidden" name="postId" value={post.id} />
              <input type="hidden" name="media" value={JSON.stringify(media)} />
              <button
                type="submit"
                className={btnPrimary}
                disabled={savingMedia || locked || !mediaCheck.ok}
                data-testid="post-save-media"
              >
                {savingMedia ? "Đang lưu…" : "Lưu danh sách ảnh"}
              </button>
              <div className="mt-2">
                <Alert state={mediaState} testId="post-media-notice" />
              </div>
            </form>

            {picker ? (
              <div className="mt-4 border-t border-gray-200 pt-4">
                <MediaBrowser
                  mode="pick"
                  postContent={content}
                  pexelsReady={pexelsReady}
                  existingCounts={{ photos, videos }}
                  onAdd={(items) => setMedia([...media, ...items])}
                  onClose={() => setPicker(false)}
                />
              </div>
            ) : null}
          </div>
        </div>

        {/* ---- Cột phải: xem trước + hành động ---- */}
        <div className="space-y-4">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-900">
              Bài sẽ trông như thế này
            </h3>
            <FacebookPreview
              pageName={post.pageName}
              content={content}
              hashtags={hashtags}
              media={media}
            />
          </div>

          {!locked ? (
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-gray-900">Hành động</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {post.status === "PENDING_REVIEW" ? (
                  <button
                    type="button"
                    className={`${btnPrimary} bg-emerald-600 hover:bg-emerald-700`}
                    disabled={busy}
                    data-testid="post-approve"
                    onClick={() =>
                      run(async () => {
                        const r = await approvePlannedPost(post.id);
                        return r as PostEditState;
                      })
                    }
                  >
                    ✓ Duyệt & cho đăng
                  </button>
                ) : null}

                <Link href="/calendar" className={btnGhost}>
                  Xem trên lịch
                </Link>

                <button
                  type="button"
                  className={`${btnGhost} text-red-600`}
                  disabled={busy}
                  data-testid="post-delete"
                  onClick={() => {
                    if (confirm("Xóa hẳn bài này? Không khôi phục được.")) {
                      run(async () => {
                        const r = await deletePostFromDetail(post.id);
                        // Bài không còn tồn tại → quay về danh sách
                        if (r?.ok) router.push("/autopilot");
                        return r;
                      });
                    }
                  }}
                >
                  Xóa bài
                </button>
              </div>

              <p className="mt-3 text-xs text-gray-500">
                Nhớ bấm “Lưu thay đổi” trước khi duyệt — nội dung đang sửa chưa được lưu tự động.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
