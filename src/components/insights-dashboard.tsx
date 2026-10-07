"use client";

import { useState, useTransition, type ReactNode } from "react";
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
import {
  AreaChart,
  BarList,
  CompareBars,
  EmptyChart,
  ProgressBar,
  RangeBar,
  Sparkline,
  type BarItem,
  type CompareRow,
} from "./charts";
import {
  barPct,
  formatDecimal,
  formatInt,
  formatSignedPct,
  maxOf,
} from "@/lib/chart-geometry";
import {
  buildAdjustmentRows,
  buildDirectionBars,
  buildGroupBars,
  buildKpis,
  buildPageDaily,
  buildPillarWeightRows,
  confidenceLabel,
  filterPosts,
  postFilterLabel,
  topPostsByEngagement,
  type Kpi,
  type PostFilter,
} from "@/lib/insights-chart-data";

// ============================================================
// Trang Số liệu & tự tối ưu — GIAO DIỆN BIỂU ĐỒ.
//
// CÁC KHỐI, theo đúng thứ tự người dùng cần đọc:
//   0. Thẻ KPI tóm tắt                   ← nhìn 5 giây là biết tình hình
//   1. Nhận xét & hướng đang triển khai  ← trả lời câu hỏi chính
//   2. Bài đăng mới nhất kèm số liệu
//   3. Phân tích theo từng hướng (biểu đồ thanh)
//   4. Đang áp dụng gì (so sánh trọng số + dải khung giờ)
//   5. Hệ thống đã tự đổi gì (so mốc trước/sau)
//   6. Số liệu cấp Page theo ngày (biểu đồ vùng nhỏ)
//
// NGUYÊN TẮC:
//   - Biểu đồ là lớp NHÌN NHANH; con số chính xác vẫn luôn còn trong bảng
//     (đặt trong <details> hoặc giữ nguyên bảng) — không mất dữ liệu nào.
//   - Mọi con số phải nói rõ NGUỒN và ĐỘ TIN CẬY (giữ nguyên câu chữ cũ).
//   - Biểu đồ vẽ bằng SVG thuần (components/charts.tsx), không thư viện ngoài.
//   - Mọi phép tính dữ liệu nằm ở lib/insights-chart-data.ts (đã kiểm thử).
// ============================================================

const cardCls = "ui-card p-5";
const btnPrimary =
  "ui-btn ui-btn-primary px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";
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

/** Class Tailwind cho thanh biểu đồ — phải là chuỗi LITERAL để Tailwind sinh CSS. */
const TONE_BAR: Record<string, string> = {
  pos: "bg-emerald-500",
  neg: "bg-amber-500",
  flat: "bg-gray-400",
};

const KPI_TEXT: Record<string, string> = {  up: "text-emerald-700",
  down: "text-amber-700",
  flat: "text-gray-600",
  neutral: "text-gray-900",
};

const KPI_SPARK: Record<string, string> = {
  up: "text-emerald-600",
  down: "text-amber-600",
  flat: "text-gray-400",
  neutral: "text-blue-600",
};

function num(v: number | null | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return v.toLocaleString("vi-VN");
}

function pct(v: number | null | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
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

/** Tiêu đề một khối, kèm ghi chú nhỏ bên phải. */
function SectionHeader({
  title,
  sub,
  right,
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {sub ? <p className="mt-1 text-xs text-gray-500">{sub}</p> : null}
      </div>
      {right ? <div className="shrink-0 text-xs text-gray-500">{right}</div> : null}
    </div>
  );
}

function KpiCard({ kpi }: { kpi: Kpi }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{kpi.label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${KPI_TEXT[kpi.tone] ?? "text-gray-900"}`}>
        {kpi.value}
      </p>
      <p className="mt-0.5 text-[11px] text-gray-500">{kpi.sub}</p>
      {kpi.spark && kpi.spark.length > 1 ? (
        <div className="mt-2">
          <Sparkline values={kpi.spark} colorClass={KPI_SPARK[kpi.tone] ?? "text-blue-600"} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Biểu đồ thanh cho một nhóm hướng (trụ cột, khung giờ, kiểu mở bài...).
 * Độ dài thanh so với hướng cao nhất TRONG CÙNG nhóm; màu theo độ lệch z.
 */
function GroupChart({
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
    avgEngagement: number;
    avgDistribution: number | null;
    z: number;
    changePct: number | null;
  }[];
  showDistribution: boolean;
}) {
  if (groups.length === 0) return null;

  const items: BarItem[] = buildGroupBars(groups).map((g) => ({
    key: g.key,
    label: g.label,
    valueText: `${formatDecimal(g.avgScore, 1)} điểm`,
    barPct: g.barPct,
    colorClass: TONE_BAR[g.tone],
    note: `${formatInt(g.posts)} bài · ${Math.round(g.share * 100)}%${
      showDistribution && g.avgDistribution !== null
        ? ` · ${formatInt(g.avgDistribution)} lượt xem TB`
        : ""
    }`,
    badgeText: g.changePct === null ? undefined : formatSignedPct(g.changePct),
    badgeClass:
      g.changePct === null
        ? undefined
        : g.changePct >= 0
          ? "bg-emerald-50 text-emerald-700"
          : "bg-amber-50 text-amber-700",
  }));

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <p className="text-xs font-semibold text-gray-700">{title}</p>
      <div className="mt-3">
        <BarList items={items} ariaLabel={`Xếp hạng theo ${title}`} />
      </div>
    </div>
  );
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
  const [postFilter, setPostFilter] = useState<PostFilter>("all");

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

  // ---- Dữ liệu đã dựng sẵn cho biểu đồ (hàm thuần, xem insights-chart-data) ----
  const daily = buildPageDaily(view.snapshots);
  const kpis = buildKpis(view, learning);
  const filteredPosts = filterPosts(view.posts, postFilter);
  const maxEngagement = maxOf(filteredPosts.map((p) => p.engagement)) ?? 0;
  const topPosts = topPostsByEngagement(filteredPosts, 8);
  const topMax = maxOf(topPosts.map((p) => p.engagement)) ?? 0;
  const topItems: BarItem[] = topPosts.map((p) => ({
    key: p.id,
    label: p.hook,
    valueText: `${formatInt(p.engagement)} điểm`,
    barPct: barPct(p.engagement, topMax),
    colorClass: p.origin === "AUTOPILOT" ? "bg-amber-500" : "bg-gray-400",
    note: p.origin === "AUTOPILOT" ? "Tự động" : "Soạn tay (chỉ để tham khảo)",
  }));
  const directionRows = learning ? buildDirectionBars(learning.directions) : [];
  const trendCompare: CompareRow[] =
    learning?.trend7d
      ? [
          {
            key: "trend",
            label: "Hiệu quả trung vị",
            primaryText: formatDecimal(learning.trend7d.previousAvg, 1),
            primaryPct: barPct(
              learning.trend7d.previousAvg,
              Math.max(learning.trend7d.previousAvg, learning.trend7d.recentAvg)
            ),
            secondaryText: formatDecimal(learning.trend7d.recentAvg, 1),
            secondaryPct: barPct(
              learning.trend7d.recentAvg,
              Math.max(learning.trend7d.previousAvg, learning.trend7d.recentAvg)
            ),
            note: `${formatSignedPct(learning.trend7d.changePct)} so với 7 ngày trước`,
          },
        ]
      : [];
  const pillarWeightRows = learning ? buildPillarWeightRows(learning.pillarWeights) : [];
  const adjustmentRows = learning ? buildAdjustmentRows(learning.adjustments) : [];

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

        {/* Tiến độ dò — thanh trực quan thay cho chỉ chữ */}
        {progress && (progress.phase === "PROBE" || progress.phase === "REPROBE") ? (
          <div className="mt-3">
            <div className="flex items-baseline justify-between text-xs text-gray-600">
              <span className="font-medium">
                {progress.phase === "REPROBE" ? "Đang kiểm tra lại" : "Đang dò tìm hướng đi"}
              </span>
              <span className="tabular-nums">
                {formatInt(progress.probeUsed)}/{formatInt(progress.probeBudget)} bài dò
              </span>
            </div>
            <div className="mt-1">
              <ProgressBar
                value={progress.probeUsed}
                max={progress.probeBudget}
                colorClass="bg-indigo-500"
                ariaLabel="Tiến độ dò tìm hướng đi"
              />
            </div>
          </div>
        ) : null}

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

      {/* ===== Khối 0: THẺ KPI TÓM TẮT ===== */}
      <section className={cardCls} data-testid="insights-kpis">
        <SectionHeader
          title="📌 Tổng quan"
          sub="Bốn chỉ số nhìn nhanh tình hình Page và vòng học."
        />
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((k) => (
            <KpiCard key={k.key} kpi={k} />
          ))}
        </div>
      </section>

      {/* ===== Khối 1: NHẬN XÉT & HƯỚNG ĐANG TRIỂN KHAI ===== */}
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

          {/* Tỉ lệ thử hướng mới ở giai đoạn khai thác */}
          {progress && progress.phase === "EXPLOIT" ? (
            <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <span className="font-medium">Đang khai thác, vẫn giữ phần thử hướng mới:</span>{" "}
              khoảng {Math.round(progress.explorationRate * 100)}% số bài được dành để thử hướng ít
              dữ liệu nhất, phần còn lại đi theo hướng đang hiệu quả.
              <div className="mt-2">
                <ProgressBar
                  value={progress.explorationRate * 100}
                  max={100}
                  colorClass="bg-emerald-500"
                  ariaLabel="Tỉ lệ bài dành để thử hướng mới"
                />
              </div>
              <div className="mt-1 text-xs text-emerald-900/80">
                Tỉ lệ này tự tăng khi hiệu quả đi xuống và tự giảm khi số liệu đã ổn định — nhờ vậy
                hệ thống phát hiện thị hiếu đổi sớm, không phải chờ tới lúc tụt nặng.
              </div>
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

          {/* Bảng hướng nội dung — kèm thanh hiệu quả để so bằng mắt */}
          {directionRows.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm" data-testid="insights-directions">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-2 pr-3">Hướng</th>
                    <th className="py-2 pr-3">Loại</th>
                    <th className="py-2 pr-3 text-right">Số bài</th>
                    <th className="py-2 pr-3 text-right">Hiệu quả TB</th>
                    <th className="py-2 pr-3">Tương quan</th>
                    <th className="py-2 pr-3 text-right">So kỳ trước</th>
                    <th className="py-2 pr-3">Trạng thái</th>
                    <th className="py-2 pr-3 text-right">Ước lượng còn hiệu quả</th>
                    <th className="py-2">Khuyến nghị</th>
                  </tr>
                </thead>
                <tbody>
                  {directionRows.map((d) => {
                    const badge = DIRECTION_BADGE[d.status] ?? DIRECTION_BADGE.EXPLORING;
                    return (
                      <tr key={d.key} className="border-b border-gray-100">
                        <td className="py-2 pr-3 font-medium text-gray-900">{d.label}</td>
                        <td className="py-2 pr-3 text-xs text-gray-500">
                          {KIND_LABEL[d.kind] ?? d.kind}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-gray-700">
                          {formatInt(d.sampleSize)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-gray-700">
                          {formatDecimal(d.avgScore, 1)}
                        </td>
                        <td className="py-2 pr-3">
                          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-gray-100">
                            <div
                              className="h-full rounded-full bg-indigo-500"
                              style={{ width: `${Math.round(d.barPct)}%` }}
                            />
                          </div>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-gray-700">
                          {formatSignedPct(d.changePct)}
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

      {/* ===== Khối 2: bài đăng mới nhất ===== */}
      <section className={cardCls} data-testid="insights-posts">
        <SectionHeader
          title="📄 Bài đăng mới nhất & số liệu"
          sub="Biểu đồ và bảng đều chỉ để THAM KHẢO. Phần học chỉ dùng bài AutoPilot đã đủ 24 giờ."
          right={
            <>
              {view.autoPilotPublished} bài AutoPilot đã đăng
              {view.missingInsightCount > 0
                ? ` · ${view.missingInsightCount} bài chưa có số liệu`
                : ""}
            </>
          }
        />

        {!anyReach ? (
          <div className="mt-3">
            <Banner
              kind="info"
              text="Chưa có số lượt xem/tiếp cận cho bài nào (token thiếu read_insights hoặc Page chưa đủ 100 lượt thích). Bảng dưới xếp hạng theo tương tác: cảm xúc ×1, bình luận ×3, chia sẻ ×5."
            />
          </div>
        ) : null}

        {/* Lọc bài — biểu đồ và bảng cùng theo bộ lọc này */}
        <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="insights-post-filter">
          <span className="text-xs font-medium text-gray-500">Lọc:</span>
          {(["all", "auto", "manual"] as PostFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={postFilter === f}
              onClick={() => setPostFilter(f)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                postFilter === f
                  ? "border-blue-300 bg-blue-50 text-blue-700"
                  : "border-gray-300 text-gray-600 hover:bg-gray-50"
              }`}
            >
              {postFilterLabel(f)}
            </button>
          ))}
          <span className="text-xs text-gray-400">{filteredPosts.length} bài</span>
        </div>

        {topItems.length > 0 ? (
          <div className="mt-4 rounded-lg border border-gray-200 p-3">
            <p className="text-xs font-semibold text-gray-700">
              Bài tương tác cao nhất (điểm = cảm xúc ×1 + bình luận ×3 + chia sẻ ×5)
            </p>
            <div className="mt-3">
              <BarList items={topItems} ariaLabel="Bài tương tác cao nhất" />
            </div>
          </div>
        ) : null}

        {filteredPosts.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">
            {view.posts.length === 0
              ? "Chưa có bài nào đã đăng kèm mã bài Facebook. Số liệu sẽ bắt đầu có sau khi bài đầu tiên lên sóng khoảng 24 giờ."
              : "Không có bài nào khớp bộ lọc đang chọn."}
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
                {filteredPosts.map((p) => (
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
                    <td className="py-2 pr-3 text-right">
                      <span className="tabular-nums font-medium text-gray-900">
                        {p.engagement}
                      </span>
                      <div className="mt-1 ml-auto h-1.5 w-16 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-blue-500"
                          style={{ width: `${Math.round(barPct(p.engagement, maxEngagement))}%` }}
                        />
                      </div>
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

      {/* ===== Khối 3: phân tích theo hướng ===== */}
      {learning ? (
        <section className={cardCls} data-testid="insights-analysis">
          <SectionHeader
            title="📊 Phân tích theo hướng"
            sub="Chỉ tính bài do AutoPilot tạo và đã đủ 24 giờ (Facebook chốt số liệu sau ~24h). Bài soạn tay không tham gia tính toán. Điểm = cảm xúc ×1 + bình luận ×3 + chia sẻ ×5."
          />

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
              Độ tin cậy: {confidenceLabel(learning.confidence)}
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
                7 ngày gần đây: {formatSignedPct(learning.trend7d.changePct)} so với 7 ngày trước
              </span>
            ) : null}
          </div>

          {trendCompare.length > 0 ? (
            <div className="mt-4 rounded-lg border border-gray-200 p-3">
              <p className="text-xs font-semibold text-gray-700">
                Hiệu quả 7 ngày này so với 7 ngày trước
              </p>
              <div className="mt-3 max-w-md">
                <CompareBars
                  rows={trendCompare}
                  primaryLabel="7 ngày trước"
                  secondaryLabel="7 ngày này"
                  primaryColorClass="bg-gray-400"
                  secondaryColorClass={
                    (learning.trend7d?.changePct ?? 0) >= 0 ? "bg-emerald-500" : "bg-amber-500"
                  }
                  ariaLabel="So sánh hiệu quả 7 ngày này với 7 ngày trước"
                />
              </div>
            </div>
          ) : null}

          {learning.groups.pillar.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500">
              Chưa có bài AutoPilot nào đủ chín để phân tích. Số liệu cấp bài của Facebook cập
              nhật khoảng 24 giờ một lần.
            </p>
          ) : (
            <>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <GroupChart
                  title="Trụ cột nội dung"
                  groups={learning.groups.pillar}
                  showDistribution={learning.reachAvailable}
                />
                <GroupChart
                  title="Khung giờ đăng"
                  groups={learning.groups.band}
                  showDistribution={learning.reachAvailable}
                />
                <GroupChart
                  title="Kiểu mở bài"
                  groups={learning.groups.hook}
                  showDistribution={learning.reachAvailable}
                />
                <GroupChart
                  title="Loại nội dung"
                  groups={learning.groups.media}
                  showDistribution={learning.reachAvailable}
                />
                {learning.groups.area.length > 0 ? (
                  <GroupChart
                    title="Địa bàn"
                    groups={learning.groups.area}
                    showDistribution={learning.reachAvailable}
                  />
                ) : null}
              </div>

              {/* Bảng số chi tiết — giữ nguyên dữ liệu cũ cho ai cần con số chính xác */}
              <details className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <summary className="cursor-pointer text-xs font-semibold text-gray-600">
                  Xem bảng số chi tiết theo hướng
                </summary>
                <div className="mt-2 grid gap-4 md:grid-cols-2">
                  <GroupTable title="Trụ cột nội dung" groups={learning.groups.pillar} showDistribution={learning.reachAvailable} />
                  <GroupTable title="Khung giờ đăng" groups={learning.groups.band} showDistribution={learning.reachAvailable} />
                  <GroupTable title="Kiểu mở bài" groups={learning.groups.hook} showDistribution={learning.reachAvailable} />
                  <GroupTable title="Loại nội dung" groups={learning.groups.media} showDistribution={learning.reachAvailable} />
                  {learning.groups.area.length > 0 ? (
                    <GroupTable title="Địa bàn" groups={learning.groups.area} showDistribution={learning.reachAvailable} />
                  ) : null}
                </div>
              </details>
            </>
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

      {/* ===== Khối 4: đang áp dụng gì ===== */}
      {learning ? (
        <section className={cardCls} data-testid="insights-applied">
          <h2 className="text-base font-semibold text-gray-900">⚙️ Đang áp dụng gì</h2>
          <p className="mt-1 text-xs text-gray-500">
            Hệ thống chỉ điều chỉnh CÁCH TRIỂN KHAI. Hồ sơ thương hiệu (giá, sản phẩm, địa bàn,
            giọng điệu) không bao giờ bị thay đổi.
          </p>

          {pillarWeightRows.length > 0 ? (
            <div className="mt-4 rounded-lg border border-gray-200 p-3">
              <p className="text-xs font-semibold text-gray-700">
                Trọng số trụ cột: bạn đặt vs đang dùng
              </p>
              <div className="mt-3 max-w-xl">
                <CompareBars
                  rows={pillarWeightRows.map((p) => ({
                    key: p.key,
                    label: p.label,
                    primaryText: formatDecimal(p.original, 1),
                    primaryPct: p.primaryPct,
                    secondaryText: formatDecimal(p.effective, 1),
                    secondaryPct: p.secondaryPct,
                    badgeText: p.changed
                      ? p.effective > p.original
                        ? "tăng theo số liệu"
                        : "giảm theo số liệu"
                      : "giữ nguyên",
                    badgeClass: p.changed
                      ? p.effective > p.original
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-amber-50 text-amber-700"
                      : "bg-gray-100 text-gray-600",
                  }))}
                  primaryLabel="Bạn đặt"
                  secondaryLabel="Đang dùng"
                  ariaLabel="So sánh trọng số trụ cột bạn đặt với trọng số đang dùng"
                />
              </div>
            </div>
          ) : null}

          {/* Khung giờ ưu tiên — dải trực quan trên trục 24h */}
          {learning.timeBias ? (
            <div className="mt-4 rounded-lg border border-gray-200 p-3">
              <p className="text-xs font-semibold text-gray-700">Khung giờ ưu tiên</p>
              <p className="mt-1 text-sm text-gray-800">
                {Math.floor(learning.timeBias.startMin / 60)}:
                {String(learning.timeBias.startMin % 60).padStart(2, "0")}–
                {Math.floor(learning.timeBias.endMin / 60)}:
                {String(learning.timeBias.endMin % 60).padStart(2, "0")} (
                {Math.round(learning.timeBias.share * 100)}% số bài)
              </p>
              <div className="mt-2 max-w-xl">
                <RangeBar
                  startMin={learning.timeBias.startMin}
                  endMin={learning.timeBias.endMin}
                  ariaLabel="Khung giờ ưu tiên trên trục 24 giờ"
                />
              </div>
              <p className="mt-2 text-xs text-gray-500">{learning.timeBias.reason}</p>
            </div>
          ) : null}

          <div className="mt-4 space-y-1 text-sm text-gray-700">
            <p>
              <span className="font-medium">Lý do:</span> {learning.pillarSuggestion.reason}
            </p>
            {!learning.timeBias ? (
              <p>
                <span className="font-medium">Khung giờ ưu tiên:</span>{" "}
                {learning.timeBiasReason || "chưa cần dồn bài vào khung giờ nào"}
              </p>
            ) : null}
            <p>
              <span className="font-medium">Kiểu mở bài ưu tiên:</span>{" "}
              {learning.hookSuggestion.style
                ? `${learning.hookSuggestion.style} — ${learning.hookSuggestion.reason}`
                : learning.hookSuggestion.reason}
            </p>
          </div>

          <details className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold text-gray-600">
              Xem bảng trọng số trụ cột (số chính xác)
            </summary>
            <div className="mt-2 overflow-x-auto">
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
          </details>

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

      {/* ===== Khối 5: NHẬT KÝ TỰ ĐIỀU CHỈNH ===== */}
      {learning && adjustmentRows.length > 0 ? (
        <section className={cardCls} data-testid="insights-adjustments">
          <h2 className="text-base font-semibold text-gray-900">
            🔧 Hệ thống đã tự đổi gì, và kết quả ra sao
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Mỗi lần hệ thống tự đổi cách đăng, nó ghi lại mốc số liệu lúc đổi và kiểm chứng lại sau
            ít nhất 7 ngày. Nếu hiệu quả tụt quá 15%, hệ thống tự quay về cấu hình cũ và khoá chiều
            đó 14 ngày.
          </p>

          <div className="mt-4 max-w-xl">
            <CompareBars
              rows={adjustmentRows.map((a) => ({
                key: a.key,
                label: a.label,
                primaryText: formatDecimal(a.baseline, 1),
                primaryPct: a.primaryPct,
                secondaryText: a.result === null ? "—" : formatDecimal(a.result, 1),
                secondaryPct: a.secondaryPct,
                badgeText: a.statusLabel,
                badgeClass:
                  a.status === "ROLLED_BACK"
                    ? "bg-amber-50 text-amber-800"
                    : a.status === "KEPT"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-gray-100 text-gray-700",
                note: `${formatDateTime(a.appliedAt)} · ${
                  a.result === null
                    ? `đang kiểm chứng (mốc ${a.baselineSamples} bài)`
                    : `mốc ${a.baselineSamples} bài → sau điều chỉnh ${a.resultSamples ?? 0} bài`
                }${a.reason ? ` · ${a.reason}` : ""}${
                  a.lockedUntil ? ` · tạm khoá tới ${formatDateTime(a.lockedUntil)}` : ""
                }`,
              }))}
              primaryLabel="Mốc lúc đổi"
              secondaryLabel="Sau điều chỉnh"
              primaryColorClass="bg-gray-400"
              secondaryColorClass="bg-indigo-500"
              ariaLabel="So sánh mốc hiệu quả lúc đổi với kết quả sau điều chỉnh"
            />
          </div>

          <details className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold text-gray-600">
              Xem bảng nhật ký chi tiết
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-2 pr-3">Chiều điều chỉnh</th>
                    <th className="py-2 pr-3">Áp dụng lúc</th>
                    <th className="py-2 pr-3 text-right">Mốc lúc đổi</th>
                    <th className="py-2 pr-3 text-right">Sau điều chỉnh</th>
                    <th className="py-2 pr-3">Kết luận</th>
                  </tr>
                </thead>
                <tbody>
                  {learning.adjustments.map((a) => (
                    <tr key={a.id} className="border-b border-gray-100 align-top">
                      <td className="py-2 pr-3 text-gray-900">{a.kindLabel}</td>
                      <td className="py-2 pr-3 text-gray-600">{formatDateTime(a.appliedAt)}</td>
                      <td className="py-2 pr-3 text-right text-gray-700">
                        {Math.round(a.baselineMedian * 10) / 10} điểm
                        <div className="text-xs text-gray-400">{a.baselineSamples} bài</div>
                      </td>
                      <td className="py-2 pr-3 text-right text-gray-700">
                        {a.resultMedian === null ? (
                          "—"
                        ) : (
                          <>
                            {Math.round(a.resultMedian * 10) / 10} điểm
                            <div className="text-xs text-gray-400">{a.resultSamples ?? 0} bài</div>
                          </>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            a.status === "ROLLED_BACK"
                              ? "bg-amber-50 text-amber-800"
                              : a.status === "KEPT"
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {a.status === "ROLLED_BACK"
                            ? "Đã quay lại"
                            : a.status === "KEPT"
                              ? "Giữ"
                              : "Đang kiểm chứng"}
                        </span>
                        {a.reason ? (
                          <div className="mt-1 text-xs text-gray-500">{a.reason}</div>
                        ) : null}
                        {a.lockedUntil ? (
                          <div className="mt-1 text-xs text-amber-700">
                            Tạm khoá tới {formatDateTime(a.lockedUntil)}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      ) : null}

      {/* ===== Khối 6: số liệu cấp Page ===== */}
      <section className={cardCls} data-testid="insights-page">
        <SectionHeader
          title="📈 Số liệu cấp Page theo ngày"
          sub="Bối cảnh chung của Page theo ngày (giờ Việt Nam). Mỗi điểm là một lần chụp số liệu. Địa bàn dùng khi viết bài vẫn lấy từ hồ sơ thương hiệu bạn nhập — cột thành phố dưới đây chỉ để tham khảo."
          right={daily.labels.length > 0 ? `${daily.labels.length} ngày gần nhất` : undefined}
        />

        {view.snapshots.length === 0 ? (
          <div className="mt-3">
            <EmptyChart text="Chưa có snapshot cấp Page. Số liệu này cần quyền read_insights và Page đủ 100 lượt thích." />
          </div>
        ) : (
          <>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {daily.cards.map((card) => (
                <div
                  key={card.key}
                  className="rounded-lg border border-gray-200 p-3"
                  data-testid={`insights-chart-${card.key}`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-xs font-semibold text-gray-700">{card.title}</p>
                    <span className={`tabular-nums text-sm font-semibold ${card.colorClass}`}>
                      {card.latestText}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-gray-500">
                    {card.changePct === null
                      ? card.hint
                      : `${formatSignedPct(card.changePct)} · ${card.hint}`}
                  </p>
                  <div className="mt-1">
                    {card.hasData ? (
                      <AreaChart
                        points={daily.labels.map((label, i) => ({
                          label,
                          value: card.values[i],
                        }))}
                        colorClass={card.colorClass}
                        ariaLabel={`${card.title} theo ngày`}
                      />
                    ) : (
                      <EmptyChart text="Chưa có số liệu cho chỉ số này." />
                    )}
                  </div>
                </div>
              ))}
            </div>

            {view.snapshots[0]?.topCities.length ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                <span className="font-medium">Thành phố đông người xem:</span>
                {view.snapshots[0].topCities.map((c) => (
                  <span key={c.city} className="rounded-full bg-gray-100 px-2 py-0.5">
                    {c.city} ({c.count})
                  </span>
                ))}
                <span className="text-gray-400">— chỉ để tham khảo</span>
              </div>
            ) : null}

            <details className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold text-gray-600">
                Xem bảng số chi tiết (14 ngày gần nhất)
              </summary>
              <div className="mt-2 overflow-x-auto">
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
            </details>
          </>
        )}
      </section>
    </div>
  );
}

/** Bảng số chi tiết của một nhóm hướng (bản cũ, đặt trong <details>). */
function GroupTable({
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
    avgEngagement: number;
    avgDistribution: number | null;
    z: number;
    changePct: number | null;
  }[];
  showDistribution: boolean;
}) {
  if (groups.length === 0) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
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
                {formatSignedPct(g.changePct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
