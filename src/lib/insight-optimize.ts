import "server-only";

import { prisma } from "./prisma";
import { formatDateKey, parseHm, type PillarLike } from "./autopilot-plan";
import {
  bandOfDate,
  hookStyleOf,
  mediaKindOf,
  MIN_SAMPLES_FOR_EXPLOIT,
  PERFORMANCE_WINDOW_DAYS,
  PROBE_MAX_POSTS,
  type HookStyle,
} from "./insights-core";
import {
  analyzePerformance,
  buildInsightLines,
  PERFORMANCE_SAFETY_CLAUSE,
  suggestHookStyle,
  suggestPillarWeights,
  suggestTimeBias,
  type InsightSample,
  type PerformanceReport,
  type PillarWeightSuggestion,
  type TimeBias,
} from "./insights-report";
import {
  buildCommentary,
  computeDirections,
  detectRegression,
  evaluateProbeResults,
  LEARNING_PHASE_LABELS,
  planProbeBatch,
  resolveLearningPhase,
  type Commentary,
  type DirectionDraft,
  type LearningPhase,
  type ProbePlan,
  type RegressionReport,
} from "./learning-cycle";

// ============================================================
// CẦU NỐI GIỮA DATABASE VÀ CÁC MODULE THUẦN
//
// Đây là nơi duy nhất biết cả hai thế giới: Prisma ở một bên, các hàm phân tích
// thuần ở bên kia. Nhờ vậy logic dễ sai (xếp hạng, dò, nhận xét) vẫn nằm trong
// file không có I/O và kiểm thử được, còn tầng này chỉ làm nhiệm vụ đọc/ghi.
//
// HAI HÀM CHÍNH
//   loadOptimizationInput — đọc dữ liệu thô thành mẫu phân tích được.
//   runVerifier           — chạy toàn bộ vòng kiểm tra và ghi kết luận.
//
// NGUYÊN TẮC: KHÔNG BAO GIỜ ghi vào ContentPillar, BrandProfile hay bất kỳ
// bảng nào thuộc nội dung thương hiệu. Trọng số hiệu dụng chỉ tồn tại trong bộ
// nhớ của lượt lập kế hoạch.
// ============================================================

/** Số bài tối đa nạp để phân tích. Nhiều hơn không giúp ích mà chỉ tốn RAM. */
const MAX_SAMPLES = 150;
/** Coi cấu hình là "vừa đổi" trong ngần này ngày. */
const CONFIG_CHANGE_WINDOW_DAYS = 7;

export type OptimizationInput = {
  samples: InsightSample[];
  report: PerformanceReport;
  /** Số bài AutoPilot đã ĐĂNG (đếm thật) — dùng quyết định giai đoạn. */
  totalPublishedAutoPilot: number;
  /** Số bài dò đã tạo trong đợt hiện tại (đếm từ Post.probeKind). */
  probePostsSoFar: number;
  hasServiceAreas: boolean;
};

/**
 * Đọc dữ liệu thô của một Page thành mẫu phân tích được.
 *
 * CHỈ LẤY BÀI AUTOPILOT: bài người dùng tự soạn phục vụ mục đích riêng (chiến
 * dịch, thông báo, tuyển dụng...) nên học từ chúng sẽ dạy hệ thống những hướng
 * không lặp lại được. Chúng vẫn hiển thị ở trang Số liệu để người dùng tham
 * khảo, nhưng không tham gia tính toán.
 *
 * BÀI CHƯA ĐỦ CHÍN BỊ LOẠI: Facebook chốt số liệu sau ~24h. Tính cả bài vừa
 * đăng sẽ khiến mọi hướng "mới nhất" trông kém hiệu quả (vì chưa kịp tăng),
 * và hệ thống sẽ liên tục đổi hướng vì nhiễu.
 */
export async function loadOptimizationInput(
  pageId: string,
  now: Date
): Promise<OptimizationInput> {
  const windowStart = new Date(
    now.getTime() - PERFORMANCE_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );

  const [posts, totalPublishedAutoPilot, probePostsSoFar, brandId] = await Promise.all([
    prisma.post.findMany({
      where: {
        pageId,
        origin: "AUTOPILOT",
        status: "PUBLISHED",
        publishedAt: { gte: windowStart },
      },
      orderBy: { publishedAt: "desc" },
      take: MAX_SAMPLES,
      select: {
        id: true,
        hook: true,
        content: true,
        pillarName: true,
        serviceArea: true,
        topic: true,
        probeKind: true,
        publishedAt: true,
        media: { select: { type: true } },
        insight: {
          select: {
            reactions: true,
            comments: true,
            shares: true,
            mediaView: true,
            impressions: true,
            videoViews: true,
            status: true,
          },
        },
      },
    }),
    prisma.post.count({
      where: { pageId, origin: "AUTOPILOT", status: "PUBLISHED" },
    }),
    prisma.post.count({
      where: { pageId, origin: "AUTOPILOT", status: "PUBLISHED", probeKind: "PROBE" },
    }),
    prisma.facebookPage.findUnique({
      where: { id: pageId },
      select: { brandId: true },
    }),
  ]);

  const samples: InsightSample[] = [];

  for (const p of posts) {
    if (!p.publishedAt) continue;

    // Số liệu chưa chốt (bài mới) hoặc lỗi → không dùng để học
    if (p.insight && p.insight.status === "FRESH") continue;

    const hookText = p.hook?.trim() || p.content.split("\n")[0]?.trim() || "";

    samples.push({
      postId: p.id,
      pillarName: p.pillarName,
      serviceArea: p.serviceArea,
      hook: hookText,
      hookStyle: hookStyleOf(hookText),
      topic: p.topic,
      contentChars: p.content.length,
      mediaKind: mediaKindOf(p.media.map((m) => m.type)),
      band: bandOfDate(p.publishedAt),
      publishedAt: p.publishedAt,
      probeKind: p.probeKind,
      reactions: p.insight?.reactions ?? 0,
      comments: p.insight?.comments ?? 0,
      shares: p.insight?.shares ?? 0,
      distributionValue: distributionOf(p.insight),
    });
  }

  const hasServiceAreas = brandId?.brandId
    ? Boolean(
        (
          await prisma.brandProfile.findUnique({
            where: { brandId: brandId.brandId },
            select: { serviceAreas: true },
          })
        )?.serviceAreas?.trim()
      )
    : false;

  return {
    samples,
    report: analyzePerformance(samples, { now, windowDays: PERFORMANCE_WINDOW_DAYS }),
    totalPublishedAutoPilot,
    probePostsSoFar,
    hasServiceAreas,
  };
}

function distributionOf(insight: {
  mediaView: number | null;
  impressions: number | null;
  videoViews: number | null;
} | null): number | null {
  if (!insight) return null;
  for (const candidate of [insight.mediaView, insight.impressions, insight.videoViews]) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  }
  return null;
}

// ============================================================
// Trạng thái học đầy đủ
// ============================================================

export type LearningState = {
  phase: LearningPhase;
  phaseLabel: string;
  report: PerformanceReport;
  regression: RegressionReport;
  probePlan: ProbePlan;
  directions: DirectionDraft[];
  commentary: Commentary;
  pillarSuggestion: PillarWeightSuggestion;
  timeBias: TimeBias | null;
  timeBiasReason: string;
  hookSuggestion: ReturnType<typeof suggestHookStyle>;
  performanceLines: string[];
  totalPublishedAutoPilot: number;
  probePostsSoFar: number;
  probeBudget: number;
  /** Số bài còn thiếu để bắt đầu tối ưu (0 = đã đủ). */
  missingForExploit: number;
};

/**
 * Tính trạng thái học đầy đủ của một Page — KHÔNG ghi gì xuống DB.
 *
 * Tách khỏi `runVerifier` để tầng lập kế hoạch gọi được mà không kèm tác dụng
 * phụ ghi DB (lượt lập kế hoạch chạy thường xuyên; ghi DB mỗi lần là lãng phí
 * và tạo tranh chấp không cần thiết).
 */
export async function computeLearningState(
  pageId: string,
  config: {
    windowStart: string;
    windowEnd: string;
    minGapMinutes: number;
    mediaMix: string;
    lastReProbeAt: Date | null;
    updatedAt: Date;
  },
  now: Date,
  pillars: { name: string; weight: number }[]
): Promise<LearningState> {
  const input = await loadOptimizationInput(pageId, now);

  const regression = detectRegression({
    report: input.report,
    // Không có lịch sử báo cáo cũ trong DB (báo cáo được tính lại từ dữ liệu
    // thô mỗi lần) nên tín hiệu "so lần phân tích trước" lấy từ chính hai cửa
    // sổ 7 ngày bên trong báo cáo — xem chú thích ở detectRegression.
    previous: null,
    lastReProbeAt: config.lastReProbeAt,
    configChangedRecently:
      now.getTime() - config.updatedAt.getTime() <
      CONFIG_CHANGE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    now,
  });

  const phase = resolveLearningPhase({
    totalPublishedAutoPilot: input.totalPublishedAutoPilot,
    report: input.report,
    regression,
    // Hết ngân sách dò → thoát dò. Xem chú thích ở resolveLearningPhase.
    probeBudgetExhausted: input.probePostsSoFar >= PROBE_MAX_POSTS,
  });

  const probePlan = planProbeBatch({
    phase,
    pillars,
    previousEntries: await loadProbeEntries(pageId),
    config: {
      mediaMix: config.mediaMix,
      windowStart: config.windowStart,
      windowEnd: config.windowEnd,
      minGapMinutes: config.minGapMinutes,
    },
    probePostsSoFar: input.probePostsSoFar,
    remainingBudget: PROBE_MAX_POSTS,
    hasServiceAreas: input.hasServiceAreas,
    seed: formatDateKey(now),
  });

  const directions = computeDirections(input.report);
  const commentary = buildCommentary(input.report, directions, phase, regression, {
    used: input.probePostsSoFar,
    budget: PROBE_MAX_POSTS,
  });

  const pillarSuggestion = suggestPillarWeights(pillars, input.report);
  const timeSuggestion = suggestTimeBias(input.report, config, parseHm);
  const hookSuggestion = suggestHookStyle(input.report);

  return {
    phase,
    phaseLabel: LEARNING_PHASE_LABELS[phase],
    report: input.report,
    regression,
    probePlan,
    directions,
    commentary,
    pillarSuggestion,
    timeBias: timeSuggestion.bias,
    timeBiasReason: timeSuggestion.reason || timeSuggestion.bias?.reason || "",
    hookSuggestion,
    performanceLines: buildInsightLines(input.report),
    totalPublishedAutoPilot: input.totalPublishedAutoPilot,
    probePostsSoFar: input.probePostsSoFar,
    probeBudget: PROBE_MAX_POSTS,
    missingForExploit: Math.max(
      MIN_SAMPLES_FOR_EXPLOIT - input.totalPublishedAutoPilot,
      0
    ),
  };
}

/** Nhật ký dò của Page (mọi đợt) — dùng để loại hướng đã thất bại. */
async function loadProbeEntries(
  pageId: string
): Promise<{ kind: string; value: string; result: string }[]> {
  const entries = await prisma.probeEntry.findMany({
    where: { pageId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { kind: true, value: true, result: true },
  });
  return entries;
}

// ============================================================
// Vòng kiểm tra có ghi DB
// ============================================================

export type VerifierResult = {
  phase: LearningPhase;
  phaseChanged: boolean;
  previousPhase: string;
  commentary: Commentary;
  regression: RegressionReport;
  /** Số hướng được cập nhật trong ContentDirection. */
  directionsUpdated: number;
  /** Kết luận đã lưu (cache 24h). */
  conclusion: string;
};

/**
 * Chạy bước kiểm tra và ghi kết quả xuống DB.
 *
 * GỒM BỐN VIỆC:
 *   1. Tính trạng thái học (giai đoạn, dò, nhận xét).
 *   2. Kết luận kết quả từng hướng dò đã thử (GOOD/BAD/NEUTRAL).
 *   3. Ghi lại ContentDirection — dữ liệu cho phần "nhận xét".
 *   4. Ghi cache kết luận vào AutoPilot + thông báo khi ĐỔI GIAI ĐOẠN.
 *
 * Chỉ thông báo khi giai đoạn ĐỔI, không thông báo mỗi lượt: vòng kiểm tra
 * chạy định kỳ nên báo mỗi lần sẽ thành spam — đúng lỗi đã từng xảy ra với
 * thông báo "AutoPilot bắt đầu chạy" (xem lib/scheduler.ts).
 *
 * Không bao giờ ném lỗi: hàm này chạy trong luồng lập kế hoạch, lỗi ở đây
 * không được phép làm mất bài.
 */
export async function runVerifier(
  pageId: string,
  now: Date = new Date()
): Promise<VerifierResult | null> {
  try {
    const page = await prisma.facebookPage.findUnique({
      where: { id: pageId },
      select: { brandId: true, userId: true, name: true },
    });
    if (!page) return null;

    const autopilot = await prisma.autoPilot.findUnique({ where: { pageId } });
    if (!autopilot) return null;

    const pillars = await prisma.contentPillar.findMany({
      where: page.brandId ? { brandId: page.brandId, enabled: true } : { pageId, enabled: true },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { name: true, weight: true },
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
      pillars
    );

    const previousPhase = autopilot.learningPhase;
    const phaseChanged = previousPhase !== state.phase;

    // ---- Kết luận từng hướng dò ----
    const batchEntries = await prisma.probeEntry.findMany({
      where: { pageId },
      orderBy: { createdAt: "desc" },
      take: 60,
      select: { id: true, kind: true, value: true, result: true },
    });

    if (batchEntries.length > 0) {
      const evaluated = evaluateProbeResults(batchEntries, state.report);
      for (const item of evaluated) {
        const row = batchEntries.find(
          (e) => e.kind === item.kind && e.value === item.value
        );
        if (!row) continue;
        if (row.result === item.result) continue;

        await prisma.probeEntry
          .update({
            where: { id: row.id },
            data: { result: item.result, score: item.score },
          })
          .catch(() => {
            /* trùng khoá do chạy chồng — lần sau sẽ cập nhật */
          });
      }
    }

    // ---- Ghi hướng nội dung đang triển khai ----
    const workspaceId = await workspaceIdOf(pageId);
    let directionsUpdated = 0;

    for (const d of state.directions) {
      await prisma.contentDirection
        .upsert({
          where: { pageId_kind_value: { pageId, kind: d.kind, value: d.value } },
          update: {
            status: d.status,
            sampleSize: d.sampleSize,
            avgScore: d.avgScore,
            prevAvgScore: d.prevAvgScore,
            changePct: d.changePct,
            estLifeDays: d.estLifeDays,
            recommendation: d.recommendation,
            lastEvaluatedAt: now,
          },
          create: {
            pageId,
            workspaceId,
            kind: d.kind,
            value: d.value,
            status: d.status,
            sampleSize: d.sampleSize,
            avgScore: d.avgScore,
            prevAvgScore: d.prevAvgScore,
            changePct: d.changePct,
            estLifeDays: d.estLifeDays,
            recommendation: d.recommendation,
            lastEvaluatedAt: now,
          },
        })
        .catch((err) => {
          console.error(
            `[insights] không ghi được hướng ${d.kind}:${d.value}: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        });
      directionsUpdated++;
    }

    // ---- Cache kết luận (tái tạo được từ dữ liệu thô) ----
    const conclusion = JSON.stringify({
      headline: state.commentary.headline,
      directionSummary: state.commentary.directionSummary,
      bullets: state.commentary.bullets,
      actions: state.commentary.actions,
      phase: state.phase,
      sampleSize: state.report.sampleSize,
      confidence: state.report.confidence,
    });

    await prisma.autoPilot
      .update({
        where: { pageId },
        data: {
          learningPhase: state.phase,
          learningConclusion: conclusion,
          learningComputedAt: now,
          ...(state.phase === "PROBE" && autopilot.probeStartedAt === null
            ? { probeStartedAt: now }
            : {}),
          ...(state.phase === "REPROBE" ? { lastReProbeAt: now } : {}),
          probeRedistributed: state.probePostsSoFar,
        },
      })
      .catch((err) => {
        console.error(
          `[insights] không ghi được trạng thái học của Page ${pageId}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      });

    // ---- Thông báo khi ĐỔI giai đoạn ----
    if (phaseChanged) {
      await notifyPhaseChange(page.userId, page.name, state, previousPhase).catch(() => {});
    }

    return {
      phase: state.phase,
      phaseChanged,
      previousPhase,
      commentary: state.commentary,
      regression: state.regression,
      directionsUpdated,
      conclusion,
    };
  } catch (err) {
    console.error(
      `[insights] bước kiểm tra thất bại cho Page ${pageId}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return null;
  }
}

async function workspaceIdOf(pageId: string): Promise<string | null> {
  const page = await prisma.facebookPage
    .findUnique({ where: { id: pageId }, select: { workspaceId: true } })
    .catch(() => null);
  return page?.workspaceId ?? null;
}

async function notifyPhaseChange(
  userId: string,
  pageName: string,
  state: LearningState,
  previousPhase: string
) {
  const { notify } = await import("./notify");

  if (state.phase === "EXPLOIT" && previousPhase !== "EXPLOIT") {
    await notify(userId, {
      type: "ACTIVITY",
      title: "🚀 Đã đủ dữ liệu — bắt đầu tối ưu bài đăng",
      body:
        `Page "${pageName}" đã có ${state.report.sampleSize} bài đủ dữ liệu để phân tích. ` +
        `Từ giờ hệ thống dùng số liệu thật để chọn trụ cột, khung giờ và cách mở bài. ${state.commentary.directionSummary}`,
      link: "/insights",
    });
    return;
  }

  if (state.phase === "REPROBE") {
    await notify(userId, {
      type: "ACTIVITY",
      title: "🔁 Số liệu đang giảm — đang dò lại hướng mới",
      body:
        `Page "${pageName}": ${state.regression.reason} ` +
        `Hệ thống tạm chuyển sang dò tìm hướng mới. Nội dung thương hiệu vẫn giữ nguyên, chỉ đổi cách triển khai.`,
      link: "/insights",
    });
    return;
  }

  if (state.phase === "PROBE") {
    await notify(userId, {
      type: "ACTIVITY",
      title: "🔬 Bắt đầu dò tìm hướng đi cho Page",
      body:
        `Page "${pageName}" sẽ dò có kiểm soát trong ${PROBE_MAX_POSTS} bài đầu: trải đều các trụ cột, ` +
        `kiểu mở bài và khung giờ để tìm ra hướng người xem đáp lại tốt nhất.`,
      link: "/insights",
    });
  }
}

// ============================================================
// Áp dụng vào lập kế hoạch
// ============================================================

/**
 * Trọng số trụ cột HIỆU DỤNG cho lượt lập kế hoạch này.
 *
 * KHÔNG ghi vào DB. Trả về bản sao có trọng số đã điều chỉnh (hoặc bằng nhau
 * khi đang dò) để `pickPillar` dùng — hàm đó không hề biết trọng số đến từ đâu.
 *
 * Trong giai đoạn dò, trọng số được đặt BẰNG NHAU: mục đích của dò là trải đều
 * để lấy dữ liệu, nên trọng số người dùng đặt tạm chưa có ý nghĩa. Cố ý không
 * nhân trọng số trong lúc dò — nếu vừa dò vừa nhân thì tạo vòng lặp tự củng cố
 * (hướng được chọn nhiều vì trọng số cao, rồi trọng số lại cao vì được chọn
 * nhiều) và dữ liệu thu được sẽ thiên lệch.
 */
export function effectivePillars(
  pillars: PillarLike[],
  state: LearningState
): PillarLike[] {
  if (state.phase === "PROBE" || state.phase === "REPROBE") {
    return pillars.map((p) => ({ ...p, weight: 1 }));
  }

  if (!state.pillarSuggestion.applied) return pillars;

  return pillars.map((p) => ({
    ...p,
    weight: Math.max(1, Math.round(state.pillarSuggestion.weights[p.name] ?? p.weight)),
  }));
}

/**
 * Ghi chú ngắn lưu vào `Post.optimizationNote` — để sau này người dùng xem lại
 * biết vì sao bài đó được viết/đăng như vậy.
 */
export function optimizationNoteOf(
  state: LearningState,
  parts: { pillarName?: string | null; band?: string | null; hookStyle?: string | null }
): string {
  const bits: string[] = [];

  if (state.phase === "PROBE") bits.push("Dò tìm hướng");
  else if (state.phase === "REPROBE") bits.push("Dò lại do số liệu giảm");

  if (parts.pillarName) bits.push(`trụ cột "${parts.pillarName}"`);
  if (parts.hookStyle) bits.push(`kiểu mở bài ${parts.hookStyle}`);
  if (parts.band) bits.push(`khung ${parts.band}`);
  if (state.timeBias && state.phase === "EXPLOIT") {
    bits.push(`ưu tiên khung giờ tốt`);
  }

  return bits.join(" · ") || "Chưa áp dụng tối ưu theo số liệu";
}

/** Dòng chỉ thị dò để đưa vào prompt (chỉ nói về CÁCH VIẾT). */
export function probePromptLines(note: string): string[] {
  if (!note.trim()) return [];
  return [
    "=== HƯỚNG DÒ CHO BÀI NÀY (đang tìm hướng đi ban đầu) ===",
    note,
    "- Đây là chỉ thị về CÁCH TRÌNH BÀY, không phải chủ đề mới ngoài hồ sơ thương hiệu.",
    "- Mọi thông tin về sản phẩm, giá, địa chỉ, địa bàn vẫn chỉ lấy từ hồ sơ thương hiệu ở trên.",
  ];
}

/** Tiến độ học để hiển thị ở giao diện. */
export type LearningProgress = {
  phase: LearningPhase;
  phaseLabel: string;
  sampleSize: number;
  missingForExploit: number;
  probeUsed: number;
  probeBudget: number;
  probeExhausted: boolean;
  reachAvailable: boolean;
};

export function learningProgressOf(state: LearningState): LearningProgress {
  return {
    phase: state.phase,
    phaseLabel: state.phaseLabel,
    sampleSize: state.report.sampleSize,
    missingForExploit: state.missingForExploit,
    probeUsed: state.probePostsSoFar,
    probeBudget: state.probeBudget,
    probeExhausted: state.probePlan.exhausted,
    reachAvailable: state.report.reachAvailable,
  };
}

export { PERFORMANCE_SAFETY_CLAUSE, type HookStyle };
