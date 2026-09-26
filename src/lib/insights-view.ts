import "server-only";

import { prisma } from "./prisma";
import { formatDateKey } from "./autopilot-plan";
import {
  bandOfDate,
  hookStyleOf,
  interactionRateOf,
  mediaKindOf,
  type HookStyle,
  type TimeBand,
} from "./insights-core";
import { HOOK_STYLE_LABELS, TIME_BAND_LABELS } from "./insights-core";
import type { InsightSample } from "./insights-report";

// ============================================================
// TRUY VẤN CHO TRANG SỐ LIỆU (/insights)
//
// Tách khỏi insight-optimize.ts vì hai mục đích khác nhau:
//   - insight-optimize.ts: dữ liệu để RA QUYẾT ĐỊNH (chỉ bài AutoPilot đủ chín).
//   - file này: dữ liệu để HIỂN THỊ cho người dùng xem.
//
// Khác biệt quan trọng: trang hiển thị CẢ bài soạn tay (để người dùng tham
// khảo), nhưng phần tính toán thì chỉ dùng bài AutoPilot. Nếu trộn lẫn, người
// dùng sẽ thấy "hệ thống học từ bài tay" — điều họ đã yêu cầu KHÔNG làm.
// ============================================================

export type InsightPostRow = {
  id: string;
  fbPostId: string | null;
  content: string;
  hook: string;
  pillarName: string | null;
  topic: string | null;
  serviceArea: string | null;
  /** AUTO = bài AutoPilot tạo; MANUAL = người dùng soạn. */
  origin: string;
  probeKind: string;
  optimizationNote: string | null;
  publishedAt: string | null;
  /** Nhãn khung giờ (Sáng 6–11h...) */
  bandLabel: string;
  hookStyleLabel: string;
  mediaKindLabel: string;
  mediaCount: number;
  // ---- Số liệu ----
  hasInsight: boolean;
  insightStatus: string | null;
  /** Số người xem/tiếp cận — null khi token thiếu read_insights. */
  distribution: number | null;
  impressions: number | null;
  videoViews: number | null;
  reactions: number;
  comments: number;
  shares: number;
  engagement: number;
  /** Tỉ lệ người xem đáp lại — null khi không có số người xem. */
  interactionRate: number | null;
  missingMetrics: string[];
  fetchedAt: string | null;
  /** Có được dùng để tối ưu hay không (bài tay hoặc chưa đủ chín). */
  usedForLearning: boolean;
};

export type InsightsPageView = {
  posts: InsightPostRow[];
  /** Số liệu cấp Page 14 ngày gần nhất (mới nhất trước). */
  snapshots: {
    dayKey: string;
    fans: number | null;
    follows: number | null;
    pageImpressions: number | null;
    mediaView: number | null;
    mediaViewUnique: number | null;
    postEngagements: number | null;
    pageViewsTotal: number | null;
    status: string;
    topCities: { city: string; count: number }[];
  }[];
  /** Số bài AutoPilot đã đăng (dùng để suy giai đoạn học). */
  autoPilotPublished: number;
  page: {
    id: string;
    name: string;
    insightsStatus: string;
    insightsLastFetchedAt: string | null;
    insightsLastError: string | null;
    insightsEnabled: boolean;
  };
  /** Số bài AutoPilot đã đăng mà KHÔNG có số liệu (để giải thích khoảng trống). */
  missingInsightCount: number;
};

const MAX_ROWS = 20;

/**
 * Đọc dữ liệu hiển thị của trang Số liệu.
 *
 * Chỉ lấy 20 bài mới nhất để trang tải nhanh; số liệu phân tích (dùng cho tối
 * ưu) do insight-optimize.ts đọc riêng với cửa sổ 90 ngày.
 */
export async function loadInsightsPageView(
  userId: string,
  pageId: string
): Promise<InsightsPageView | null> {
  const page = await prisma.facebookPage.findFirst({
    where: { id: pageId, userId },
    select: {
      id: true,
      name: true,
      insightsStatus: true,
      insightsLastFetchedAt: true,
      insightsLastError: true,
      autopilot: { select: { insightsEnabled: true } },
    },
  });
  if (!page) return null;

  const [posts, snapshots, autoPilotPublished, missingInsightCount] = await Promise.all([
    prisma.post.findMany({
      where: { pageId, status: "PUBLISHED", fbPostId: { not: null } },
      orderBy: { publishedAt: "desc" },
      take: MAX_ROWS,
      select: {
        id: true,
        content: true,
        hook: true,
        fbPostId: true,
        pillarName: true,
        topic: true,
        serviceArea: true,
        origin: true,
        probeKind: true,
        optimizationNote: true,
        publishedAt: true,
        media: { select: { type: true } },
        insight: {
          select: {
            reactions: true,
            comments: true,
            shares: true,
            impressions: true,
            mediaView: true,
            mediaViewUnique: true,
            videoViews: true,
            status: true,
            missingMetrics: true,
            fetchedAt: true,
          },
        },
      },
    }),
    prisma.pageInsightSnapshot.findMany({
      where: { pageId },
      orderBy: { dayKey: "desc" },
      take: 14,
      select: {
        dayKey: true,
        fans: true,
        follows: true,
        pageImpressions: true,
        mediaView: true,
        mediaViewUnique: true,
        postEngagements: true,
        pageViewsTotal: true,
        status: true,
        topCitiesJson: true,
      },
    }),
    prisma.post.count({ where: { pageId, origin: "AUTOPILOT", status: "PUBLISHED" } }),
    prisma.post.count({
      where: {
        pageId,
        origin: "AUTOPILOT",
        status: "PUBLISHED",
        insight: null,
      },
    }),
  ]);

  const now = new Date();

  return {
    posts: posts.map((p) => toRow(p, now)),
    snapshots: snapshots.map((s) => ({
      dayKey: s.dayKey,
      fans: s.fans,
      follows: s.follows,
      pageImpressions: s.pageImpressions,
      mediaView: s.mediaView,
      mediaViewUnique: s.mediaViewUnique,
      postEngagements: s.postEngagements,
      pageViewsTotal: s.pageViewsTotal,
      status: s.status,
      topCities: parseTopCities(s.topCitiesJson),
    })),
    autoPilotPublished,
    missingInsightCount,
    page: {
      id: page.id,
      name: page.name,
      insightsStatus: page.insightsStatus,
      insightsLastFetchedAt: page.insightsLastFetchedAt?.toISOString() ?? null,
      insightsLastError: page.insightsLastError,
      insightsEnabled: page.autopilot?.insightsEnabled ?? false,
    },
  };
}

type PostRowInput = {
  id: string;
  content: string;
  hook: string | null;
  fbPostId: string | null;
  pillarName: string | null;
  topic: string | null;
  serviceArea: string | null;
  origin: string;
  probeKind: string;
  optimizationNote: string | null;
  publishedAt: Date | null;
  media: { type: string }[];
  insight: {
    reactions: number;
    comments: number;
    shares: number;
    impressions: number | null;
    mediaView: number | null;
    mediaViewUnique: number | null;
    videoViews: number | null;
    status: string;
    missingMetrics: string | null;
    fetchedAt: Date;
  } | null;
};

function toRow(p: PostRowInput, now: Date): InsightPostRow {
  const hookText = p.hook?.trim() || p.content.split("\n")[0]?.trim() || "";
  const mediaKind = mediaKindOf(p.media.map((m) => m.type));
  const insight = p.insight;

  const distribution =
    insight?.mediaView ?? insight?.impressions ?? insight?.videoViews ?? null;
  const reactions = insight?.reactions ?? 0;
  const comments = insight?.comments ?? 0;
  const shares = insight?.shares ?? 0;

  return {
    id: p.id,
    fbPostId: p.fbPostId,
    content: p.content,
    hook: hookText,
    pillarName: p.pillarName,
    topic: p.topic,
    serviceArea: p.serviceArea,
    origin: p.origin,
    probeKind: p.probeKind,
    optimizationNote: p.optimizationNote,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    bandLabel: TIME_BAND_LABELS[bandOfDate(p.publishedAt ?? now) as TimeBand],
    hookStyleLabel: HOOK_STYLE_LABELS[hookStyleOf(hookText) as HookStyle],
    mediaKindLabel: mediaKind === "VIDEO" ? "Video" : "Ảnh",
    mediaCount: p.media.length,
    hasInsight: Boolean(insight),
    insightStatus: insight?.status ?? null,
    distribution,
    impressions: insight?.impressions ?? null,
    videoViews: insight?.videoViews ?? null,
    reactions,
    comments,
    shares,
    engagement: reactions + 3 * comments + 5 * shares,
    interactionRate: interactionRateOf({
      reactions,
      comments,
      shares,
      distributionValue: distribution,
    }),
    missingMetrics: parseJsonArray(insight?.missingMetrics ?? null),
    fetchedAt: insight?.fetchedAt.toISOString() ?? null,
    // Chỉ bài AutoPilot đã đủ chín (>= 24h) mới được dùng để tối ưu — khớp
    // chính xác với điều kiện trong loadOptimizationInput.
    usedForLearning:
      p.origin === "AUTOPILOT" &&
      Boolean(insight) &&
      insight?.status !== "FRESH" &&
      p.publishedAt !== null &&
      now.getTime() - p.publishedAt.getTime() >= 24 * 60 * 60 * 1000,
  };
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function parseTopCities(raw: string | null): { city: string; count: number }[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x) =>
          x && typeof x.city === "string" && typeof x.count === "number"
      )
      .slice(0, 5);
  } catch {
    return [];
  }
}

/**
 * Trạng thái học đầy đủ để hiển thị khối "Đang áp dụng gì".
 * Trả null nếu Page chưa bật tối ưu (không cần tính gì).
 */
export async function loadLearningView(pageId: string, now: Date) {
  const autopilot = await prisma.autoPilot.findUnique({ where: { pageId } });
  if (!autopilot?.insightsEnabled) return null;

  const { computeLearningState, learningProgressOf, effectivePillars } = await import(
    "./insight-optimize"
  );

  const page = await prisma.facebookPage.findUnique({
    where: { id: pageId },
    select: { brandId: true },
  });
  const pillars = await prisma.contentPillar.findMany({
    where: page?.brandId
      ? { brandId: page.brandId, enabled: true }
      : { pageId, enabled: true },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      weight: true,
      position: true,
      goal: true,
    },
  });

  const state = await computeLearningState(
    pageId,
    {
      windowStart: autopilot.windowStart,
      windowEnd: autopilot.windowEnd,
      minGapMinutes: autopilot.minGapMinutes,
      mediaMix: autopilot.mediaMix,
      lastReProbeAt: autopilot.lastReProbeAt,
      updatedAt: autopilot.updatedAt,
    },
    now,
    pillars.map((p) => ({ name: p.name, weight: p.weight }))
  );

  const effective = effectivePillars(pillars, state);

  return {
    progress: learningProgressOf(state),
    commentary: state.commentary,
    directions: state.directions,
    phaseLabel: state.phaseLabel,
    regression: state.regression,
    /**
     * Thống kê theo từng hướng để hiển thị bảng xếp hạng ở khối "Phân tích".
     * Chỉ gửi các trường cần thiết — không gửi cả bài (nội dung đã có ở khối A).
     */
    groups: {
      pillar: state.report.byPillar,
      band: state.report.byBand,
      hook: state.report.byHookStyle,
      media: state.report.byMediaKind,
      area: state.report.byServiceArea,
    },
    topPosts: state.report.topPosts.map((p) => ({
      postId: p.postId,
      hook: p.hook,
      pillarName: p.pillarName,
      score: p.score,
    })),
    weakPosts: state.report.weakPosts.map((p) => ({
      postId: p.postId,
      hook: p.hook,
      pillarName: p.pillarName,
      score: p.score,
    })),
    trend7d: state.report.trend7d,
    confidence: state.report.confidence,
    reachAvailable: state.report.reachAvailable,
    probePlan: {
      totalQuota: state.probePlan.totalQuota,
      exhausted: state.probePlan.exhausted,
      reason: state.probePlan.reason,
      quotas: state.probePlan.quotas.map((q) => ({
        kind: q.kind,
        value: q.value,
        quota: q.quota,
      })),
    },
    timeBias: state.timeBias,
    timeBiasReason: state.timeBiasReason,
    hookSuggestion: state.hookSuggestion,
    pillarSuggestion: state.pillarSuggestion,
    performanceLines: state.performanceLines,
    /** Bảng so trọng số người dùng đặt với trọng số đang thực sự dùng. */
    pillarWeights: pillars.map((p, i) => ({
      name: p.name,
      original: p.weight,
      effective: effective[i]?.weight ?? p.weight,
    })),
    probeStartedAt: autopilot.probeStartedAt?.toISOString() ?? null,
    lastReProbeAt: autopilot.lastReProbeAt?.toISOString() ?? null,
    learningComputedAt: autopilot.learningComputedAt?.toISOString() ?? null,
  };
}

export type LearningView = NonNullable<Awaited<ReturnType<typeof loadLearningView>>>;

/** Ngày hôm nay theo giờ Việt Nam — dùng cho ghi chú "tính lúc". */
export function todayKey(now: Date): string {
  return formatDateKey(now);
}

export type { InsightSample };
