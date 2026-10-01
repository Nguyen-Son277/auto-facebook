import "server-only";

import { prisma } from "./prisma";
import { formatDateKey, parseHm, type PillarLike } from "./autopilot-plan";
import {
  bandOfDate,
  HOOK_STYLE_INSTRUCTIONS,
  HOOK_STYLE_LABELS,
  HOOK_STYLES,
  hookStyleOf,
  isMatureForLearning,
  mediaKindOf,
  MIN_SAMPLES_FOR_EXPLOIT,
  MIN_SAMPLES_PER_DIRECTION,
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
  ADJUSTMENT_EVAL_DAYS,
  ADJUSTMENT_LOCK_DAYS,
  buildCommentary,
  computeDirections,
  computeExplorationRate,
  detectRegression,
  DIRECTION_WEIGHT_FACTOR,
  evaluateAdjustment,
  evaluateProbeResults,
  LEARNING_PHASE_LABELS,
  limitWeightStep,
  planExplorationQuotas,
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
  /**
   * Số bài dò đã tạo trong ĐỢT HIỆN TẠI (đếm từ Post.probeKind), gồm cả bài
   * còn chờ duyệt/chờ đăng.
   *
   * ⚠️ PHẢI tính theo đợt, không tính từ trước tới nay (lỗi thật đã gặp): đếm
   * toàn thời gian thì sau 12 bài dò đầu tiên, `probeBudgetExhausted` vĩnh viễn
   * true — REPROBE không bao giờ tạo được bài dò nào nữa và việc "dò lại khi số
   * liệu tụt" thành vô hiệu suốt đời Page.
   *
   * ⚠️ PHẢI đếm cả bài chưa đăng: bài dò đã lên lịch 7 ngày tới vẫn tiêu ngân
   * sách. Chỉ đếm bài PUBLISHED thì mỗi lượt lập kế hoạch lại thấy "còn ngân
   * sách" và tạo thêm, vượt xa 12 bài.
   */
  probePostsSoFar: number;
  /** Mốc bắt đầu đợt dò hiện tại — khoá ổn định để gom ProbeEntry cùng đợt. */
  batchStartedAt: Date | null;
  hasServiceAreas: boolean;
};

/** Trạng thái ngân sách dò của đợt hiện tại. */
export type ProbeBudgetConfig = {
  /** Mốc vào REPROBE gần nhất. */
  lastReProbeAt: Date | null;
  /** Mốc bắt đầu dò lần đầu. */
  probeStartedAt: Date | null;
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
  now: Date,
  probe: ProbeBudgetConfig = { lastReProbeAt: null, probeStartedAt: null }
): Promise<OptimizationInput> {
  const windowStart = new Date(
    now.getTime() - PERFORMANCE_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );

  // Đợt dò hiện tại bắt đầu từ lần vào REPROBE gần nhất; chưa từng dò lại thì
  // lấy mốc bắt đầu dò lần đầu.
  //
  // ⚠️ THỨ TỰ QUAN TRỌNG: `probeStartedAt` phải được BƯỚC LẬP KẾ HOẠCH ghi
  // TRƯỚC khi tạo bài dò đầu tiên (xem planForAutoPilot). Nếu để bước kiểm tra
  // ghi sau, mốc nằm SAU những bài dò đầu tiên, nên lượt sau đếm được 0 bài,
  // ngân sách tưởng còn nguyên và bộ dò tạo vượt trần. `firstProbe` chỉ là lưới
  // an toàn cho dữ liệu cũ (bài dò có trước khi tính năng này ra đời).
  const firstProbe = await prisma.post
    .findFirst({
      where: { pageId, origin: "AUTOPILOT", probeKind: "PROBE" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    })
    .catch(() => null);
  const batchStartedAt =
    probe.lastReProbeAt ?? probe.probeStartedAt ?? firstProbe?.createdAt ?? null;
  const probeScope = batchStartedAt ? { createdAt: { gte: batchStartedAt } } : {};

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
        hookStyle: true,
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
      where: {
        pageId,
        origin: "AUTOPILOT",
        probeKind: "PROBE",
        status: { in: ["PENDING_REVIEW", "SCHEDULED", "PUBLISHING", "PUBLISHED"] },
        ...probeScope,
      },
    }),
    prisma.facebookPage.findUnique({
      where: { id: pageId },
      select: { brandId: true },
    }),
  ]);

  const samples: InsightSample[] = [];

  for (const p of posts) {
    if (!p.publishedAt) continue;

    // Chỉ học từ bài ĐÃ CHÍN và ĐÃ CÓ số liệu thật. Không có dòng insight nghĩa
    // là chưa từng thu thập — tính nó với 0 tương tác sẽ kéo trend 7 ngày xuống
    // và sinh tín hiệu "tụt" giả. Không chỗ nào ghi FRESH cho bài < 24h nên
    // phải tự kiểm tra tuổi bài.
    if (!p.insight) continue;
    if (p.insight.status === "FRESH") continue;
    if (!isMatureForLearning(p.publishedAt, now)) continue;

    const hookText = p.hook?.trim() || p.content.split("\n")[0]?.trim() || "";
    // Kiểu mở bài ĐÃ YÊU CẦU được lưu ở Post.hookStyle (bài dò ghi chỉ thị vào
    // đó). Chỉ khi không có mới đoán lại từ câu mở bài — đoán bằng regex hay
    // lệch với chỉ thị thật, khiến quota dò và kết quả chấm nói về hai thứ khác nhau.
    const requestedHook =
      p.hookStyle && HOOK_STYLES.includes(p.hookStyle as HookStyle)
        ? (p.hookStyle as HookStyle)
        : null;

    samples.push({
      postId: p.id,
      pillarName: p.pillarName,
      serviceArea: p.serviceArea,
      hook: hookText,
      hookStyle: requestedHook ?? hookStyleOf(hookText),
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
    batchStartedAt,
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

  // ---- Vòng học khép kín ----
  /** Mốc bắt đầu đợt dò hiện tại — khoá gom ProbeEntry của cùng đợt. */
  batchStartedAt: Date | null;
  /** Số mẫu ĐÃ CHÍN có số liệu (khác totalPublishedAutoPilot). */
  matureSamples: number;
  /**
   * Tỉ lệ slot dành cho thử hướng mới ở giai đoạn khai thác (0.1–0.4).
   * Tự điều chỉnh: ít dữ liệu hoặc đang tụt thì tăng, ổn định thì giảm.
   */
  explorationRate: number;
  /** Kế hoạch quota cho các slot thử nghiệm ở EXPLOIT (rỗng khi đang dò). */
  explorePlan: ProbePlan;
  /**
   * Trọng số trụ cột HIỆU DỤNG đã qua đủ rào chắn: gợi ý theo số liệu, hệ số
   * theo trạng thái hướng, giới hạn ±25%/chu kỳ, và khoá sau rollback.
   */
  effectiveWeights: Record<string, number>;
  /** Những chiều đang bị khoá vì vừa rollback (không áp điều chỉnh mới). */
  lockedKinds: string[];
  /** Tỉ lệ video hiệu dụng khi mediaMix=MIXED. null = dùng cấu hình người dùng. */
  videoPercentOverride: number | null;
  /** Trọng số địa bàn theo hiệu quả (dùng phá hoà trên nền xoay vòng). */
  serviceAreaWeights: Record<string, number>;
  /** Góc/chủ đề đã hiệu quả — đưa vào prompt làm ví dụ nên triển khai biến thể. */
  winningTopics: string[];
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
    videoPercent?: number;
    lastReProbeAt: Date | null;
    probeStartedAt?: Date | null;
    updatedAt: Date;
  },
  now: Date,
  pillars: { name: string; weight: number }[]
): Promise<LearningState> {
  const input = await loadOptimizationInput(pageId, now, {
    lastReProbeAt: config.lastReProbeAt,
    probeStartedAt: config.probeStartedAt ?? null,
  });

  // Ảnh chụp lịch sử + nhật ký điều chỉnh: đọc song song, cả hai đều chỉ để
  // tham chiếu nên lỗi một bên không được làm sập việc lập kế hoạch.
  const [snapshots, adjustments, probeEntries] = await Promise.all([
    loadSnapshots(pageId),
    loadAdjustments(pageId),
    loadProbeEntries(pageId),
  ]);

  const regression = detectRegression({
    report: input.report,
    // Mốc so sánh dài hạn lấy từ ảnh chụp 14–28 ngày trước. Có mốc này thì tín
    // hiệu BASELINE_DROP mới bắt được kiểu tụt chậm (mỗi tuần giảm một ít, không
    // tuần nào đủ 25% nên trend 7 ngày không thấy). Trước đây luôn truyền null
    // nên tín hiệu đó không bao giờ kích hoạt.
    previous: baselineFrom(snapshots, now),
    lastReProbeAt: config.lastReProbeAt,
    configChangedRecently:
      now.getTime() - config.updatedAt.getTime() <
      CONFIG_CHANGE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    now,
  });

  const phase = resolveLearningPhase({
    totalPublishedAutoPilot: input.totalPublishedAutoPilot,
    // Đếm MẪU ĐÃ CHÍN: mọi bộ gợi ý phía sau chỉ thấy mẫu chín, nên vào EXPLOIT
    // theo số bài đã đăng thô nghĩa là "ngừng dò mà chẳng khai thác được gì".
    matureSamples: input.report.sampleSize,
    report: input.report,
    regression,
    // Hết ngân sách dò → thoát dò. Ngân sách đếm theo ĐỢT (xem
    // loadOptimizationInput), nên REPROBE vẫn có ngân sách mới.
    probeBudgetExhausted: input.probePostsSoFar >= PROBE_MAX_POSTS,
    reprobeInProgress: isReprobeInProgress(input, config.lastReProbeAt, now),
  });

  const probePlan = planProbeBatch({
    phase,
    pillars,
    previousEntries: probeEntries,
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
    // Khoá ỔN ĐỊNH theo mốc bắt đầu đợt: ProbeEntry của cùng một đợt gom về một
    // batchId qua nhiều lượt chạy, nhờ vậy việc chấm kết quả mới cộng dồn được.
    batchKey: input.batchStartedAt
      ? String(input.batchStartedAt.getTime())
      : undefined,
  });

  const directions = computeDirections(input.report);
  const commentary = buildCommentary(input.report, directions, phase, regression, {
    used: input.probePostsSoFar,
    budget: PROBE_MAX_POSTS,
  });

  // ⚠️ BỎ ảnh chụp CỦA HÔM NAY khỏi mốc so sánh (lỗi thật đã gặp): hàm này chạy
  // nhiều lần trong ngày và mỗi lần lại upsert dòng của hôm nay. Lấy dòng đó
  // làm mốc thì giới hạn "đổi tối đa 0.05 mỗi NGÀY" thành "0.05 mỗi LƯỢT", và
  // chỉ số trôi hết biên trong vài chục lượt cron.
  const todayKey = formatDateKey(now);
  const previousDays = snapshots.filter((s) => s.dayKey !== todayKey);
  const explorationRate = computeExplorationRate({
    report: input.report,
    directions,
    snapshots: previousDays,
  });

  const explorePlan =
    phase === "EXPLOIT"
      ? planExplorationQuotas({
          report: input.report,
          pillars,
          previousEntries: probeEntries,
          config: {
            mediaMix: config.mediaMix,
            windowStart: config.windowStart,
            windowEnd: config.windowEnd,
          },
          batchId: `EXPLORE-${formatDateKey(now)}`,
        })
      : emptyPlan();

  const pillarSuggestion = suggestPillarWeights(pillars, input.report);
  const timeSuggestion = suggestTimeBias(input.report, config, parseHm);
  const hookSuggestion = suggestHookStyle(input.report);

  // Chiều nào vừa bị rollback thì đang trong thời gian khoá — không áp điều
  // chỉnh mới cho chiều đó, nếu không hệ thống sẽ đẩy lại đúng thay đổi vừa bị
  // chứng minh là tệ (rung qua lại).
  const lockedKinds = adjustments
    .filter(
      (a) =>
        a.status === "ROLLED_BACK" &&
        a.lockedUntil !== null &&
        a.lockedUntil.getTime() > now.getTime()
    )
    .map((a) => a.kind);
  const locked = new Set(lockedKinds);

  const effectiveWeights = computeEffectiveWeights({
    pillars,
    phase,
    pillarSuggestion,
    directions,
    previous: lastAppliedWeights(adjustments),
    locked: locked.has("PILLAR_WEIGHT"),
  });

  return {
    phase,
    phaseLabel: LEARNING_PHASE_LABELS[phase],
    report: input.report,
    regression,
    probePlan,
    directions,
    commentary,
    pillarSuggestion,
    timeBias: locked.has("TIME_BIAS") ? null : timeSuggestion.bias,
    timeBiasReason: locked.has("TIME_BIAS")
      ? "Khung giờ ưu tiên đang tạm khoá sau một lần điều chỉnh không hiệu quả."
      : timeSuggestion.reason || timeSuggestion.bias?.reason || "",
    hookSuggestion: locked.has("HOOK")
      ? { style: null, reason: "Kiểu mở bài đang tạm khoá sau một lần điều chỉnh không hiệu quả." }
      : hookSuggestion,
    performanceLines: buildInsightLines(input.report),
    totalPublishedAutoPilot: input.totalPublishedAutoPilot,
    probePostsSoFar: input.probePostsSoFar,
    probeBudget: PROBE_MAX_POSTS,
    // Đếm theo mẫu đã chín để khớp với điều kiện chuyển pha ở trên: hiện số
    // "còn thiếu 2 bài" trong khi pha lại dựa trên con số khác là sai lệch.
    missingForExploit: Math.max(MIN_SAMPLES_FOR_EXPLOIT - input.report.sampleSize, 0),
    batchStartedAt: input.batchStartedAt,
    matureSamples: input.report.sampleSize,
    explorationRate,
    explorePlan,
    effectiveWeights,
    lockedKinds,
    videoPercentOverride: locked.has("MEDIA_MIX")
      ? null
      : suggestVideoPercent(input.report, config.mediaMix, config.videoPercent ?? 25),
    serviceAreaWeights: serviceAreaWeightsOf(input.report),
    winningTopics: winningTopicsOf(input.report),
  };
}

/** Kế hoạch rỗng — dùng khi không ở giai đoạn khai thác. */
function emptyPlan(): ProbePlan {
  return {
    batchId: "",
    quotas: [],
    totalQuota: 0,
    exhausted: false,
    reason: "",
  };
}

/** Đợt dò lại quá ngần này ngày thì coi như bỏ dở, không giữ pha REPROBE nữa. */
export const REPROBE_MAX_AGE_DAYS = 21;

/**
 * Đang trong một đợt DÒ LẠI chưa xong hay không.
 *
 * VÌ SAO CẦN CỜ NÀY (lỗi thật đã gặp): tín hiệu tụt chỉ bật được một lần. Ngay
 * sau khi chuyển sang REPROBE, `lastReProbeAt` được ghi và cooldown 14 ngày
 * chặn mọi tín hiệu tụt tiếp theo — hết cooldown thì tín hiệu "tụt so với 7
 * ngày trước" cũng không còn đúng nữa. Không có cờ này, REPROBE sống đúng MỘT
 * lượt rồi Page quay về khai thác, và đợt dò lại không bao giờ tạo đủ bài để
 * rút ra kết luận gì. Việc "tự dò lại khi số liệu tụt" vì thế vô hiệu.
 *
 * Điều kiện kết thúc: hết ngân sách (xét riêng ở resolveLearningPhase), hoặc
 * đợt đã cũ quá REPROBE_MAX_AGE_DAYS (Page ít người xem không được kẹt ở dò mãi).
 */
function isReprobeInProgress(
  input: OptimizationInput,
  lastReProbeAt: Date | null,
  now: Date
): boolean {
  if (lastReProbeAt === null) return false;
  if (input.batchStartedAt === null) return false;
  // Đợt hiện tại phải CHÍNH LÀ đợt dò lại (mốc đợt trùng mốc vào REPROBE)
  if (input.batchStartedAt.getTime() !== lastReProbeAt.getTime()) return false;
  if (input.probePostsSoFar >= PROBE_MAX_POSTS) return false;
  return (
    now.getTime() - lastReProbeAt.getTime() <
    REPROBE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000
  );
}

/** Nhật ký dò của Page (mọi đợt) — dùng để loại hướng đã thất bại. */
async function loadProbeEntries(
  pageId: string
): Promise<{ kind: string; value: string; result: string }[]> {
  return prisma.probeEntry
    .findMany({
      where: { pageId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { kind: true, value: true, result: true },
    })
    .catch(() => []);
}

/** Ảnh chụp gần nhất trước (mới nhất đầu danh sách). */
async function loadSnapshots(pageId: string): Promise<
  {
    dayKey: string;
    at: Date;
    medianScore: number;
    sampleSize: number;
    explorationRate: number;
  }[]
> {
  return prisma.learningSnapshot
    .findMany({
      where: { pageId },
      orderBy: { at: "desc" },
      take: 30,
      select: {
        dayKey: true,
        at: true,
        medianScore: true,
        sampleSize: true,
        explorationRate: true,
      },
    })
    .catch(() => []);
}

async function loadAdjustments(pageId: string): Promise<
  {
    id: string;
    kind: string;
    before: string;
    after: string;
    status: string;
    lockedUntil: Date | null;
    appliedAt: Date;
  }[]
> {
  return prisma.learningAdjustment
    .findMany({
      where: { pageId },
      orderBy: { appliedAt: "desc" },
      take: 40,
      select: {
        id: true,
        kind: true,
        before: true,
        after: true,
        status: true,
        lockedUntil: true,
        appliedAt: true,
      },
    })
    .catch(() => []);
}

/** Cửa sổ mốc so sánh dài hạn (ngày). */
const BASELINE_MIN_AGE_DAYS = 14;
const BASELINE_MAX_AGE_DAYS = 28;

/**
 * Ảnh chụp dùng làm mốc so sánh dài hạn: cũ ít nhất 14 ngày (để thay đổi kịp
 * thể hiện) và không quá 28 ngày (cũ hơn thì so sánh mất ý nghĩa).
 */
function baselineFrom(
  snapshots: { at: Date; medianScore: number; sampleSize: number }[],
  now: Date
): { medianScore: number; sampleSize: number } | null {
  const minAge = BASELINE_MIN_AGE_DAYS * 24 * 60 * 60 * 1000;
  const maxAge = BASELINE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  for (const s of snapshots) {
    const age = now.getTime() - s.at.getTime();
    if (age >= minAge && age <= maxAge) {
      return { medianScore: s.medianScore, sampleSize: s.sampleSize };
    }
  }
  return null;
}

/** Trọng số đã áp dụng ở lần điều chỉnh gần nhất — mốc giới hạn tốc độ đổi. */
function lastAppliedWeights(
  adjustments: { kind: string; after: string; status: string }[]
): Record<string, number> | null {
  const row = adjustments.find(
    (a) => a.kind === "PILLAR_WEIGHT" && a.status !== "ROLLED_BACK"
  );
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.after);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, number>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Trọng số trụ cột hiệu dụng sau KHI QUA ĐỦ RÀO CHẮN.
 *
 * Bốn lớp, theo thứ tự:
 *   1. Đang dò → trọng số BẰNG NHAU (dò để lấy dữ liệu, không để củng cố).
 *   2. Gợi ý theo số liệu (`suggestPillarWeights`, đã chặn ±30% và sàn 50%).
 *   3. Hệ số theo trạng thái hướng: hướng bão hoà/đang giảm bị hạ, hướng đang
 *      lên được nâng. Đây là chỗ `ContentDirection` cuối cùng tác động được vào
 *      việc lập kế hoạch — trước đây nó chỉ được ghi ra rồi không ai đọc.
 *   4. Giới hạn ±25% so với lần điều chỉnh trước, nên mỗi chu kỳ chỉ nghiêng
 *      một ít và sai thì sửa lại nhanh.
 *
 * Chiều đang khoá sau rollback thì trả về nguyên trọng số người dùng đặt.
 */
function computeEffectiveWeights(input: {
  pillars: { name: string; weight: number }[];
  phase: LearningPhase;
  pillarSuggestion: PillarWeightSuggestion;
  directions: DirectionDraft[];
  previous: Record<string, number> | null;
  locked: boolean;
}): Record<string, number> {
  const base: Record<string, number> = {};
  for (const p of input.pillars) base[p.name] = p.weight;

  if (input.phase === "PROBE" || input.phase === "REPROBE") {
    return Object.fromEntries(input.pillars.map((p) => [p.name, 1]));
  }
  if (input.locked) return base;

  const start = input.pillarSuggestion.applied
    ? { ...input.pillarSuggestion.weights }
    : base;

  const statusOf = new Map(
    input.directions.filter((d) => d.kind === "PILLAR").map((d) => [d.value, d.status])
  );

  const adjusted: Record<string, number> = {};
  for (const p of input.pillars) {
    const factor = DIRECTION_WEIGHT_FACTOR[statusOf.get(p.name) ?? "STABLE"] ?? 1;
    adjusted[p.name] = Math.max(1, Math.round((start[p.name] ?? p.weight) * factor));
  }

  return limitWeightStep(adjusted, input.previous);
}

/**
 * Tỉ lệ video hiệu dụng khi người dùng chọn trộn ảnh/video.
 *
 * Chỉ điều chỉnh khi CẢ HAI loại đều đủ mẫu — thiếu một bên thì so sánh vô
 * nghĩa. Kẹp trong ±20 điểm quanh con số người dùng đặt (và trong 10–60) để
 * tính năng không bao giờ biến "trộn" thành "chỉ video".
 */
function suggestVideoPercent(
  report: PerformanceReport,
  mediaMix: string,
  userPercent: number
): number | null {
  if (mediaMix !== "MIXED") return null;

  const image = report.byMediaKind.find((g) => g.key === "IMAGE");
  const video = report.byMediaKind.find((g) => g.key === "VIDEO");
  if (!image || !video) return null;
  if (
    image.posts < MIN_SAMPLES_PER_DIRECTION ||
    video.posts < MIN_SAMPLES_PER_DIRECTION
  ) {
    return null;
  }

  const factor = 1 + 0.3 * Math.tanh(video.z / 2);
  const proposed = Math.round(userPercent * factor);
  const lo = Math.max(10, userPercent - 20);
  const hi = Math.min(60, userPercent + 20);
  const clamped = Math.min(Math.max(proposed, lo), hi);
  return clamped === userPercent ? null : clamped;
}

/**
 * Trọng số địa bàn theo hiệu quả — dùng PHÁ HOÀ trên nền xoay vòng, không thay
 * thế vòng xoay. Mọi địa bàn vẫn được phủ, chỉ khác thứ tự ưu tiên khi bằng điểm.
 */
function serviceAreaWeightsOf(report: PerformanceReport): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of report.byServiceArea) {
    if (g.posts < MIN_SAMPLES_PER_DIRECTION) continue;
    out[g.key] = Math.round((1 + 0.3 * Math.tanh(g.z / 2)) * 100) / 100;
  }
  return out;
}

/** Số góc hiệu quả tối đa đưa vào prompt. */
const WINNING_TOPIC_LIMIT = 3;

/**
 * Góc/chủ đề ĐÃ HIỆU QUẢ, để prompt triển khai BIẾN THỂ MỚI.
 *
 * Khác `recentTopics` (danh sách để TRÁNH lặp): đây là tín hiệu nên đi tiếp
 * hướng nào. Không có nó thì mọi thứ đã thắng chỉ được dùng để loại trừ, và hệ
 * thống không bao giờ khai thác được điều nó vừa học.
 */
function winningTopicsOf(report: PerformanceReport): string[] {
  const out: string[] = [];
  for (const p of report.topPosts) {
    if (p.z < 0.5) continue;
    const topic = p.topic?.trim();
    if (!topic) continue;
    if (out.includes(topic)) continue;
    out.push(topic);
    if (out.length >= WINNING_TOPIC_LIMIT) break;
  }
  return out;
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
  /** Số hướng dò được chấm lại lượt này. */
  probesEvaluated: number;
  /** Số điều chỉnh được kết luận giữ / quay lại lượt này. */
  adjustmentsKept: number;
  adjustmentsRolledBack: number;
};

/**
 * Chạy bước kiểm tra và ghi kết quả xuống DB.
 *
 * GỒM SÁU VIỆC (bốn việc đầu là vòng cũ, hai việc sau khép kín vòng học):
 *   1. Tính trạng thái học (giai đoạn, dò, nhận xét).
 *   2. Kết luận kết quả từng hướng dò đã thử (GOOD/BAD/NEUTRAL).
 *   3. Ghi lại ContentDirection — dữ liệu cho phần "nhận xét".
 *   4. Ghi cache kết luận vào AutoPilot + thông báo khi ĐỔI GIAI ĐOẠN.
 *   5. Chụp ảnh số liệu mỗi ngày — mốc so sánh dài hạn + dữ liệu xu hướng.
 *   6. Kết luận các điều chỉnh đang kiểm chứng: giữ hoặc quay lại cấu hình cũ.
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
        videoPercent: autopilot.videoPercent,
        lastReProbeAt: autopilot.lastReProbeAt,
        probeStartedAt: autopilot.probeStartedAt,
        updatedAt: autopilot.updatedAt,
      },
      now,
      pillars
    );

    const previousPhase = autopilot.learningPhase;
    const phaseChanged = previousPhase !== state.phase;

    // ---- Kết luận từng hướng dò ----
    //
    // Chấm theo CHÍNH các bài đã gắn với hướng đó (`postIds`), không đoán lại
    // bằng cách nhóm theo giá trị: một bài dò đóng góp vào nhiều hướng, và kiểu
    // mở bài thật có thể lệch với kiểu đã yêu cầu.
    const batchEntries = await prisma.probeEntry.findMany({
      where: { pageId },
      orderBy: { createdAt: "desc" },
      take: 80,
      select: { id: true, kind: true, value: true, result: true, postIds: true },
    });

    let probesEvaluated = 0;
    if (batchEntries.length > 0) {
      const evaluated = evaluateProbeResults(batchEntries, state.report);
      for (const [i, item] of evaluated.entries()) {
        // evaluateProbeResults giữ nguyên thứ tự đầu vào, nên khớp theo chỉ số:
        // khớp theo (kind,value) sẽ luôn trúng dòng ĐẦU TIÊN và các đợt sau của
        // cùng một hướng không bao giờ được cập nhật.
        const row = batchEntries[i];
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
        probesEvaluated++;
      }
    }

    // ---- Ghi hướng nội dung đang triển khai ----
    //
    // Ghi theo LÔ trong một transaction thay vì upsert tuần tự: hàm này chạy
    // trong luồng lập kế hoạch, mỗi hướng một round-trip thì vài chục hướng ăn
    // hết ngân sách thời gian của lượt.
    //
    // Đồng thời DỌN hướng không còn trong kết quả tính: bảng này là bản chiếu
    // của số liệu hiện tại, giữ lại dòng cũ sẽ khiến giao diện kể chuyện cũ.
    const workspaceId = await workspaceIdOf(pageId);
    let directionsUpdated = 0;

    try {
      const keep = state.directions.map((d) => ({ kind: d.kind, value: d.value }));
      await prisma.$transaction([
        ...state.directions.map((d) =>
          prisma.contentDirection.upsert({
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
        ),
        prisma.contentDirection.deleteMany({
          where: { pageId, NOT: { OR: keep } },
        }),
      ]);
      directionsUpdated = state.directions.length;
    } catch (err) {
      console.error(
        `[insights] không ghi được hướng nội dung của Page ${pageId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
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
          explorationRate: state.explorationRate,
          ...(state.phase === "PROBE" && autopilot.probeStartedAt === null
            ? { probeStartedAt: now }
            : {}),
          // CHỈ đặt mốc khi VÀO REPROBE, không đặt lại mỗi lượt đang ở REPROBE:
          // ghi lại mỗi lượt sẽ đẩy mốc đợt dò lên liên tục, khiến ngân sách dò
          // luôn đếm được 0 bài và đợt dò lại không bao giờ kết thúc.
          ...(state.phase === "REPROBE" && previousPhase !== "REPROBE"
            ? { lastReProbeAt: now }
            : {}),
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

    // ---- Ảnh chụp số liệu theo ngày (mốc so sánh dài hạn) ----
    await snapshotToday(pageId, state, now);

    // ---- Kết luận các điều chỉnh đang kiểm chứng ----
    const verdicts = await settleAdjustments(pageId, page.userId, page.name, now);

    // ---- Ghi điều chỉnh mới nếu cấu hình hiệu dụng vừa đổi ----
    await recordAdjustments(pageId, state, now);

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
      probesEvaluated,
      adjustmentsKept: verdicts.kept,
      adjustmentsRolledBack: verdicts.rolledBack,
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

// ============================================================
// Ảnh chụp theo ngày + kiểm chứng điều chỉnh
// ============================================================

/**
 * Ghi một ảnh chụp số liệu cho NGÀY HÔM NAY (mỗi Page một dòng/ngày).
 *
 * Vì sao cần: báo cáo hiệu quả được tính lại từ dữ liệu thô mỗi lượt nên không
 * có "lần phân tích trước" để so. Không có mốc lịch sử thì kiểu tụt chậm (mỗi
 * tuần giảm một ít) không bao giờ bị phát hiện, và tỉ lệ thử nghiệm không biết
 * mình đang đi lên hay đi xuống.
 *
 * Dùng upsert theo (pageId, dayKey): verifier chạy nhiều lần trong ngày chỉ cập
 * nhật dòng của ngày đó, không làm phình bảng.
 */
async function snapshotToday(
  pageId: string,
  state: LearningState,
  now: Date
): Promise<void> {
  const dayKey = formatDateKey(now);
  const summary = JSON.stringify({
    byPillar: state.report.byPillar.map((g) => ({ k: g.key, n: g.posts, s: g.avgScore })),
    byHook: state.report.byHookStyle.map((g) => ({ k: g.key, n: g.posts, s: g.avgScore })),
    byBand: state.report.byBand.map((g) => ({ k: g.key, n: g.posts, s: g.avgScore })),
    byMedia: state.report.byMediaKind.map((g) => ({ k: g.key, n: g.posts, s: g.avgScore })),
  });

  const data = {
    at: now,
    medianScore: state.report.medianScore,
    sampleSize: state.report.sampleSize,
    phase: state.phase,
    explorationRate: state.explorationRate,
    summary,
  };

  await prisma.learningSnapshot
    .upsert({
      where: { pageId_dayKey: { pageId, dayKey } },
      update: data,
      create: { pageId, dayKey, ...data },
    })
    .catch((err) => {
      console.error(
        `[insights] không ghi được ảnh chụp số liệu Page ${pageId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    });
}

/**
 * Kết luận các điều chỉnh đang kiểm chứng: giữ hay quay lại.
 *
 * So trung vị các bài ĐÃ CHÍN đăng SAU `appliedAt` với mốc lúc điều chỉnh. Tụt
 * quá ngưỡng thì ROLLED_BACK kèm thời gian khoá, và `computeLearningState` sẽ
 * không áp điều chỉnh cho chiều đó trong thời gian khoá.
 *
 * Đây là rào chắn quan trọng nhất của việc "tự áp dụng": hệ thống được phép tự
 * đổi, nhưng mọi thay đổi đều phải tự chứng minh bằng số liệu, nếu không thì tự
 * quay về.
 */
async function settleAdjustments(
  pageId: string,
  userId: string,
  pageName: string,
  now: Date
): Promise<{ kept: number; rolledBack: number }> {
  const out = { kept: 0, rolledBack: 0 };

  const pending = await prisma.learningAdjustment
    .findMany({
      where: { pageId, status: "ACTIVE" },
      orderBy: { appliedAt: "asc" },
      take: 20,
    })
    .catch(() => []);
  if (pending.length === 0) return out;

  for (const adj of pending) {
    // Chỉ tính bài sinh ra SAU điều chỉnh và đã chín — bài trước đó không chịu
    // ảnh hưởng của thay đổi này nên đưa vào sẽ làm loãng kết luận.
    const posts = await prisma.post
      .findMany({
        where: {
          pageId,
          origin: "AUTOPILOT",
          status: "PUBLISHED",
          publishedAt: { gt: adj.appliedAt },
        },
        select: {
          publishedAt: true,
          insight: {
            select: { reactions: true, comments: true, shares: true, status: true },
          },
        },
      })
      .catch(() => []);

    const afterScores = posts
      .filter(
        (p) =>
          p.insight !== null &&
          p.insight.status !== "FRESH" &&
          isMatureForLearning(p.publishedAt, now)
      )
      .map((p) => p.insight!.reactions + 3 * p.insight!.comments + 5 * p.insight!.shares);

    const verdict = evaluateAdjustment({
      appliedAt: adj.appliedAt,
      baselineMedian: adj.baselineMedian,
      afterScores,
      now,
    });

    if (verdict.status === "ACTIVE") continue;

    const rolledBack = verdict.status === "ROLLED_BACK";
    await prisma.learningAdjustment
      .update({
        where: { id: adj.id },
        data: {
          status: verdict.status,
          resultMedian: verdict.resultMedian,
          resultSamples: verdict.resultSamples,
          reason: verdict.reason,
          ...(rolledBack
            ? {
                lockedUntil: new Date(
                  now.getTime() + ADJUSTMENT_LOCK_DAYS * 24 * 60 * 60 * 1000
                ),
              }
            : {}),
        },
      })
      .catch(() => {});

    if (rolledBack) {
      out.rolledBack++;
      // Người dùng phải biết hệ thống đã tự quay lại — nếu im lặng thì họ thấy
      // cấu hình hiệu dụng đổi qua đổi lại mà không hiểu vì sao.
      const { notify } = await import("./notify");
      await notify(userId, {
        type: "SYSTEM",
        title: "↩️ Đã quay lại cấu hình cũ vì điều chỉnh không hiệu quả",
        body:
          `Page "${pageName}": ${ADJUSTMENT_KIND_LABELS[adj.kind] ?? adj.kind} — ${verdict.reason} ` +
          `Hệ thống tạm khoá chiều này ${ADJUSTMENT_LOCK_DAYS} ngày rồi mới thử lại.`,
        link: "/insights",
      }).catch(() => {});
    } else {
      out.kept++;
    }
  }

  return out;
}

/** Nhãn tiếng Việt của từng chiều điều chỉnh — dùng cho thông báo và giao diện. */
export const ADJUSTMENT_KIND_LABELS: Record<string, string> = {
  PILLAR_WEIGHT: "tỉ trọng trụ cột",
  TIME_BIAS: "khung giờ ưu tiên",
  HOOK: "kiểu mở bài",
  MEDIA_MIX: "tỉ lệ ảnh/video",
};

/**
 * Ghi một dòng điều chỉnh khi cấu hình HIỆU DỤNG vừa đổi đáng kể.
 *
 * Chỉ ghi khi khác hẳn lần trước, và mỗi chiều chỉ có MỘT dòng ACTIVE: phải
 * kiểm chứng xong thay đổi này mới được đổi tiếp. Thiếu rào đó thì hệ thống đổi
 * mỗi lượt và không bao giờ biết thay đổi nào có tác dụng.
 */
async function recordAdjustments(
  pageId: string,
  state: LearningState,
  now: Date
): Promise<void> {
  // Dưới ngưỡng tin cậy thì chưa có gì để kiểm chứng.
  if (state.report.sampleSize < MIN_SAMPLES_FOR_EXPLOIT) return;

  const evaluateAfter = new Date(
    now.getTime() + ADJUSTMENT_EVAL_DAYS * 24 * 60 * 60 * 1000
  );

  const candidates: { kind: string; after: unknown }[] = [
    { kind: "PILLAR_WEIGHT", after: state.effectiveWeights },
    { kind: "TIME_BIAS", after: state.timeBias ? state.timeBias.band : null },
    { kind: "HOOK", after: state.hookSuggestion.style },
    { kind: "MEDIA_MIX", after: state.videoPercentOverride },
  ];

  for (const c of candidates) {
    if (c.after === null) continue;
    if (state.lockedKinds.includes(c.kind)) continue;

    const latest = await prisma.learningAdjustment
      .findFirst({
        where: { pageId, kind: c.kind },
        orderBy: { appliedAt: "desc" },
      })
      .catch(() => null);

    // Còn một điều chỉnh đang kiểm chứng → chưa đổi tiếp.
    if (latest?.status === "ACTIVE") continue;

    const afterJson = JSON.stringify(c.after);
    const beforeJson = latest?.after ?? JSON.stringify(null);
    if (beforeJson === afterJson) continue;

    await prisma.learningAdjustment
      .create({
        data: {
          pageId,
          kind: c.kind,
          before: beforeJson,
          after: afterJson,
          baselineMedian: state.report.medianScore,
          baselineSamples: state.report.sampleSize,
          appliedAt: now,
          evaluateAfter,
          status: "ACTIVE",
          reason: `Áp dụng theo số liệu (${state.report.sampleSize} bài, độ tin cậy ${state.report.confidence}).`,
        },
      })
      .catch(() => {
        /* chạy chồng — lượt sau ghi lại */
      });
  }
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

  // Dùng trọng số ĐÃ QUA RÀO CHẮN (computeEffectiveWeights): gợi ý theo số liệu,
  // nhân hệ số theo trạng thái hướng (bão hoà/đang giảm/đang lên), giới hạn
  // ±25% mỗi chu kỳ, và bỏ qua hoàn toàn khi chiều này đang khoá sau rollback.
  return pillars.map((p) => ({
    ...p,
    weight: Math.max(1, Math.round(state.effectiveWeights[p.name] ?? p.weight)),
  }));
}

/**
 * Ghi chú ngắn lưu vào `Post.optimizationNote` — để sau này người dùng xem lại
 * biết vì sao bài đó được viết/đăng như vậy.
 */
export function optimizationNoteOf(
  state: LearningState,
  parts: {
    pillarName?: string | null;
    band?: string | null;
    hookStyle?: string | null;
    /** true = slot thử hướng mới giữa giai đoạn khai thác. */
    exploring?: boolean;
  }
): string {
  const bits: string[] = [];

  if (state.phase === "PROBE") bits.push("Dò tìm hướng");
  else if (state.phase === "REPROBE") bits.push("Dò lại do số liệu giảm");
  else if (parts.exploring) {
    bits.push(`Thử hướng mới (${Math.round(state.explorationRate * 100)}% lịch)`);
  } else bits.push("Khai thác hướng đang hiệu quả");

  if (parts.pillarName) bits.push(`trụ cột "${parts.pillarName}"`);
  if (parts.hookStyle) bits.push(`kiểu mở bài ${parts.hookStyle}`);
  if (parts.band) bits.push(`khung ${parts.band}`);
  if (state.timeBias && state.phase === "EXPLOIT" && !parts.exploring) {
    bits.push(`ưu tiên khung giờ tốt`);
  }
  if (state.lockedKinds.length > 0) {
    bits.push(`tạm khoá: ${state.lockedKinds.join(", ")}`);
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

/**
 * Dòng chỉ thị KHAI THÁC kiểu mở bài đang thắng — đưa vào prompt của slot khai
 * thác.
 *
 * Vì sao cần: trước đây kiểu mở bài thắng chỉ được tính ra rồi hiển thị ở giao
 * diện, không hề vào prompt — hệ thống "biết" mà không "dùng". Dòng số liệu
 * chung (`performanceLines`) chỉ nói kiểu nào tốt, không phải một chỉ thị viết.
 *
 * KHÔNG áp cho slot thử nghiệm: nếu mọi bài đều dùng một kiểu mở bài thì các
 * kiểu khác không còn mẫu mới, và hệ thống mất khả năng phát hiện khi kiểu đang
 * thắng hết hiệu quả.
 */
export function exploitHookLines(state: LearningState): string[] {
  const style = state.hookSuggestion.style;
  if (!style) return [];

  return [
    "=== CÁCH MỞ BÀI ĐANG HIỆU QUẢ NHẤT VỚI PAGE NÀY ===",
    HOOK_STYLE_INSTRUCTIONS[style],
    `- Số liệu thật của Page cho thấy kiểu "${HOOK_STYLE_LABELS[style]}" đang được đáp lại tốt hơn (${state.hookSuggestion.reason}).`,
    "- Đây là chỉ thị về CÁCH TRÌNH BÀY, không phải chủ đề mới ngoài hồ sơ thương hiệu.",
  ];
}

/**
 * Dòng "góc đã hiệu quả" cho khối số liệu trong prompt.
 *
 * Khác `recentTopics` (danh sách để TRÁNH lặp): đây là tín hiệu nên đi TIẾP
 * hướng nào. Không có nó thì mọi thứ đã thắng chỉ được dùng để loại trừ, và hệ
 * thống không bao giờ khai thác điều nó vừa học.
 */
export function winningTopicLines(state: LearningState): string[] {
  if (state.winningTopics.length === 0) return [];

  return [
    "- GÓC ĐÃ HIỆU QUẢ (nên triển khai BIẾN THỂ MỚI, không viết lại bài cũ):",
    ...state.winningTopics.map((t) => `  · ${t}`),
    "- Giữ KIỂU góc này nhưng đổi sản phẩm, đổi tình huống hoặc đổi khu vực được nhấn.",
    "- Mọi thông tin cụ thể vẫn chỉ lấy từ hồ sơ thương hiệu ở trên.",
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
  /** Tỉ lệ bài dành cho thử hướng mới (0–1) — tự điều chỉnh theo số liệu. */
  explorationRate: number;
  /** Những chiều đang tạm khoá vì vừa rollback. */
  lockedKinds: string[];
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
    explorationRate: state.explorationRate,
    lockedKinds: state.lockedKinds,
  };
}

export { PERFORMANCE_SAFETY_CLAUSE, type HookStyle };
