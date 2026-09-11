"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import {
  approveAllPlanned,
  approvePlannedPost,
  clearPlannedPosts,
  discardPlannedPost,
  runPlannerNowAction,
  saveAutoPilot,
  toggleAutoPilot,
  type AutoPilotState,
} from "@/app/actions/autopilot";
import { TONES } from "@/lib/ai-prompts";
import { videoQuotaForDay } from "@/lib/autopilot-plan";
import { statusBadgeOf } from "@/lib/posts";

// ============================================================
// Bảng điều khiển chế độ tự động.
//
// Nguyên tắc thiết kế: người dùng chỉ phải trả lời 3 câu hỏi ở khối đầu
// (mỗi ngày mấy bài? đăng từ mấy giờ tới mấy giờ? có tự tìm ảnh không?).
// Mọi thứ còn lại nằm trong phần "Tùy chọn nâng cao" gấp lại được.
// ============================================================

const inputCls =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none";
const labelCls = "block text-sm font-medium text-gray-700";
const hintCls = "mt-1 text-xs text-gray-500";
const btnPrimary =
  "rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60";
const btnGhost =
  "rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";

const DAYS = [
  { value: 1, label: "T2" },
  { value: 2, label: "T3" },
  { value: 3, label: "T4" },
  { value: 4, label: "T5" },
  { value: 5, label: "T6" },
  { value: 6, label: "T7" },
  { value: 7, label: "CN" },
];

export type AutoPilotConfigView = {
  enabled: boolean;
  mode: string;
  postsPerDay: number;
  windowStart: string;
  windowEnd: string;
  daysOfWeek: string;
  minGapMinutes: number;
  autoMedia: boolean;
  mediaKind: string;
  mediaMix: string;
  videoPercent: number;
  photosPerPost: number;
  length: string;
  toneOverride: string | null;
  useHashtags: boolean;
  planAheadDays: number;
  lastPlannedAt: string | null;
  lastPlanError: string | null;
  totalPlanned: number;
} | null;

export type PlannedPost = {
  id: string;
  content: string;
  status: string;
  scheduledAt: string;
  pillarName: string | null;
  topic: string | null;
  mediaCount: number;
};

function Alert({ state, testId }: { state: AutoPilotState; testId?: string }) {
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

function formatWhen(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ============================================================
// Công tắc bật/tắt
// ============================================================

function PowerSwitch({
  pageId,
  enabled,
  hasConfig,
}: {
  pageId: string;
  enabled: boolean;
  hasConfig: boolean;
}) {
  const [notice, setNotice] = useState<AutoPilotState>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div
      className={`rounded-xl border p-5 ${
        enabled ? "border-emerald-200 bg-emerald-50" : "border-gray-200 bg-white"
      }`}
      data-testid="autopilot-power"
      data-enabled={enabled ? "1" : "0"}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-base font-semibold text-gray-900" data-testid="autopilot-state">
            {enabled ? "🟢 Chế độ tự động ĐANG BẬT" : "⚪ Chế độ tự động đang TẮT"}
          </p>
          <p className="mt-1 text-sm text-gray-600">
            {enabled
              ? "Hệ thống tự viết nội dung, tự tìm ảnh và đăng theo lịch bạn đặt."
              : hasConfig
                ? "Bật lên để hệ thống bắt đầu tự làm thay bạn."
                : "Lưu thông số bên dưới trước, rồi bật."}
          </p>
        </div>

        <button
          type="button"
          data-testid="autopilot-toggle"
          disabled={pending || !hasConfig}
          onClick={() =>
            startTransition(async () => {
              setNotice(await toggleAutoPilot(pageId, !enabled));
            })
          }
          className={`rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition disabled:opacity-60 ${
            enabled ? "bg-gray-600 hover:bg-gray-700" : "bg-emerald-600 hover:bg-emerald-700"
          }`}
        >
          {pending ? "Đang xử lý…" : enabled ? "Tắt tự động" : "Bật tự động"}
        </button>
      </div>

      {notice ? (
        <div className="mt-3">
          <Alert state={notice} testId="autopilot-toggle-notice" />
        </div>
      ) : null}
    </div>
  );
}

// ============================================================
// Form thông số
// ============================================================

function SettingsForm({
  pageId,
  config,
}: {
  pageId: string;
  config: AutoPilotConfigView;
}) {
  const [state, action, pending] = useActionState(saveAutoPilot, null);
  const [advanced, setAdvanced] = useState(false);
  const [autoMedia, setAutoMedia] = useState(config?.autoMedia ?? true);
  const [mediaMix, setMediaMix] = useState(config?.mediaMix ?? "IMAGE_ONLY");
  const [videoPercent, setVideoPercent] = useState(config?.videoPercent ?? 25);
  // Điều khiển được để hiện ngay dòng xem trước "mỗi ngày mấy bài video"
  const [postsPerDay, setPostsPerDay] = useState(config?.postsPerDay ?? 2);

  // Dùng đúng hàm mà bộ lập kế hoạch dùng → con số xem trước khớp thực tế
  const videoCount = videoQuotaForDay(postsPerDay, videoPercent);

  const activeDays = new Set(
    (config?.daysOfWeek ?? "1,2,3,4,5,6,7").split(",").map((d) => Number(d.trim()))
  );
  const [days, setDays] = useState<Set<number>>(activeDays);

  const toggleDay = (d: number) => {
    const next = new Set(days);
    if (next.has(d)) {
      if (next.size > 1) next.delete(d); // luôn giữ ít nhất 1 ngày
    } else {
      next.add(d);
    }
    setDays(next);
  };

  return (
    <form action={action} className="space-y-6 rounded-xl border border-gray-200 bg-white p-5">
      <input type="hidden" name="pageId" value={pageId} />
      {/* mediaKind cũ vẫn gửi lên để tương thích; mediaMix mới quyết định */}
      <input type="hidden" name="mediaKind" value={mediaMix === "VIDEO_ONLY" ? "VIDEO" : "IMAGE"} />
      <input
        type="hidden"
        name="daysOfWeek"
        value={Array.from(days).sort((a, b) => a - b).join(",")}
      />

      <Alert state={state} testId="autopilot-save-alert" />

      {/* ---- 3 câu hỏi chính ---- */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Thông số cơ bản</h3>
        <p className={hintCls}>Chỉ cần trả lời 3 câu này là chạy được.</p>

        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <label className={labelCls} htmlFor="ap-postsPerDay">
              Mỗi ngày đăng mấy bài?
            </label>
            <input
              id="ap-postsPerDay"
              name="postsPerDay"
              type="number"
              min={1}
              max={10}
              data-testid="ap-postsPerDay"
              value={postsPerDay}
              onChange={(e) => setPostsPerDay(Number(e.target.value) || 1)}
              className={`${inputCls} mt-1`}
            />
            <p className={hintCls}>1–10 bài. Khuyên dùng 1–3.</p>
          </div>

          <div>
            <label className={labelCls} htmlFor="ap-windowStart">
              Đăng từ lúc nào?
            </label>
            <input
              id="ap-windowStart"
              name="windowStart"
              type="time"
              data-testid="ap-windowStart"
              defaultValue={config?.windowStart ?? "07:00"}
              className={`${inputCls} mt-1`}
            />
          </div>

          <div>
            <label className={labelCls} htmlFor="ap-windowEnd">
              Đến lúc nào?
            </label>
            <input
              id="ap-windowEnd"
              name="windowEnd"
              type="time"
              data-testid="ap-windowEnd"
              defaultValue={config?.windowEnd ?? "21:00"}
              className={`${inputCls} mt-1`}
            />
          </div>
        </div>

        <p className={`${hintCls} mt-2`}>
          Giờ đăng được rải ngẫu nhiên trong khung này, mỗi ngày một khác — trông tự nhiên
          hơn là đăng đúng giờ cố định.
        </p>
      </div>

      {/* ---- Ngày trong tuần ---- */}
      <div>
        <span className={labelCls}>Những ngày nào trong tuần?</span>
        <div className="mt-2 flex flex-wrap gap-2" data-testid="ap-days">
          {DAYS.map((d) => (
            <button
              key={d.value}
              type="button"
              data-testid={`ap-day-${d.value}`}
              data-active={days.has(d.value) ? "1" : "0"}
              onClick={() => toggleDay(d.value)}
              className={`h-10 w-12 rounded-lg text-sm font-medium transition ${
                days.has(d.value)
                  ? "bg-blue-600 text-white"
                  : "border border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      {/* ---- Tự tìm ảnh ---- */}
      <div>
        <span className={labelCls}>Có tự tìm hình không?</span>
        <div className="mt-2 space-y-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              name="autoMedia"
              value="1"
              data-testid="ap-autoMedia"
              checked={autoMedia}
              onChange={(e) => setAutoMedia(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            Tự tìm ảnh/video trên Pexels cho mỗi bài
          </label>

          {autoMedia ? (
            <div className="ml-6 space-y-3">
              <div>
                <label className={labelCls} htmlFor="ap-mediaMix">
                  Dùng ảnh hay video?
                </label>
                <select
                  id="ap-mediaMix"
                  name="mediaMix"
                  data-testid="ap-mediaMix"
                  value={mediaMix}
                  onChange={(e) => setMediaMix(e.target.value)}
                  className={`${inputCls} mt-1`}
                >
                  <option value="IMAGE_ONLY">Chỉ ảnh</option>
                  <option value="VIDEO_ONLY">Chỉ video</option>
                  <option value="MIXED">Xen kẽ ảnh và video</option>
                </select>
                <p className={hintCls}>
                  Facebook không cho đăng chung ảnh và video trong cùng một bài, nên “xen kẽ”
                  nghĩa là luân phiên giữa các bài.
                </p>
              </div>

              {/* Tỉ lệ video — chỉ hiện khi chọn xen kẽ */}
              {mediaMix === "MIXED" ? (
                <div data-testid="ap-mix-panel">
                  <label className={labelCls} htmlFor="ap-videoPercent">
                    Bao nhiêu phần trăm là video? ({videoPercent}%)
                  </label>
                  <input
                    id="ap-videoPercent"
                    name="videoPercent"
                    type="range"
                    min={10}
                    max={90}
                    step={5}
                    value={videoPercent}
                    onChange={(e) => setVideoPercent(Number(e.target.value))}
                    className="mt-2 w-full"
                    data-testid="ap-videoPercent"
                  />
                  <p className={hintCls} data-testid="ap-mix-preview">
                    Mỗi ngày khoảng <strong>{videoCount}</strong> bài video và{" "}
                    <strong>{postsPerDay - videoCount}</strong> bài ảnh.
                  </p>
                </div>
              ) : null}

              {mediaMix !== "VIDEO_ONLY" ? (
                <div>
                  <label className={labelCls} htmlFor="ap-photosPerPost">
                    Số ảnh mỗi bài
                  </label>
                  <input
                    id="ap-photosPerPost"
                    name="photosPerPost"
                    type="number"
                    min={1}
                    max={4}
                    defaultValue={config?.photosPerPost ?? 2}
                    className={`${inputCls} mt-1`}
                  />
                  <p className={hintCls}>Facebook cho tối đa 4 ảnh, hoặc 1 video.</p>
                </div>
              ) : null}
            </div>
          ) : (
            <p className={`${hintCls} ml-6`}>Bài sẽ chỉ có chữ, không kèm ảnh.</p>
          )}
        </div>
      </div>

      {/* ---- Chế độ duyệt ---- */}
      <div>
        <span className={labelCls}>Đăng thẳng hay chờ bạn duyệt?</span>
        <div className="mt-2 space-y-2">
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 p-3 text-sm">
            <input
              type="radio"
              name="mode"
              value="REVIEW"
              data-testid="ap-mode-review"
              defaultChecked={(config?.mode ?? "REVIEW") === "REVIEW"}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-gray-900">Chờ duyệt</span>
              <span className="block text-xs text-gray-500">
                Hệ thống viết sẵn, bạn xem rồi bấm duyệt mới đăng. An toàn — nên dùng
                trong vài ngày đầu.
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 p-3 text-sm">
            <input
              type="radio"
              name="mode"
              value="AUTO"
              data-testid="ap-mode-auto"
              defaultChecked={config?.mode === "AUTO"}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-gray-900">Đăng thẳng</span>
              <span className="block text-xs text-gray-500">
                Hoàn toàn tự động, không cần bạn làm gì. Bài vẫn hiện ở Lịch đăng trước
                giờ đăng nên bạn sửa hoặc xóa kịp.
              </span>
            </span>
          </label>
        </div>
      </div>

      {/* ---- Nâng cao ---- */}
      <div className="border-t border-gray-200 pt-4">
        <button
          type="button"
          data-testid="ap-advanced-toggle"
          onClick={() => setAdvanced(!advanced)}
          className="text-sm font-medium text-blue-600 hover:underline"
        >
          {advanced ? "▾ Ẩn tùy chọn nâng cao" : "▸ Tùy chọn nâng cao"}
        </button>

        {advanced ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="ap-minGap">
                Cách nhau tối thiểu (phút)
              </label>
              <input
                id="ap-minGap"
                name="minGapMinutes"
                type="number"
                min={30}
                max={720}
                step={30}
                data-testid="ap-minGap"
                defaultValue={config?.minGapMinutes ?? 120}
                className={`${inputCls} mt-1`}
              />
              <p className={hintCls}>Tránh 2 bài dính sát nhau.</p>
            </div>

            <div>
              <label className={labelCls} htmlFor="ap-planAhead">
                Lên kế hoạch trước (ngày)
              </label>
              <input
                id="ap-planAhead"
                name="planAheadDays"
                type="number"
                min={1}
                max={7}
                defaultValue={config?.planAheadDays ?? 2}
                className={`${inputCls} mt-1`}
              />
              <p className={hintCls}>Càng nhiều ngày càng dễ xem trước, nhưng tốn AI sớm hơn.</p>
            </div>

            <div>
              <label className={labelCls} htmlFor="ap-length">
                Độ dài bài
              </label>
              <select
                id="ap-length"
                name="length"
                defaultValue={config?.length ?? "medium"}
                className={`${inputCls} mt-1`}
              >
                <option value="short">Ngắn</option>
                <option value="medium">Vừa</option>
                <option value="long">Dài</option>
              </select>
            </div>

            <div>
              <label className={labelCls} htmlFor="ap-tone">
                Giọng điệu
              </label>
              <select
                id="ap-tone"
                name="toneOverride"
                defaultValue={config?.toneOverride ?? ""}
                className={`${inputCls} mt-1`}
              >
                <option value="">Theo hồ sơ thương hiệu</option>
                {TONES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                name="useHashtags"
                value="1"
                defaultChecked={config?.useHashtags ?? true}
                className="h-4 w-4 rounded border-gray-300"
              />
              Thêm hashtag vào bài
            </label>
          </div>
        ) : null}
      </div>

      <button type="submit" className={btnPrimary} disabled={pending} data-testid="ap-save">
        {pending ? "Đang lưu…" : "Lưu thông số"}
      </button>
    </form>
  );
}

// ============================================================
// Kế hoạch sắp tới
// ============================================================

function PlanPreview({
  pageId,
  posts,
  enabled,
  pendingReview,
}: {
  pageId: string;
  posts: PlannedPost[];
  enabled: boolean;
  pendingReview: number;
}) {
  const [notice, setNotice] = useState<AutoPilotState>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<AutoPilotState>) =>
    startTransition(async () => {
      setNotice(await fn());
    });

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Kế hoạch sắp tới</h3>
          <p className={hintCls}>
            {posts.length > 0
              ? `${posts.length} bài đã sẵn sàng${pendingReview > 0 ? ` · ${pendingReview} bài chờ bạn duyệt` : ""}`
              : "Chưa có bài nào được lên kế hoạch."}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={btnGhost}
            data-testid="ap-plan-now"
            disabled={pending || !enabled}
            onClick={() => run(() => runPlannerNowAction(pageId))}
            title={enabled ? "" : "Bật chế độ tự động trước"}
          >
            {pending ? "Đang chạy…" : "🔄 Lên kế hoạch ngay"}
          </button>

          {pendingReview > 0 ? (
            <button
              type="button"
              className={`${btnGhost} border-emerald-300 text-emerald-700`}
              data-testid="ap-approve-all"
              disabled={pending}
              onClick={() => run(() => approveAllPlanned(pageId))}
            >
              ✓ Duyệt tất cả ({pendingReview})
            </button>
          ) : null}

          {posts.length > 0 ? (
            <button
              type="button"
              className={`${btnGhost} text-red-600`}
              data-testid="ap-clear"
              disabled={pending}
              onClick={() => {
                if (confirm("Xóa toàn bộ bài chưa đăng và lên kế hoạch lại từ đầu?")) {
                  run(() => clearPlannedPosts(pageId));
                }
              }}
            >
              Xóa hết & làm lại
            </button>
          ) : null}
        </div>
      </div>

      {notice ? (
        <div className="mt-3">
          <Alert state={notice} testId="ap-plan-notice" />
        </div>
      ) : null}

      {posts.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          {enabled
            ? "Hệ thống sẽ tự tạo bài trong vài phút tới. Hoặc bấm “Lên kế hoạch ngay”."
            : "Bật chế độ tự động để hệ thống bắt đầu tạo bài."}
        </p>
      ) : (
        <ul className="mt-4 space-y-2" data-testid="ap-plan-list">
          {posts.map((p) => {
            const badge = statusBadgeOf(p.status);
            return (
              <li
                key={p.id}
                data-testid="ap-plan-item"
                data-status={p.status}
                className="rounded-lg border border-gray-200 p-3"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`rounded-full px-2 py-0.5 font-medium ${badge.cls}`}>
                    {badge.label}
                  </span>
                  <span className="font-medium text-gray-700" data-testid="ap-plan-when">
                    {formatWhen(p.scheduledAt)}
                  </span>
                  {p.pillarName ? (
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">
                      {p.pillarName}
                    </span>
                  ) : null}
                  {p.mediaCount > 0 ? (
                    <span className="text-gray-500">🖼 {p.mediaCount}</span>
                  ) : null}
                </div>

                <p className="mt-2 line-clamp-3 text-sm whitespace-pre-wrap text-gray-800">
                  {p.content}
                </p>

                <div className="mt-2 flex gap-2">
                  <Link href={`/posts/${p.id}`} className={`${btnGhost} border-blue-300 text-blue-700`} data-testid="ap-edit">
                    ✏️ Xem & sửa
                  </Link>
                  {p.status === "PENDING_REVIEW" ? (
                    <button
                      type="button"
                      className={`${btnGhost} border-emerald-300 text-emerald-700`}
                      data-testid="ap-approve"
                      disabled={pending}
                      onClick={() => run(() => approvePlannedPost(p.id))}
                    >
                      ✓ Duyệt & đăng
                    </button>
                  ) : null}
                  <Link href="/calendar" className={btnGhost}>
                    Xem trên lịch
                  </Link>
                  <button
                    type="button"
                    className={`${btnGhost} text-red-600`}
                    data-testid="ap-discard"
                    disabled={pending}
                    onClick={() => run(() => discardPlannedPost(p.id))}
                  >
                    Bỏ bài này
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ============================================================
// Vỏ ngoài
// ============================================================

export default function AutopilotDashboard({
  pageId,
  config,
  posts,
  pendingReview,
  readiness,
  quota,
}: {
  pageId: string;
  config: AutoPilotConfigView;
  posts: PlannedPost[];
  pendingReview: number;
  readiness: { pillars: number; hasProfile: boolean };
  quota: { used: number; limit: number; remaining: number; live: boolean; blocked: boolean };
}) {
  const enabled = config?.enabled ?? false;

  // Cảnh báo sớm: hết quota Pexels thì bài sẽ ra không có ảnh
  const quotaLow = quota.remaining <= 20;

  return (
    <div className="space-y-5">
      {readiness.pillars === 0 ? (
        <div
          className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"
          data-testid="ap-needs-setup"
        >
          <p className="font-medium">⚠ Cần thiết lập hồ sơ thương hiệu trước</p>
          <p className="mt-1 text-xs">
            Chưa có trụ cột nội dung nào, nên hệ thống chưa biết nên viết loại bài gì.
          </p>
          <Link
            href="/brand"
            className="mt-2 inline-block rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
          >
            Thiết lập hồ sơ thương hiệu →
          </Link>
        </div>
      ) : !readiness.hasProfile ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          <p>
            💡 Bạn đã có trụ cột nội dung nhưng chưa điền hồ sơ thương hiệu. Bài viết sẽ khá
            chung chung.{" "}
            <Link href="/brand" className="font-medium underline">
              Điền hồ sơ →
            </Link>
          </p>
        </div>
      ) : null}

      <PowerSwitch pageId={pageId} enabled={enabled} hasConfig={config !== null} />

      {/* Hạn mức tìm ảnh — người dùng cần biết trước khi bài ra không có ảnh */}
      {config?.autoMedia ? (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            quota.blocked
              ? "bg-red-50 text-red-700"
              : quotaLow
                ? "bg-amber-50 text-amber-800"
                : "bg-gray-50 text-gray-600"
          }`}
          data-testid="ap-quota"
          data-remaining={quota.remaining}
        >
          <span className="font-medium">Hạn mức tìm ảnh Pexels: </span>
          {quota.blocked
            ? "đã chạm giới hạn — tạm ngưng tìm ảnh, sẽ tự chạy lại khi hết giờ."
            : `còn ${quota.remaining}/${quota.limit} lượt trong giờ này`}
          {!quota.blocked && quotaLow ? (
            <span> — hệ thống sẽ tạm ngưng tìm ảnh để dành cho bạn dùng tay.</span>
          ) : null}
          {!quota.live ? (
            <span className="ml-1 text-xs opacity-70">(ước lượng)</span>
          ) : null}
        </div>
      ) : null}

      {config?.lastPlanError ? (
        // Thiếu ảnh là cảnh báo (bài vẫn tạo được), khác với lỗi chặn
        (() => {
          const onlyMedia = config.lastPlanError.includes("không tìm được ảnh");
          return (
            <div
              className={`rounded-lg px-4 py-3 text-sm ${
                onlyMedia ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700"
              }`}
              data-testid="ap-last-error"
            >
              <p className="font-medium">
                {onlyMedia
                  ? "⚠ Lần lập kế hoạch gần nhất thiếu ảnh:"
                  : "Lần lập kế hoạch gần nhất bị lỗi:"}
              </p>
              <p className="mt-1 text-xs">{config.lastPlanError}</p>
              {onlyMedia ? (
                <p className="mt-1 text-xs">
                  Bài vẫn được tạo (dạng chỉ có chữ). Kiểm tra Pexels API Key ở trang Cài đặt.
                </p>
              ) : null}
            </div>
          );
        })()
      ) : null}

      <PlanPreview
        pageId={pageId}
        posts={posts}
        enabled={enabled}
        pendingReview={pendingReview}
      />

      <SettingsForm pageId={pageId} config={config} />

      {config && config.totalPlanned > 0 ? (
        <p className="text-center text-xs text-gray-500" data-testid="ap-total">
          Hệ thống đã tự viết {config.totalPlanned} bài cho Page này.
        </p>
      ) : null}
    </div>
  );
}
