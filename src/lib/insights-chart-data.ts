// ============================================================
// DỰNG DỮ LIỆU BIỂU ĐỒ CHO TRANG /insights — hàm THUẦN.
//
// Tầng này nằm giữa dữ liệu thô (`insights-view.ts`) và component vẽ
// (`components/charts.tsx`):
//   view/learning  →  insights-chart-data  →  charts.tsx (SVG)
//
// Vì sao tách riêng:
//   - Component chỉ còn việc trình bày; mọi phép đảo thứ tự, gom nhóm, tính
//     phần trăm thanh đều kiểm thử được (scripts/test-insights-charts.mjs)
//     mà không cần React/dev server.
//   - Tự khai báo type cấu trúc tối thiểu thay vì import từ insights-view.ts
//     (file đó có "server-only") để chạy được bằng node --experimental-strip-types.
//
// KHÔNG đổi logic học: file này không đọc DB và không quyết định gì — chỉ
// chuyển số liệu đã có thành hình dạng dễ nhìn.
// ============================================================

import {
  barPct as pctOf,
  formatInt,
  maxOf,
  formatSignedPct,
  formatDecimal,
} from "./chart-geometry.ts";

// ------------------------------------------------------------
// Kiểu đầu vào tối thiểu (cấu trúc con của insights-view)
// ------------------------------------------------------------

export type ChartSnapshot = {
  dayKey: string;
  fans: number | null;
  follows: number | null;
  pageViewsTotal: number | null;
  mediaView: number | null;
  postEngagements: number | null;
};

export type ChartPost = {
  id: string;
  hook: string;
  publishedAt: string | null;
  origin: string;
  probeKind: string;
  engagement: number;
  distribution: number | null;
  interactionRate: number | null;
  hasInsight: boolean;
};

export type ChartGroupStat = {
  key: string;
  label: string;
  posts: number;
  share: number;
  avgScore: number;
  avgEngagement: number;
  avgDistribution: number | null;
  z: number;
  changePct: number | null;
};

export type ChartOverview = {
  posts: readonly ChartPost[];
  snapshots: readonly ChartSnapshot[];
  autoPilotPublished: number;
  missingInsightCount: number;
};

export type ChartProgress = {
  phase: string;
  probeUsed: number;
  probeBudget: number;
  probeExhausted: boolean;
  missingForExploit: number;
  explorationRate: number;
  sampleSize: number;
};

export type ChartLearning = {
  phaseLabel: string;
  confidence: string;
  trend7d: { recentAvg: number; previousAvg: number; changePct: number } | null;
  progress: ChartProgress;
} | null;

// ------------------------------------------------------------
// Tiện ích chung
// ------------------------------------------------------------

/** "2026-09-30" → "30/09" (cắt chuỗi nên giống hệt nhau ở server và browser). */
export function shortDay(dayKey: string): string {
  if (typeof dayKey !== "string" || dayKey.length < 10) return dayKey ?? "";
  return `${dayKey.slice(8, 10)}/${dayKey.slice(5, 7)}`;
}

/** % thay đổi giữa giá trị đầu kỳ và cuối kỳ; đầu kỳ ≤ 0 → null (không chia 0). */
export function changePctOf(latest: number | null, first: number | null): number | null {
  if (typeof latest !== "number" || !Number.isFinite(latest)) return null;
  if (typeof first !== "number" || !Number.isFinite(first) || first <= 0) return null;
  return ((latest - first) / first) * 100;
}

export function confidenceLabel(confidence: string): string {
  if (confidence === "HIGH") return "cao";
  if (confidence === "MEDIUM") return "trung bình";
  if (confidence === "LOW") return "thấp";
  return "chưa có";
}

/** Mức màu theo z (robust z so với trung vị Page). */
export function toneOfZ(z: number): "pos" | "neg" | "flat" {
  if (z >= 0.4) return "pos";
  if (z <= -0.4) return "neg";
  return "flat";
}

function lastFinite(values: readonly (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function firstFinite(values: readonly (number | null)[]): number | null {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

// ------------------------------------------------------------
// 1. Số liệu cấp Page theo ngày → 4 biểu đồ nhỏ
// ------------------------------------------------------------

export type DailyCard = {
  key: string;
  title: string;
  colorClass: string;
  values: (number | null)[];
  latestText: string;
  changePct: number | null;
  hint: string;
  hasData: boolean;
};

export type PageDaily = {
  labels: string[];
  cards: DailyCard[];
};

/**
 * `snapshots` truyền vào theo thứ tự MỚI NHẤT TRƯỚC (đúng như insights-view
 * trả về); hàm tự đảo thành cũ → mới cho biểu đồ.
 */
export function buildPageDaily(snapshots: readonly ChartSnapshot[]): PageDaily {
  const asc = [...snapshots].reverse();
  const labels = asc.map((s) => shortDay(s.dayKey));

  const defs: { key: string; title: string; colorClass: string; pick: (s: ChartSnapshot) => number | null }[] = [
    { key: "views", title: "Lượt xem Page", colorClass: "text-blue-600", pick: (s) => s.pageViewsTotal },
    { key: "media", title: "Lượt xem nội dung", colorClass: "text-emerald-600", pick: (s) => s.mediaView },
    { key: "engage", title: "Tương tác bài", colorClass: "text-violet-700", pick: (s) => s.postEngagements },
    {
      key: "follows",
      title: "Người theo dõi",
      colorClass: "text-amber-600",
      pick: (s) => s.follows ?? s.fans,
    },
  ];

  const cards = defs.map((def) => {
    const values = asc.map(def.pick);
    const latest = lastFinite(values);
    const first = firstFinite(values);
    const changePct = changePctOf(latest, first);
    const hasData = values.some((v) => typeof v === "number" && Number.isFinite(v));
    const firstIndex = values.findIndex((v) => typeof v === "number" && Number.isFinite(v));

    return {
      key: def.key,
      title: def.title,
      colorClass: def.colorClass,
      values,
      latestText: latest === null ? "—" : formatInt(latest),
      changePct,
      hint: hasData
        ? `so với ${labels[firstIndex] ?? "đầu kỳ"}`
        : "chưa có số liệu — cần quyền read_insights và Page đủ 100 lượt thích",
      hasData,
    };
  });

  return { labels, cards };
}

// ------------------------------------------------------------
// 2. Thẻ KPI tóm tắt
// ------------------------------------------------------------

export type KpiTone = "up" | "down" | "flat" | "neutral";

export type Kpi = {
  key: string;
  label: string;
  value: string;
  sub: string;
  tone: KpiTone;
  spark?: (number | null)[];
};

function toneOfChange(changePct: number | null | undefined): KpiTone {
  if (typeof changePct !== "number" || !Number.isFinite(changePct)) return "neutral";
  if (changePct > 2) return "up";
  if (changePct < -2) return "down";
  return "flat";
}

/**
 * Bốn thẻ tóm tắt. Khi `learning === null` (Page chưa bật tự tối ưu) vẫn trả
 * đủ 4 thẻ thuần từ `view` — trang không được rỗng.
 */
export function buildKpis(view: ChartOverview, learning: ChartLearning): Kpi[] {
  const posts = view.posts;
  const withReach = posts.filter((p) => typeof p.distribution === "number" && Number.isFinite(p.distribution));
  const avgEngagement = posts.length
    ? Math.round(posts.reduce((sum, p) => sum + p.engagement, 0) / posts.length)
    : null;
  const avgReach = withReach.length
    ? Math.round(withReach.reduce((sum, p) => sum + (p.distribution ?? 0), 0) / withReach.length)
    : null;
  const engagementSpark = [...posts]
    .sort((a, b) => publishedTime(a) - publishedTime(b))
    .map((p) => p.engagement);
  const pageSpark = view.snapshots.map((s) => s.postEngagements);

  if (learning) {
    const trend = learning.trend7d;
    return [
      {
        key: "trend7d",
        label: "Hiệu quả 7 ngày",
        value: trend ? formatDecimal(trend.recentAvg, 1) : "—",
        sub: trend
          ? `${formatSignedPct(trend.changePct)} so với 7 ngày trước`
          : "chưa đủ dữ liệu 2 tuần để so sánh",
        tone: toneOfChange(trend?.changePct ?? null),
        spark: pageSpark,
      },
      {
        key: "samples",
        label: "Bài đã phân tích",
        value: `${formatInt(learning.progress.sampleSize)} bài`,
        sub: `độ tin cậy ${confidenceLabel(learning.confidence)}`,
        tone: "neutral",
      },
      {
        key: "reach",
        label: "Tiếp cận TB / bài",
        value: avgReach === null ? "—" : formatInt(avgReach),
        sub:
          avgReach === null
            ? "thiếu quyền read_insights hoặc Page chưa đủ 100 lượt thích"
            : `trên ${formatInt(withReach.length)} bài có số lượt tiếp cận`,
        tone: "neutral",
      },
      {
        key: "phase",
        label: "Giai đoạn học",
        value: learning.phaseLabel,
        sub:
          learning.progress.phase === "PROBE" || learning.progress.phase === "REPROBE"
            ? `${formatInt(learning.progress.probeUsed)}/${formatInt(learning.progress.probeBudget)} bài dò đã dùng`
            : `giữ ~${formatInt(Math.round(learning.progress.explorationRate * 100))}% bài để thử hướng mới`,
        tone: "neutral",
      },
    ];
  }

  return [
    {
      key: "published",
      label: "Bài AutoPilot đã đăng",
      value: `${formatInt(view.autoPilotPublished)} bài`,
      sub:
        view.missingInsightCount > 0
          ? `${formatInt(view.missingInsightCount)} bài chưa có số liệu`
          : "tất cả đều đã có số liệu",
      tone: "neutral",
    },
    {
      key: "posts",
      label: "Bài có số liệu",
      value: `${formatInt(posts.filter((p) => p.hasInsight).length)} bài`,
      sub: `trên ${formatInt(posts.length)} bài gần nhất`,
      tone: "neutral",
    },
    {
      key: "engagement",
      label: "Tương tác TB / bài",
      value: avgEngagement === null ? "—" : formatInt(avgEngagement),
      sub: "cảm xúc ×1 + bình luận ×3 + chia sẻ ×5",
      tone: "neutral",
      spark: engagementSpark,
    },
    {
      key: "snapshotDays",
      label: "Ngày có số liệu Page",
      value: `${formatInt(view.snapshots.length)} ngày`,
      sub: "mỗi điểm là một lần chụp số liệu theo ngày",
      tone: "neutral",
    },
  ];
}

function publishedTime(p: ChartPost): number {
  if (!p.publishedAt) return 0;
  const t = new Date(p.publishedAt).getTime();
  return Number.isFinite(t) ? t : 0;
}

// ------------------------------------------------------------
// 3. Xếp hạng theo hướng (trụ cột / khung giờ / kiểu mở bài / ...)
// ------------------------------------------------------------

export type GroupBar = ChartGroupStat & {
  /** 0..100 so với hướng cao nhất trong cùng nhóm. */
  barPct: number;
  tone: "pos" | "neg" | "flat";
};

export function buildGroupBars(group: readonly ChartGroupStat[]): GroupBar[] {
  const max = maxOf(group.map((g) => g.avgScore)) ?? 0;
  return group.map((g) => ({
    ...g,
    barPct: pctOf(g.avgScore, max),
    tone: toneOfZ(g.z),
  }));
}

// ------------------------------------------------------------
// 4. Bảng "Hướng nội dung" (directions) — kèm thanh hiệu quả
// ------------------------------------------------------------

export type DirectionBar = {
  key: string;
  kind: string;
  label: string;
  sampleSize: number;
  avgScore: number;
  changePct: number | null;
  status: string;
  estLifeDays: number | null;
  recommendation: string;
  barPct: number;
};

export function buildDirectionBars(
  directions: readonly {
    kind: string;
    value: string;
    label: string;
    sampleSize: number;
    avgScore: number;
    changePct: number | null;
    status: string;
    estLifeDays: number | null;
    recommendation: string;
  }[],
  limit = 12
): DirectionBar[] {
  const usable = directions.filter((d) => d.sampleSize > 0).slice(0, limit);
  const max = maxOf(usable.map((d) => d.avgScore)) ?? 0;
  return usable.map((d) => ({
    key: `${d.kind}-${d.value}`,
    kind: d.kind,
    label: d.label,
    sampleSize: d.sampleSize,
    avgScore: d.avgScore,
    changePct: d.changePct,
    status: d.status,
    estLifeDays: d.estLifeDays,
    recommendation: d.recommendation,
    barPct: pctOf(d.avgScore, max),
  }));
}

// ------------------------------------------------------------
// 5. Trọng số trụ cột: bạn đặt vs đang dùng
// ------------------------------------------------------------

export type PillarWeightRow = {
  key: string;
  label: string;
  original: number;
  effective: number;
  deltaPct: number | null;
  primaryPct: number;
  secondaryPct: number;
  changed: boolean;
};

export function buildPillarWeightRows(
  pillars: readonly { name: string; original: number; effective: number }[]
): PillarWeightRow[] {
  const max = maxOf(pillars.flatMap((p) => [p.original, p.effective])) ?? 0;
  return pillars.map((p) => ({
    key: p.name,
    label: p.name,
    original: p.original,
    effective: p.effective,
    deltaPct: changePctOf(p.effective, p.original),
    primaryPct: pctOf(p.original, max),
    secondaryPct: pctOf(p.effective, max),
    changed: Math.abs(p.effective - p.original) > 0.0001,
  }));
}

// ------------------------------------------------------------
// 6. Nhật ký tự điều chỉnh: mốc lúc đổi vs sau điều chỉnh
// ------------------------------------------------------------

export type AdjustmentLike = {
  id: string;
  kindLabel: string;
  baselineMedian: number;
  baselineSamples: number;
  resultMedian: number | null;
  resultSamples: number | null;
  status: string;
  reason: string | null;
  appliedAt: string;
  lockedUntil: string | null;
};

export type AdjustmentRow = {
  key: string;
  label: string;
  baseline: number;
  result: number | null;
  baselineSamples: number;
  resultSamples: number | null;
  primaryPct: number;
  secondaryPct: number;
  status: string;
  statusLabel: string;
  reason: string | null;
  appliedAt: string;
  lockedUntil: string | null;
};

export function adjustmentStatusLabel(status: string): string {
  if (status === "ROLLED_BACK") return "Đã quay lại";
  if (status === "KEPT") return "Giữ";
  return "Đang kiểm chứng";
}

export function buildAdjustmentRows(adjustments: readonly AdjustmentLike[]): AdjustmentRow[] {
  const max =
    maxOf(adjustments.flatMap((a) => (a.resultMedian === null ? [a.baselineMedian] : [a.baselineMedian, a.resultMedian]))) ??
    0;
  return adjustments.map((a) => ({
    key: a.id,
    label: a.kindLabel,
    baseline: a.baselineMedian,
    result: a.resultMedian,
    baselineSamples: a.baselineSamples,
    resultSamples: a.resultSamples,
    primaryPct: pctOf(a.baselineMedian, max),
    secondaryPct: pctOf(a.resultMedian, max),
    status: a.status,
    statusLabel: adjustmentStatusLabel(a.status),
    reason: a.reason,
    appliedAt: a.appliedAt,
    lockedUntil: a.lockedUntil,
  }));
}

// ------------------------------------------------------------
// 7. Bài đăng: lọc, xếp hạng, chuỗi thời gian
// ------------------------------------------------------------

export type PostFilter = "all" | "auto" | "manual";

export function filterPosts<T extends { origin: string }>(posts: readonly T[], filter: PostFilter): T[] {
  if (filter === "auto") return posts.filter((p) => p.origin === "AUTOPILOT");
  if (filter === "manual") return posts.filter((p) => p.origin !== "AUTOPILOT");
  return [...posts];
}

/** Bài tương tác cao nhất (điểm = cảm xúc ×1 + bình luận ×3 + chia sẻ ×5). */
export function topPostsByEngagement<T extends { engagement: number; publishedAt: string | null }>(
  posts: readonly T[],
  limit = 8
): T[] {
  const timeOf = (p: { publishedAt: string | null }): number => {
    if (!p.publishedAt) return 0;
    const t = new Date(p.publishedAt).getTime();
    return Number.isFinite(t) ? t : 0;
  };
  return [...posts]
    .sort((a, b) => b.engagement - a.engagement || timeOf(b) - timeOf(a))
    .slice(0, limit);
}

export function postFilterLabel(filter: PostFilter): string {
  if (filter === "auto") return "Tự động";
  if (filter === "manual") return "Soạn tay";
  return "Tất cả";
}
