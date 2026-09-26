"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  refreshInsightsNow,
  reprobeNow,
  setInsightsOptimization,
  type InsightsState,
} from "@/app/actions/insights";
import { pushToast } from "./toast-provider";
import { formatDateTime } from "@/lib/format-date";
import type { InsightsPageView } from "@/lib/insights-view";
import type { LearningView } from "@/lib/insights-view";

// ============================================================
// Trang Số liệu & tự tối ưu.
//
// NĂM KHỐI, theo đúng thứ tự người dùng cần đọc:
//   0. Nhận xét & hướng đang triển khai  ← trả lời câu hỏi chính
//   A. Bài đăng mới nhất kèm số liệu
//   B. Phân tích theo từng hướng
//   C. Đang áp dụng gì vào bài tiếp theo
//   D. Số liệu cấp Page
//
// Nguyên tắc trình bày: mọi con số phải nói rõ NGUỒN và ĐỘ TIN CẬY. Người dùng
// cần biết khi nào số liệu chưa đủ để kết luận, thay vì tin vào một bảng xếp
// hạng dựng từ 3 bài.
// ============================================================

const cardCls = "rounded-2xl border border-gray-200 bg-white p-5";
const btnPrimary =
  "rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60";
const btnGhost =
  "rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60";

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  OK: { label: "🟢 Có số liệu", cls: "bg-emerald-50 text-emerald-700" },
  PARTIAL: { label: "🟡 Có số liệu một phần", cls: "bg-amber-50 text-amber-700" },
  FRESH: { label: "⏳ Đang thu thập", cls: "bg-gray-100 text-gray-600" },
  NO_PERMISSION: { label: "🔒 Thiếu quyền read_insights", cls: "bg-orange-50 text-orange-700" },
  LOW_FANS: { label: "📊 Page chưa đủ 100 lượt thích", cls: "bg-orange-50 text-orange-700" },
  TOKEN_INVALID: { label: "🔑 Token hết hiệu lực", cls: "bg-red-50 text-red-700" },
  ERROR: { label: "🔴 Lỗi", cls: "bg-red-50 text-red-700" },
  UNKNOWN: { label: "⚪ Chưa lấy số liệu", cls: "bg-gray-100 text-gray-600" },
};

const DIRECTION_BADGE: Record<string, { label: string; cls: string }> = {
  RISING: { label: "📈 Đang lên", cls: "bg-emerald-50 text-emerald-700" },
  STABLE: { label: "➡️ Ổn định", cls: "bg-gray-100 text-gray-700" },
  DECLINING: { label: "📉 Đang giảm", cls: "bg-amber-50 text-amber-700" },
  EXHAUSTED: { label: "🛑 Đã bão hoà", cls: "bg-red-50 text-red-700" },
  EXPLORING: { label: "🔬 Đang thử", cls: "bg-blue-50 text-blue-700" },
};

const KIND_LABEL: Record<string, string> = {
  PILLAR: "Trụ cột",
  HOOK: "Kiểu mở bài",
  TIME_BAND: "Khung giờ",
  MEDIA_KIND: "Loại nội dung",
  SERVICE_AREA: "Địa bàn",
};

function num(v: number | null | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return v.toLocaleString("vi-VN");
}

function pct(v: number | null | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function signedPct(v: number | null | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${Math.round(v)}%`;
}

function Banner({ text, kind }: { text: string; kind: "info" | "warn" | "error" }) {
  const cls =
    kind === "error"
      ? "border-red-200 bg-red-50 text-red-700"
      : kind === "warn"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-blue-200 bg-blue-50 text-blue-800";
  return <div className={`rounded-lg border px-3 py-2 text-sm ${cls}`}>{text}</div>;
}

export default function InsightsDashboard({
  view,
  learning,
}: {
  view: InsightsPageView;
  learning: LearningView | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const run = (key: string, fn: () => Promise<InsightsState>) => {
    setBusy(key);
    startTransition(async () => {
      const res = await fn();
      if (res) {
        pushToast({
          kind: res.error ? "error" : "ok",
          title: res.error ?? res.message ?? "Đã xong.",
          testId: "insights-alert",
        });
      }
      setBusy(null);
      router.refresh();
    });
  };

  const status = STATUS_BADGE[view.page.insightsStatus] ?? STATUS_BADGE.UNKNOWN;
  const anyReach = view.posts.some((p) => p.distribution !== null);
  const progress = learning?.progress ?? null;

  return (
    <div className="space-y-5">
      {/* ===== Thanh điều khiển ===== */}
      <div className={cardCls} data-testid="insights-controls">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status.cls}`}>
              {status.label}
            </span>
            {progress ? (
              <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
                {progress.phaseLabel}
              </span>
            ) : null}
            <span className="text-xs text-gray-500">
              Cập nhật lần cuối:{" "}
              {view.page.insightsLastFetchedAt
                ? formatDateTime(view.page.insightsLastFetchedAt)
                : "chưa lấy"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={btnGhost}
              disabled={pending && busy === "refresh"}
              onClick={() => run("refresh", () => refreshInsightsNow(view.page.id))}
              data-testid="insights-refresh"
            >
              {busy === "refresh" ? "Đang lấy…" : "🔄 Lấy số liệu ngay"}
            </button>
            {view.page.insightsEnabled ? (
              <button
                type="button"
                className={btnGhost}
                disabled={pending && busy === "reprobe"}
                onClick={() => run("reprobe", () => reprobeNow(view.page.id))}
                data-testid="insights-reprobe"
              >
                {busy === "reprobe" ? "Đang kiểm tra…" : "🔁 Kiểm tra lại ngay"}
              </button>
            ) : null}
            <button
              type="button"
              className={view.page.insightsEnabled ? btnGhost : btnPrimary}
              disabled={pending && busy === "toggle"}
              onClick={() =>
                run("toggle", () =>
                  setInsightsOptimization(view.page.id, !view.page.insightsEnabled)
                )
              }
              data-testid="insights-toggle"
            >
              {busy === "toggle"
                ? "Đang lưu…"
                : view.page.insightsEnabled
                  ? "⏸ Tắt tự tối ưu"
                  : "🚀 Bật tự tối ưu theo số liệu"}
            </button>
          </div>
        </div>

        {view.page.insightsLastError ? (
          <div className="mt-3">
            <Banner kind="warn" text={view.page.insightsLastError} />
          </div>
        ) : null}

        {!view.page.insightsEnabled ? (
          <div className="mt-3">
            <Banner
              kind="info"
              text="Tự tối ưu đang TẮT cho Page này. Hệ thống vẫn hiển thị số liệu để bạn theo dõi, nhưng KHÔNG dùng số liệu để đổi cách viết bài. Bật lên thì AutoPilot sẽ tự dò hướng đi rồi tối ưu dần theo thời gian."
            />
          </div>
        ) : null}

        {view.page.insightsStatus === "NO_PERMISSION" ? (
          <div className="mt-3">
            <Banner
              kind="warn"
              text="Token chưa có quyền read_insights nên chưa lấy được số lượt xem/tiếp cận. Hệ thống vẫn xếp hạng theo tương tác (cảm xúc, bình luận, chia sẻ). Thêm quyền ở trang Facebook Apps rồi đồng bộ lại để chính xác hơn."
            />
          </div>
        ) : null}

        {view.page.insightsStatus === "LOW_FANS" ? (
          <div className="mt-3">
            <Banner
              kind="warn"
              text="Facebook chỉ cung cấp số liệu Insights cho Page có từ 100 lượt thích trở lên. Page này chưa đủ nên hệ thống xếp hạng theo tương tác."
            />
          </div>
        ) : null}
      </div>

      {/* ===== Khối 0: NHẬN XÉT & HƯỚNG ĐANG TRIỂN KHAI ===== */}
      {learning ? (
        <section className={cardCls} data-testid="insights-commentary">
          <h2 className="text-base font-semibold text-gray-900">
            📋 Nhận xét & hướng đang triển khai
          </h2>

          <p className="mt-2 text-sm font-medium text-gray-900">{learning.commentary.headline}</p>
          <p className="mt-1 text-sm text-gray-700">{learning.commentary.directionSummary}</p>

          {/* Tiến độ dò */}
          {progress && (progress.phase === "PROBE" || progress.phase === "REPROBE") ? (
            <div className="mt-3 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800">
              <span className="font-medium">
                {progress.phase === "REPROBE" ? "Đang kiểm tra lại" : "Đang dò tìm hướng đi"}:
              </span>{" "}
              {progress.probeUsed}/{progress.probeBudget} bài dò
              {progress.probeExhausted
                ? " — đã dùng hết ngân sách dò, hệ thống chuyển sang khai thác với số liệu hiện có."
                : ` — trải đều các trụ cột, kiểu mở bài và khung giờ. Còn thiếu ${progress.missingForExploit} bài đã đăng để bắt đầu tối ưu.`}
              {learning.regression.triggered ? (
                <div className="mt-1 text-indigo-900">Lý do: {learning.regression.reason}</div>
              ) : null}
            </div>
          ) : null}

          {learning.commentary.bullets.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm text-gray-700">
              {learning.commentary.bullets.map((b, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-gray-400">•</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {learning.commentary.actions.length > 0 ? (
            <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2">
              <p className="text-xs font-semibold text-gray-600">Nên làm gì tiếp</p>
              <ul className="mt-1 space-y-1 text-sm text-gray-700">
                {learning.commentary.actions.map((a, i) => (
                  <li key={i}>→ {a}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Bảng hướng nội dung */}
          {learning.directions.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm" data-testid="insights-directions">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-2 pr-3">Hướng</th>
                    <th className="py-2 pr-3">Loại</th>
                    <th className="py-2 pr-3 text-right">Số bài</th>
                    <th className="py-2 pr-3 text-right">Hiệu quả TB</th>
                    <th className="py-2 pr-3 text-right">So kỳ trước</th>
                    <th className="py-2 pr-3">Trạng thái</th>
                    <th className="py-2 pr-3 text-right">Ước lượng còn hiệu quả</th>
                    <th className="py-2">Khuyến nghị</th>
                  </tr>
                </thead>
                <tbody>
                  {learning.directions
                    .filter((d) => d.sampleSize > 0)
                    .slice(0, 12)
                    .map((d) => {
                      const badge = DIRECTION_BADGE[d.status] ?? DIRECTION_BADGE.EXPLORING;
                      return (
                        <tr key={`${d.kind}-${d.value}`} className="border-b border-gray-100">
                          <td className="py-2 pr-3 font-medium text-gray-900">{d.label}</td>
                          <td className="py-2 pr-3 text-xs text-gray-500">
                            {KIND_LABEL[d.kind] ?? d.kind}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums text-gray-700">
                            {d.sampleSize}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums text-gray-700">
                            {Math.round(d.avgScore * 10) / 10}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums text-gray-700">
                            {signedPct(d.changePct)}
                          </td>
                          <td className="py-2 pr-3">
                            <span className={`rounded-full px-2 py-0.5 text-xs ${badge.cls}`}>
                              {badge.label}
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums text-gray-700">
                            {d.estLifeDays === null
                              ? "chưa đủ dữ liệu"
                              : d.estLifeDays === 0
                                ? "đã hết"
                                : `~${d.estLifeDays} ngày`}
                          </td>
                          <td className="py-2 text-gray-700">{d.recommendation}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-sm text-gray-500">
              Chưa có đủ bài đã đăng để dựng bảng hướng nội dung.
            </p>
          )}

          {/* Minh bạch */}
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <p className="text-xs font-semibold text-gray-600">Cần biết khi đọc nhận xét</p>
            <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
              {learning.commentary.honesty.map((h, i) => (
                <li key={i}>· {h}</li>
              ))}
            </ul>
          </div>
        </section>
      ) : (
        <section className={cardCls} data-testid="insights-commentary">
          <h2 className="text-base font-semibold text-gray-900">
            📋 Nhận xét & hướng đang triển khai
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            Bật <span className="font-medium">tự tối ưu theo số liệu</span> để hệ thống phân tích
            nội dung đang triển khai theo hướng nào, số liệu ra sao, và nên giữ hay đổi gì.
          </p>
        </section>
      )}

      {/* ===== Khối A: bài đăng mới nhất ===== */}
      <section className={cardCls} data-testid="insights-posts">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-gray-900">
            📄 Bài đăng mới nhất & số liệu
          </h2>
          <span className="text-xs text-gray-500">
            {view.autoPilotPublished} bài AutoPilot đã đăng
            {view.missingInsightCount > 0
              ? ` · ${view.missingInsightCount} bài chưa có số liệu`
              : ""}
          </span>
        </div>

        {!anyReach ? (
          <div className="mt-3">
            <Banner
              kind="info"
              text="Chưa có số lượt xem/tiếp cận cho bài nào (token thiếu read_insights hoặc Page chưa đủ 100 lượt thích). Bảng dưới xếp hạng theo tương tác: cảm xúc ×1, bình luận ×3, chia sẻ ×5."
            />
          </div>
        ) : null}

        {view.posts.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            Chưa có bài nào đã đăng kèm mã bài Facebook. Số liệu sẽ bắt đầu có sau khi bài đầu
            tiên lên sóng khoảng 24 giờ.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm" data-testid="insights-posts-table">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-3">Ý chính</th>
                  <th className="py-2 pr-3">Trụ cột</th>
                  <th className="py-2 pr-3">Giờ đăng</th>
                  <th className="py-2 pr-3">Kiểu mở bài</th>
                  <th className="py-2 pr-3">Nội dung</th>
                  <th className="py-2 pr-3 text-right">Lượt xem</th>
                  <th className="py-2 pr-3 text-right">❤ 💬 ↗</th>
                  <th className="py-2 pr-3 text-right">Điểm</th>
                  <th className="py-2 pr-3 text-right">Tỉ lệ</th>
                  <th className="py-2 pr-3">Nguồn</th>
                  <th className="py-2">Liên kết</th>
                </tr>
              </thead>
              <tbody>
                {view.posts.map((p) => (
                  <tr key={p.id} className="border-b border-gray-100 align-top">
                    <td className="max-w-[240px] py-2 pr-3">
                      <span className="line-clamp-2 text-gray-900">{p.hook}</span>
                      {p.optimizationNote ? (
                        <span className="mt-0.5 block text-xs text-indigo-600">
                          {p.optimizationNote}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-gray-700">{p.pillarName ?? "—"}</td>
                    <td className="py-2 pr-3 text-xs text-gray-600">{p.bandLabel}</td>
                    <td className="py-2 pr-3 text-xs text-gray-600">{p.hookStyleLabel}</td>
                    <td className="py-2 pr-3 text-xs text-gray-600">
                      {p.mediaKindLabel}
                      {p.mediaCount > 0 ? ` ×${p.mediaCount}` : ""}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-700">
                      {num(p.distribution)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-700">
                      {p.reactions} {p.comments} {p.shares}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums font-medium text-gray-900">
                      {p.engagement}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-700">
                      {pct(p.interactionRate)}
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          p.origin === "AUTOPILOT"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {p.origin === "AUTOPILOT" ? "Tự động" : "Soạn tay"}
                      </span>
                      {p.probeKind === "PROBE" ? (
                        <span className="ml-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                          Dò
                        </span>
                      ) : null}
                      {!p.usedForLearning && p.origin === "AUTOPILOT" ? (
                        <span className="mt-0.5 block text-xs text-gray-400">
                          {p.insightStatus === "FRESH" ? "đang thu thập" : "chưa dùng để tối ưu"}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 text-xs">
                      <Link href={`/posts/${p.id}`} className="text-blue-600 hover:underline">
                        Xem
                      </Link>
                      {p.fbPostId ? (
                        <>
                          {" · "}
                          <a
                            href={`https://www.facebook.com/${p.fbPostId.replace("_", "/posts/")}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            Facebook
                          </a>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {view.posts.some((p) => p.missingMetrics.length > 0) ? (
          <p className="mt-2 text-xs text-gray-500">
            Một số bài thiếu metric:{" "}
            {Array.from(new Set(view.posts.flatMap((p) => p.missingMetrics)))
              .slice(0, 6)
              .join(", ")}
            . Đây là các chỉ số Facebook không trả về cho token hiện tại.
          </p>
        ) : null}
      </section>

      {/* ===== Khối B: phân tích theo hướng ===== */}
      {learning ? (
        <section className={cardCls} data-testid="insights-analysis">
          <h2 className="text-base font-semibold text-gray-900">📊 Phân tích theo hướng</h2>
          <p className="mt-1 text-xs text-gray-500">
            Chỉ tính bài do AutoPilot tạo và đã đủ 24 giờ (Facebook chốt số liệu sau ~24h). Bài
            soạn tay không tham gia tính toán. Điểm = cảm xúc ×1 + bình luận ×3 + chia sẻ ×5.
          </p>

          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-gray-100 px-3 py-1 font-medium text-gray-700">
              {learning.progress.sampleSize} bài phân tích
            </span>
            <span
              className={`rounded-full px-3 py-1 font-medium ${
                learning.confidence === "HIGH"
                  ? "bg-emerald-50 text-emerald-700"
                  : learning.confidence === "MEDIUM"
                    ? "bg-blue-50 text-blue-700"
                    : "bg-amber-50 text-amber-700"
              }`}
            >
              Độ tin cậy:{" "}
              {learning.confidence === "HIGH"
                ? "cao"
                : learning.confidence === "MEDIUM"
                  ? "trung bình"
                  : learning.confidence === "LOW"
                    ? "thấp"
                    : "chưa có"}
            </span>
            <span
              className={`rounded-full px-3 py-1 font-medium ${
                learning.reachAvailable
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {learning.reachAvailable
                ? "Có số lượt xem/tiếp cận"
                : "Chỉ có tương tác (thiếu read_insights)"}
            </span>
            {learning.trend7d ? (
              <span
                className={`rounded-full px-3 py-1 font-medium ${
                  learning.trend7d.changePct >= 0
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-50 text-amber-700"
                }`}
              >
                7 ngày gần đây: {signedPct(learning.trend7d.changePct)} so với 7 ngày trước
              </span>
            ) : null}
          </div>

          {learning.groups.pillar.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500">
              Chưa có bài AutoPilot nào đủ chín để phân tích. Số liệu cấp bài của Facebook cập
              nhật khoảng 24 giờ một lần.
            </p>
          ) : (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <GroupRank title="Trụ cột nội dung" groups={learning.groups.pillar} showDistribution={learning.reachAvailable} />
              <GroupRank title="Khung giờ đăng" groups={learning.groups.band} showDistribution={learning.reachAvailable} />
              <GroupRank title="Kiểu mở bài" groups={learning.groups.hook} showDistribution={learning.reachAvailable} />
              <GroupRank title="Loại nội dung" groups={learning.groups.media} showDistribution={learning.reachAvailable} />
              {learning.groups.area.length > 0 ? (
                <GroupRank title="Địa bàn" groups={learning.groups.area} showDistribution={learning.reachAvailable} />
              ) : null}
            </div>
          )}

          {learning.topPosts.length > 0 ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-xs font-semibold text-emerald-800">Bài hiệu quả nhất</p>
                <ul className="mt-1 space-y-1 text-xs text-emerald-900">
                  {learning.topPosts.map((p) => (
                    <li key={p.postId}>
                      <Link href={`/posts/${p.postId}`} className="hover:underline">
                        [{p.score} điểm] {p.hook.slice(0, 70)}
                        {p.hook.length > 70 ? "…" : ""}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-800">Bài kém hiệu quả nhất</p>
                <ul className="mt-1 space-y-1 text-xs text-amber-900">
                  {learning.weakPosts.map((p) => (
                    <li key={p.postId}>
                      <Link href={`/posts/${p.postId}`} className="hover:underline">
                        [{p.score} điểm] {p.hook.slice(0, 70)}
                        {p.hook.length > 70 ? "…" : ""}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ===== Khối C: đang áp dụng gì ===== */}
      {learning ? (
        <section className={cardCls} data-testid="insights-applied">
          <h2 className="text-base font-semibold text-gray-900">⚙️ Đang áp dụng gì</h2>
          <p className="mt-1 text-xs text-gray-500">
            Hệ thống chỉ điều chỉnh CÁCH TRIỂN KHAI. Hồ sơ thương hiệu (giá, sản phẩm, địa bàn,
            giọng điệu) không bao giờ bị thay đổi.
          </p>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-3">Trụ cột</th>
                  <th className="py-2 pr-3 text-right">Bạn đặt</th>
                  <th className="py-2 pr-3 text-right">Đang dùng</th>
                  <th className="py-2">Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {learning.pillarWeights.map((p) => (
                  <tr key={p.name} className="border-b border-gray-100">
                    <td className="py-2 pr-3 text-gray-900">{p.name}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-600">
                      {p.original}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums font-medium text-gray-900">
                      {p.effective}
                    </td>
                    <td className="py-2 text-xs text-gray-500">
                      {p.effective === p.original
                        ? "giữ nguyên"
                        : p.effective > p.original
                          ? "tăng theo số liệu"
                          : "giảm theo số liệu"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 space-y-1 text-sm text-gray-700">
            <p>
              <span className="font-medium">Lý do:</span>{" "}
              {learning.pillarSuggestion.applied
                ? learning.pillarSuggestion.reason
                : learning.pillarSuggestion.reason}
            </p>
            <p>
              <span className="font-medium">Khung giờ ưu tiên:</span>{" "}
              {learning.timeBias
                ? `${Math.floor(learning.timeBias.startMin / 60)}:${String(
                    learning.timeBias.startMin % 60
                  ).padStart(2, "0")}–${Math.floor(learning.timeBias.endMin / 60)}:${String(
                    learning.timeBias.endMin % 60
                  ).padStart(2, "0")} (${Math.round(learning.timeBias.share * 100)}% số bài) — ${
                    learning.timeBias.reason
                  }`
                : learning.timeBiasReason || "chưa cần dồn bài vào khung giờ nào"}
            </p>
            <p>
              <span className="font-medium">Kiểu mở bài ưu tiên:</span>{" "}
              {learning.hookSuggestion.style
                ? `${learning.hookSuggestion.style} — ${learning.hookSuggestion.reason}`
                : learning.hookSuggestion.reason}
            </p>
          </div>

          {learning.performanceLines.length > 0 ? (
            <details className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold text-gray-600">
                Xem nội dung số liệu gửi cho AI (chỉ để chọn góc và cách trình bày)
              </summary>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-gray-700">
                {learning.performanceLines.join("\n")}
              </pre>
            </details>
          ) : null}

          {learning.learningComputedAt ? (
            <p className="mt-2 text-xs text-gray-400">
              Kết luận tính lúc {formatDateTime(learning.learningComputedAt)} — được tính lại từ dữ
              liệu thô mỗi lượt kiểm tra.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* ===== Khối D: số liệu cấp Page ===== */}
      <section className={cardCls} data-testid="insights-page">
        <h2 className="text-base font-semibold text-gray-900">📈 Số liệu cấp Page</h2>
        <p className="mt-1 text-xs text-gray-500">
          Bối cảnh chung của Page theo ngày (giờ Việt Nam). Địa bàn dùng khi viết bài vẫn lấy từ
          hồ sơ thương hiệu bạn nhập — cột thành phố dưới đây chỉ để tham khảo.
        </p>

        {view.snapshots.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            Chưa có snapshot cấp Page. Số liệu này cần quyền read_insights và Page đủ 100 lượt
            thích.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-3">Ngày</th>
                  <th className="py-2 pr-3 text-right">Người theo dõi</th>
                  <th className="py-2 pr-3 text-right">Lượt xem Page</th>
                  <th className="py-2 pr-3 text-right">Lượt xem nội dung</th>
                  <th className="py-2 pr-3 text-right">Người xem nội dung</th>
                  <th className="py-2 pr-3 text-right">Tương tác bài</th>
                  <th className="py-2">Thành phố đông nhất</th>
                </tr>
              </thead>
              <tbody>
                {view.snapshots.map((s) => (
                  <tr key={s.dayKey} className="border-b border-gray-100">
                    <td className="py-2 pr-3 text-gray-900">{s.dayKey}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-700">
                      {num(s.follows ?? s.fans)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-700">
                      {num(s.pageViewsTotal)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-700">
                      {num(s.mediaView)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-700">
                      {num(s.mediaViewUnique)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-gray-700">
                      {num(s.postEngagements)}
                    </td>
                    <td className="py-2 text-xs text-gray-600">
                      {s.topCities.length > 0
                        ? s.topCities.map((c) => `${c.city} (${c.count})`).join(", ")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** Bảng xếp hạng một nhóm hướng (trụ cột, khung giờ, kiểu mở bài...). */
function GroupRank({
  title,
  groups,
  showDistribution,
}: {
  title: string;
  groups: {
    key: string;
    label: string;
    posts: number;
    share: number;
    avgScore: number;
    avgDistribution: number | null;
    z: number;
    changePct: number | null;
  }[];
  showDistribution: boolean;
}) {
  if (groups.length === 0) return null;

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <p className="text-xs font-semibold text-gray-700">{title}</p>
      <table className="mt-2 w-full text-xs">
        <thead>
          <tr className="text-left text-gray-500">
            <th className="py-1 pr-2 font-medium">Hướng</th>
            <th className="py-1 pr-2 text-right font-medium">Bài</th>
            <th className="py-1 pr-2 text-right font-medium">Điểm TB</th>
            {showDistribution ? (
              <th className="py-1 pr-2 text-right font-medium">Lượt xem TB</th>
            ) : null}
            <th className="py-1 text-right font-medium">So kỳ trước</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.key} className="border-t border-gray-100">
              <td className="py-1 pr-2 text-gray-900">
                {g.label}
                <span className="ml-1 text-gray-400">{Math.round(g.share * 100)}%</span>
              </td>
              <td className="py-1 pr-2 text-right tabular-nums text-gray-600">{g.posts}</td>
              <td
                className={`py-1 pr-2 text-right tabular-nums font-medium ${
                  g.z >= 0.4
                    ? "text-emerald-700"
                    : g.z <= -0.4
                      ? "text-amber-700"
                      : "text-gray-700"
                }`}
              >
                {Math.round(g.avgScore * 10) / 10}
              </td>
              {showDistribution ? (
                <td className="py-1 pr-2 text-right tabular-nums text-gray-600">
                  {num(g.avgDistribution)}
                </td>
              ) : null}
              <td className="py-1 text-right tabular-nums text-gray-600">
                {signedPct(g.changePct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
