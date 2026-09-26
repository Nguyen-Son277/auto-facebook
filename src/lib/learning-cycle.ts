// ============================================================
// VÒNG ĐỜI HỌC CỦA AUTOPILOT — logic THUẦN.
//
// Đây là trái tim của tính năng "tự tối ưu theo thời gian". Ba việc:
//
//   1. QUYẾT ĐỊNH GIAI ĐOẠN — Page đang dò tìm hướng, đang khai thác hướng
//      đã biết, hay đang phải kiểm tra lại vì số liệu tụt.
//   2. PHÁT HIỆN TỤT — nhận ra khi nội dung bắt đầu lỗi thời, kèm cơ chế
//      chống báo động giả (không phải cứ dao động là nhảy sang dò lại).
//   3. NHẬN XÉT — nói cho người dùng biết nội dung đang đi theo hướng nào,
//      số liệu ra sao, và nên giữ/đổi gì.
//
// VÌ SAO PHẢI CÓ BƯỚC DÒ
// Khi Page vừa bật tự động đăng, chưa có bài nào để học. Nếu cứ xoay vòng theo
// trọng số người dùng đặt (thường là một trụ cột chiếm 40–50%), hệ thống sẽ
// dành phần lớn những bài đầu tiên — giai đoạn quan trọng nhất — cho một
// hướng chưa được kiểm chứng, và phải chờ rất lâu mới có đủ dữ liệu để biết
// mình sai. Dò có kiểm soát rút ngắn vòng đó: 12 bài đầu trải đều có chủ đích.
//
// RÀNG BUỘC AN TOÀN (xem thêm insights-report.ts)
//   * Mọi hướng dò đều NẰM TRONG hồ sơ thương hiệu: trụ cột lấy từ danh sách
//     đang bật, kiểu hook lấy từ bộ 4 kiểu đóng, band giờ lấy từ khung người
//     dùng đặt. Không có chủ đề/sản phẩm/địa danh mới nào được sinh ra.
//   * Dò chỉ đổi THỨ TỰ ƯU TIÊN, không nhân trọng số. Nếu vừa dò vừa nhân
//     trọng số thì tạo vòng lặp tự củng cố: hướng được chọn nhiều vì trọng số
//     cao, rồi trọng số lại cao vì được chọn nhiều.
//   * Dò có NGÂN SÁCH. Hết ngân sách mà chưa đủ dữ liệu thì thoát dò và làm
//     việc với những gì đang có — không dò vô hạn trên Page ít người xem.
//
// Hàm thuần, tất định (nhận `now` từ ngoài) — kiểm thử ở scripts/test-insights.mjs.
// ============================================================

import {
  HOOK_STYLES,
  HOOK_STYLE_INSTRUCTIONS,
  HOOK_STYLE_LABELS,
  MIN_SAMPLES_FOR_EXPLOIT,
  MIN_SAMPLES_PER_DIRECTION,
  PROBE_MAX_POSTS,
  REPROBE_COOLDOWN_DAYS,
  TIME_BANDS,
  TIME_BAND_LABELS,
  type HookStyle,
  type TimeBand,
} from "./insights-core.ts";
import type { PerformanceReport, GroupStat } from "./insights-report.ts";

// Re-export vài hằng số của insights-core mà vòng đời học dùng trực tiếp, để
// tầng gọi (và test) chỉ cần import một chỗ cho khái niệm "học".
export {
  MIN_SAMPLES_FOR_EXPLOIT,
  PROBE_MAX_POSTS,
  REPROBE_COOLDOWN_DAYS,
  TIME_BANDS,
  HOOK_STYLES,
} from "./insights-core.ts";

// ============================================================
// Kiểu dữ liệu
// ============================================================

export type LearningPhase = "PROBE" | "EXPLOIT" | "REPROBE";

export const LEARNING_PHASE_LABELS: Record<LearningPhase, string> = {
  PROBE: "🔬 Đang dò tìm hướng",
  EXPLOIT: "🚀 Đang khai thác",
  REPROBE: "🔁 Kiểm tra lại",
};

export type RegressionSeverity = "NONE" | "MINOR" | "MAJOR";

export type RegressionSignal = {
  /** Mã ổn định để test kiểm tra, không phụ thuộc câu chữ tiếng Việt. */
  code:
    | "TREND_DROP"
    | "TREND_DROP_SEVERE"
    | "DIRECTION_REVERSAL"
    | "RECENT_COLLAPSE"
    | "BASELINE_DROP"
    | "SINGLE_DIRECTION_STALL";
  message: string;
  severity: RegressionSeverity;
};

export type RegressionReport = {
  triggered: boolean;
  severity: RegressionSeverity;
  signals: RegressionSignal[];
  /** Lý do gọn để hiển thị/thông báo. */
  reason: string;
};

/**
 * Tín hiệu đầu vào cho việc phát hiện tụt, do tầng gọi chuẩn bị.
 *
 * Tách ra thay vì nhét hết vào `PerformanceReport` để hàm này kiểm thử được
 * với từng tín hiệu riêng lẻ — đó là cách duy nhất kiểm chứng được cơ chế
 * chống báo động giả.
 */
export type RegressionInput = {
  report: PerformanceReport;
  /** Hai báo cáo cũ để so — null khi chưa đủ lịch sử. */
  previous: PerformanceReport | null;
  /** Thời điểm lần kiểm tra lại gần nhất (null = chưa từng). */
  lastReProbeAt: Date | null;
  /** Cấu hình Page có bị đổi gần đây không (7 ngày) — đổi cấu hình thì chưa kết luận được. */
  configChangedRecently: boolean;
  now: Date;
};

// ============================================================
// 1. Phát hiện tụt
// ============================================================

/** Hiệu quả 7 ngày giảm từ mức này trở xuống là tín hiệu nhẹ. */
export const TREND_DROP_PCT = -25;
/** ... và từ mức này trở xuống là tín hiệu nặng. */
export const TREND_DROP_SEVERE_PCT = -40;
/**
 * Số bài tối thiểu mỗi kỳ để so xu hướng.
 *
 * Điều kiện này được `analyzePerformance` (insights-report.ts) thi hành khi
 * dựng `trend7d`: dưới 2 bài mỗi kỳ thì `trend7d` là null. Hằng số ở đây dùng
 * để ghi rõ ngưỡng và để test đối chiếu hai tầng với nhau.
 */
export const TREND_MIN_POSTS = 2;
/** Số bài bài gần nhất dùng cho tín hiệu "tụt cả loạt". */
const COLLAPSE_RECENT = 5;
/** Số bài trước đó dùng làm mốc so cho tín hiệu "tụt cả loạt". */
const COLLAPSE_BASELINE = 20;
/** Trung vị bài mới thấp hơn ngần này lần mốc cũ thì coi là tụt cả loạt. */
export const COLLAPSE_RATIO = 0.55;
/** Số hướng độc lập cùng giảm để coi là đảo chiều toàn cục. */
const REVERSAL_MIN_DIRECTIONS = 2;
/** Một hướng chiếm hơn tỉ lệ này mà kém hiệu quả → đang bão hoà một hướng. */
export const STALL_SHARE_THRESHOLD = 0.7;
/** Trung vị hiệu quả giảm từ mức này so với lần phân tích trước là tín hiệu nhẹ. */
export const BASELINE_DROP_PCT = -20;

function pct(n: number): string {
  return `${n > 0 ? "+" : ""}${Math.round(n)}%`;
}

/**
 * Phát hiện "nội dung bắt đầu lỗi thời".
 *
 * NĂM TÍN HIỆU ĐỘC LẬP (mỗi tín hiệu bắt một kiểu tụt khác nhau):
 *   1. TREND_DROP / TREND_DROP_SEVERE — hiệu quả 7 ngày giảm so với 7 ngày trước.
 *   2. DIRECTION_REVERSAL — từ 2 hướng độc lập trở lên cùng giảm.
 *   3. RECENT_COLLAPSE — vài bài mới nhất tụt hẳn so với nền cũ (bắt được cú
 *      sụp xảy ra nhanh, trước cả khi nó thể hiện trong trend 7 ngày).
 *   4. SINGLE_DIRECTION_STALL — một hướng chiếm gần hết bài mà kém hiệu quả:
 *      dấu hiệu bão hoà, không phải tụt nhất thời.
 *
 * CHỐNG BÁO ĐỘNG GIẢ (quan trọng không kém việc phát hiện):
 *   - MAJOR cần 2 tín hiệu, HOẶC 1 tín hiệu nặng khi đã đủ tin cậy. Một bài
 *     kém may mắn không được phép đảo cả kế hoạch.
 *   - Cooldown 14 ngày: vừa dò lại xong thì chưa dò tiếp, nếu không Page sẽ
 *     không bao giờ tích đủ dữ liệu để kết luận.
 *   - Bỏ qua khi Page vừa đổi cấu hình: tụt do đổi thời điểm đăng thì không
 *     phải do nội dung lỗi thời.
 *   - Dưới ngưỡng tin cậy thì không kết luận gì.
 */
export function detectRegression(input: RegressionInput): RegressionReport {
  const { report, previous, lastReProbeAt, configChangedRecently, now } = input;
  const none: RegressionReport = {
    triggered: false,
    severity: "NONE",
    signals: [],
    reason: "",
  };

  if (report.confidence === "NONE") {
    return { ...none, reason: "Chưa có đủ bài để đánh giá xu hướng." };
  }

  const cooling =
    lastReProbeAt !== null &&
    now.getTime() - lastReProbeAt.getTime() < REPROBE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

  const signals: RegressionSignal[] = [];

  // --- Tín hiệu 1: xu hướng 7 ngày ---
  const trend = report.trend7d;
  if (trend && trend.changePct <= TREND_DROP_PCT) {
    const severe = trend.changePct <= TREND_DROP_SEVERE_PCT;
    signals.push({
      code: severe ? "TREND_DROP_SEVERE" : "TREND_DROP",
      message: `Hiệu quả 7 ngày gần đây ${pct(trend.changePct)} so với 7 ngày trước.`,
      severity: severe ? "MAJOR" : "MINOR",
    });
  }

  // --- Tín hiệu 2: nhiều hướng cùng giảm ---
  const declining = allGroupStats(report).filter(
    (g) => g.posts >= MIN_SAMPLES_PER_DIRECTION && g.changePct !== null && g.changePct <= TREND_DROP_PCT
  );
  const decliningKeys = new Set(declining.map((g) => `${g.key}`));
  if (declining.length >= REVERSAL_MIN_DIRECTIONS) {
    signals.push({
      code: "DIRECTION_REVERSAL",
      message: `${declining.length} hướng nội dung cùng giảm (${[...decliningKeys].slice(0, 3).join(", ")}).`,
      severity: "MAJOR",
    });
  }

  // --- Tín hiệu 3: tụt cả loạt gần đây ---
  const sorted = [...report.topPosts, ...report.weakPosts];
  if (report.sampleSize >= COLLAPSE_RECENT + 5 && sorted.length > 0) {
    const recent = report.weakPosts.slice(0, COLLAPSE_RECENT).map((p) => p.score);
    const baselineCount = Math.min(COLLAPSE_BASELINE, report.sampleSize - COLLAPSE_RECENT);
    if (baselineCount >= 5 && report.medianScore > 0) {
      const recentMedian = medianOrZero(recent);
      if (recentMedian < report.medianScore * COLLAPSE_RATIO) {
        signals.push({
          code: "RECENT_COLLAPSE",
          message: `${recent.length} bài mới nhất có tương tác trung vị chỉ còn ${Math.round(
            (recentMedian / report.medianScore) * 100
          )}% mức trung vị của Page.`,
          severity: "MAJOR",
        });
      }
    }
  }

  // --- Tín hiệu 4: bão hoà một hướng ---
  const stalling = report.byPillar.find(
    (g) =>
      g.posts >= MIN_SAMPLES_PER_DIRECTION &&
      g.share >= STALL_SHARE_THRESHOLD &&
      g.z <= -0.2
  );
  if (stalling) {
    signals.push({
      code: "SINGLE_DIRECTION_STALL",
      message: `Hơn ${Math.round(stalling.share * 100)}% số bài đang dồn vào "${
        stalling.key
      }" nhưng hướng này có hiệu quả dưới trung vị — đã bão hoà.`,
      severity: "MINOR",
    });
  }

  // --- Tín hiệu 5: trung vị giảm so với LẦN PHÂN TÍCH TRƯỚC ---
  // Khác tín hiệu 1 (so hai cửa sổ 7 ngày BÊN TRONG cùng một lần phân tích),
  // tín hiệu này so giữa hai lần phân tích cách nhau nhiều ngày. Nó bắt được
  // kiểu tụt chậm: mỗi tuần giảm một ít, không lần nào đủ 25% nên tín hiệu 1
  // không thấy, nhưng cộng dồn lại là nội dung đã lỗi thời.
  if (previous && previous.sampleSize >= MIN_SAMPLES_PER_DIRECTION && previous.medianScore > 0) {
    const change = ((report.medianScore - previous.medianScore) / previous.medianScore) * 100;
    if (change <= BASELINE_DROP_PCT) {
      signals.push({
        code: "BASELINE_DROP",
        message: `Tương tác trung vị ${pct(change)} so với lần phân tích trước (${previous.sampleSize} bài).`,
        severity: "MINOR",
      });
    }
  }

  if (signals.length === 0) {
    return { ...none, reason: "Số liệu đang ổn định." };
  }

  const majorCount = signals.filter((s) => s.severity === "MAJOR").length;
  const severity: RegressionSeverity =
    majorCount >= 2 || (majorCount >= 1 && report.confidence !== "LOW")
      ? "MAJOR"
      : "MINOR";

  // Tín hiệu MINOR đơn lẻ: ghi nhận nhưng chưa đủ để đảo kế hoạch.
  if (severity !== "MAJOR") {
    return {
      triggered: false,
      severity,
      signals,
      reason: `Có dao động nhưng chưa đủ mạnh để kiểm tra lại: ${signals[0].message}`,
    };
  }

  if (cooling) {
    return {
      triggered: false,
      severity,
      signals,
      reason: `Phát hiện tụt nhưng mới kiểm tra lại trong ${REPROBE_COOLDOWN_DAYS} ngày qua — chờ thêm dữ liệu.`,
    };
  }

  if (configChangedRecently) {
    return {
      triggered: false,
      severity,
      signals,
      reason:
        "Phát hiện tụt nhưng bạn vừa đổi cấu hình đăng bài — chờ thêm để biết nguyên nhân.",
    };
  }

  return {
    triggered: true,
    severity,
    signals,
    reason: signals.map((s) => s.message).join(" "),
  };
}

/** Gộp mọi nhóm hướng lại để tìm "nhiều hướng cùng giảm". */
function allGroupStats(report: PerformanceReport): GroupStat[] {
  return [
    ...report.byPillar,
    ...report.byHookStyle,
    ...report.byBand,
    ...report.byMediaKind,
  ];
}

function medianOrZero(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ============================================================
// 2. Quyết định giai đoạn
// ============================================================

export type PhaseInput = {
  /** Số bài AutoPilot đã ĐĂNG (đếm thật từ Post, không dùng bộ đếm cache). */
  totalPublishedAutoPilot: number;
  report: PerformanceReport;
  regression: RegressionReport;
  /**
   * Đã dùng hết ngân sách dò chưa (số bài dò ≥ PROBE_MAX_POSTS).
   *
   * VÌ SAO CẦN: dò là phương tiện để LẤY dữ liệu, không phải mục đích. Nếu Page
   * ít người xem tới mức 12 bài dò vẫn chưa đủ 8 bài "chín" (bài chưa đủ 24h
   * không được tính), cứ ở mãi trạng thái dò nghĩa là hệ thống không bao giờ
   * dùng tới phần tối ưu — đúng kiểu "chạy mãi không tới đích". Hết ngân sách
   * thì thoát dò và làm việc với những gì đang có.
   */
  probeBudgetExhausted?: boolean;
};

/**
 * Giai đoạn học hiện tại.
 *
 * THỨ TỰ XÉT QUAN TRỌNG:
 *   1. Tụt được xét TRƯỚC số mẫu — Page đã đăng 40 bài mà số liệu sụp thì phải
 *      dò lại ngay, không thể vin vào "đã đủ mẫu" để tiếp tục khai thác hướng
 *      đang chết.
 *   2. Hết ngân sách dò được xét TRƯỚC ngưỡng số mẫu — nếu không, Page ít
 *      người xem sẽ dò mãi không dứt.
 */
export function resolveLearningPhase(input: PhaseInput): LearningPhase {
  if (input.regression.triggered) return "REPROBE";
  if (input.probeBudgetExhausted) return "EXPLOIT";
  if (input.totalPublishedAutoPilot < MIN_SAMPLES_FOR_EXPLOIT) return "PROBE";
  return "EXPLOIT";
}

// ============================================================
// 3. Kế hoạch dò
// ============================================================

export type ProbeKind = "PILLAR" | "HOOK" | "TIME_BAND" | "MEDIA" | "SERVICE_AREA";

export type ProbeQuota = {
  kind: ProbeKind;
  value: string;
  quota: number;
};

export type ProbePlan = {
  batchId: string;
  quotas: ProbeQuota[];
  totalQuota: number;
  /**
   * true = đã chạm ngân sách dò mà vẫn chưa đủ mẫu. Tầng gọi phải thoát dò và
   * chuyển sang khai thác với dữ liệu hiện có thay vì tiếp tục dò.
   */
  exhausted: boolean;
  reason: string;
};

export type ProbePlanInput = {
  phase: LearningPhase;
  /** Trụ cột đang bật của Brand. */
  pillars: { name: string }[];
  /** Các hướng đã thử và kết quả — hướng BAD bị loại khỏi đợt sau. */
  previousEntries: { kind: string; value: string; result: string }[];
  config: {
    mediaMix: string;
    windowStart: string;
    windowEnd: string;
    minGapMinutes: number;
  };
  /** Số bài dò ĐÃ tạo trong đợt hiện tại (đếm từ Post). */
  probePostsSoFar: number;
  /** Số bài còn lại của lượt lập kế hoạch này. */
  remainingBudget: number;
  /** Có cấu hình địa bàn không — có mới dò địa bàn. */
  hasServiceAreas: boolean;
  /** Hệ số ngẫu nhiên để batchId khác nhau giữa các đợt. */
  seed?: string;
};

/** Số bài tối đa cho MỘT hướng, tính từ tổng ngân sách và số trụ cột. */
export function maxProbePostsPerHint(totalQuota: number, pillarCount: number): number {
  const per = Math.ceil(totalQuota / Math.max(pillarCount, 1));
  return Math.max(2, per + 1);
}

/**
 * Dựng kế hoạch dò cho một đợt.
 *
 * CÁCH PHÂN BỔ: chia đều ngân sách cho các trụ cột, rồi THÊM quota cho 4 kiểu
 * hook và 4 band giờ nằm trong khung người dùng đặt. Cùng một bài vừa đóng góp
 * vào quota trụ cột, vừa vào quota hook và band — nhờ vậy 12 bài đã trải được
 * qua nhiều chiều mà không phải đăng 12×N bài.
 *
 * HƯỚNG ĐÃ THẤT BẠI (result = BAD) bị loại khỏi đợt sau: thử lại thứ đã biết
 * là không hiệu quả chỉ làm chậm việc tìm ra hướng đúng.
 */
export function planProbeBatch(input: ProbePlanInput): ProbePlan {
  const { phase, pillars, config } = input;

  if (phase === "EXPLOIT") {
    return {
      batchId: "",
      quotas: [],
      totalQuota: 0,
      exhausted: false,
      reason: "Đang ở giai đoạn khai thác — không dò.",
    };
  }

  const totalQuota = Math.min(
    Math.max(input.remainingBudget, 0),
    Math.max(PROBE_MAX_POSTS - input.probePostsSoFar, 0)
  );

  if (totalQuota <= 0) {
    return {
      batchId: "",
      quotas: [],
      totalQuota: 0,
      exhausted: true,
      reason: `Đã dùng hết ngân sách dò ${PROBE_MAX_POSTS} bài — chuyển sang khai thác với số liệu hiện có.`,
    };
  }

  const bad = new Set(
    input.previousEntries
      .filter((e) => e.result === "BAD")
      .map((e) => `${e.kind}:${e.value}`)
  );

  const quotas: ProbeQuota[] = [];

  // ---- Trụ cột: chia đều, bỏ hướng đã thất bại ----
  const usablePillars = pillars.filter((p) => !bad.has(`PILLAR:${p.name}`));
  const pillarPool = usablePillars.length > 0 ? usablePillars : pillars;
  if (pillarPool.length === 0) {
    return {
      batchId: "",
      quotas: [],
      totalQuota: 0,
      exhausted: false,
      reason: "Không có trụ cột nào để dò.",
    };
  }

  const perPillar = Math.floor(totalQuota / pillarPool.length);
  let leftover = totalQuota - perPillar * pillarPool.length;
  const perHint = maxProbePostsPerHint(totalQuota, pillarPool.length);

  for (const p of pillarPool) {
    // Chia phần dư cho những trụ cột đầu danh sách — chênh lệch tối đa 1 bài
    const extra = leftover > 0 ? 1 : 0;
    if (extra) leftover -= 1;
    quotas.push({
      kind: "PILLAR",
      value: p.name,
      quota: Math.min(perPillar + extra, perHint),
    });
  }

  // ---- Hook: 4 kiểu đóng, bỏ kiểu đã thất bại ----
  const usableHooks = HOOK_STYLES.filter((h) => !bad.has(`HOOK:${h}`));
  const hooks = usableHooks.length > 0 ? usableHooks : [...HOOK_STYLES];
  for (const hook of hooks) {
    quotas.push({ kind: "HOOK", value: hook, quota: perHint });
  }

  // ---- Band giờ: chỉ những band GIAO với khung người dùng đặt ----
  const bands = usableBands(config);
  for (const band of bands) {
    quotas.push({ kind: "TIME_BAND", value: band, quota: perHint });
  }

  // ---- Media: chỉ dò khi người dùng đã chọn trộn ảnh/video ----
  if (config.mediaMix === "MIXED") {
    quotas.push({ kind: "MEDIA", value: "IMAGE", quota: perHint });
    quotas.push({ kind: "MEDIA", value: "VIDEO", quota: perHint });
  }

  const batchId = `${phase}-${input.seed ?? "b"}-${input.probePostsSoFar}`;

  return {
    batchId,
    quotas,
    totalQuota,
    exhausted: false,
    reason:
      phase === "REPROBE"
        ? "Số liệu giảm nên đang dò lại để bám xu hướng mới."
        : "Đang dò tìm hướng đi ban đầu.",
  };
}

/**
 * Các band giờ giao với khung đăng của người dùng.
 *
 * KHÔNG BAO GIỜ trả về band nằm ngoài khung — dò không được phép làm bài đăng
 * ở giờ người dùng không cho.
 */
export function usableBands(config: {
  windowStart: string;
  windowEnd: string;
}): TimeBand[] {
  const parse = (v: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec((v ?? "").trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return h * 60 + min;
  };

  const start = parse(config.windowStart) ?? 7 * 60;
  const end = parse(config.windowEnd) ?? 21 * 60;
  if (end <= start) return [...TIME_BANDS];

  const ranges: Record<TimeBand, { startMin: number; endMin: number }> = {
    SANG: { startMin: 6 * 60, endMin: 11 * 60 },
    TRUA: { startMin: 11 * 60, endMin: 14 * 60 },
    CHIEU: { startMin: 14 * 60, endMin: 18 * 60 },
    TOI: { startMin: 18 * 60, endMin: 22 * 60 },
  };

  return TIME_BANDS.filter((band) => {
    const r = ranges[band];
    return Math.max(r.startMin, start) < Math.min(r.endMin, end);
  });
}

// ============================================================
// 4. Chọn chỉ thị dò cho slot kế tiếp
// ============================================================

export type ProbeHint = {
  pillarName: string | null;
  hookStyle: HookStyle | null;
  band: TimeBand | null;
  mediaKind: "IMAGE" | "VIDEO" | null;
  /** Dòng chỉ thị đưa vào prompt — chỉ nói về CÁCH VIẾT. */
  note: string;
  /** Ba hướng cụ thể đã chọn, để ghi vào nhật ký dò. */
  entries: ProbeQuota[];
};

/**
 * Chọn chỉ thị dò cho bài kế tiếp: hướng nào còn thiếu nhiều quota nhất.
 *
 * Cách chọn "thiếu nhiều nhất" (round-robin tham lam) thay vì ngẫu nhiên: quota
 * được lấp đầy theo thứ tự cần nhất, nên nếu lượt lập kế hoạch bị cắt giữa
 * chừng (AI lỗi, hết ngân sách), những hướng còn trống nhiều vẫn được ưu tiên
 * ở lượt sau. Ngẫu nhiên có thể để một hướng không bao giờ được thử.
 *
 * ⚠️ `createdInBatch` là ĐIỀU KIỆN DỪNG BẮT BUỘC, không phải tham số trang trí.
 *
 * VÌ SAO (lỗi thật đã gặp): mỗi hướng có quota riêng (trụ cột, 4 kiểu hook,
 * 4 band giờ…), nên tổng quota của các hướng LUÔN lớn hơn `plan.totalQuota` —
 * một bài đóng góp vào nhiều hướng cùng lúc. Nếu chỉ dựa vào quota từng hướng,
 * bộ dò sẽ chạy tới khi lấp hết mọi quota, tức là tạo 28 bài cho một ngân sách
 * 12 bài. Phải đếm số bài ĐÃ TẠO trong đợt và dừng đúng ngân sách.
 */
export function pickProbeHint(
  plan: ProbePlan,
  used: Record<string, number>,
  createdInBatch = 0
): ProbeHint | null {
  if (plan.quotas.length === 0) return null;
  // Hết ngân sách đợt dò → dừng, dù vẫn còn quota ở từng hướng
  if (plan.totalQuota > 0 && createdInBatch >= plan.totalQuota) return null;

  const pick = (kind: ProbeKind): ProbeQuota | null => {
    const candidates = plan.quotas
      .filter((q) => q.kind === kind)
      .map((q) => ({ q, left: q.quota - (used[`${q.kind}:${q.value}`] ?? 0) }))
      .filter((c) => c.left > 0);
    if (candidates.length === 0) return null;
    return [...candidates].sort((a, b) => b.left - a.left)[0].q;
  };

  const pillar = pick("PILLAR");
  const hook = pick("HOOK");
  const band = pick("TIME_BAND");
  const media = pick("MEDIA");

  if (!pillar && !hook && !band && !media) return null;

  const notes: string[] = [];
  const entries: ProbeQuota[] = [];

  if (pillar) {
    entries.push(pillar);
    // Không nhắc trụ cột trong note vì trụ cột đã được truyền riêng
    // (brand.pillar) — nhắc lại sẽ khiến prompt trùng ý.
  }
  if (hook) {
    entries.push(hook);
    notes.push(
      `${HOOK_STYLE_INSTRUCTIONS[hook.value as HookStyle] ?? ""} (kiểu: ${
        HOOK_STYLE_LABELS[hook.value as HookStyle] ?? hook.value
      })`
    );
  }
  if (band) {
    entries.push(band);
    notes.push(`Ưu tiên khung giờ ${TIME_BAND_LABELS[band.value as TimeBand]}.`);
  }
  if (media) {
    entries.push(media);
    notes.push(
      media.value === "VIDEO"
        ? "Bài này nên dùng video."
        : "Bài này nên dùng ảnh."
    );
  }

  return {
    pillarName: pillar?.value ?? null,
    hookStyle: (hook?.value as HookStyle) ?? null,
    band: (band?.value as TimeBand) ?? null,
    mediaKind: (media?.value as "IMAGE" | "VIDEO") ?? null,
    note: notes.join(" "),
    entries,
  };
}

// ============================================================
// 5. Kết luận của một đợt dò
// ============================================================

/** Ngưỡng z để coi một hướng là tốt/kém. */
export const PROBE_GOOD_Z = 0.5;
export const PROBE_BAD_Z = -0.5;

/**
 * Kết luận từng hướng dò đã thử: tốt / kém / trung tính / còn chờ.
 *
 * Hướng dưới ngưỡng mẫu vẫn để PENDING, KHÔNG kết luận là kém — nếu không,
 * một hướng chỉ được thử 1 bài vì lịch bị cắt sẽ bị loại vĩnh viễn.
 */
export function evaluateProbeResults(
  entries: { kind: string; value: string; result: string }[],
  report: PerformanceReport
): { kind: string; value: string; result: string; score: number | null }[] {
  const stats: { key: string; posts: number; z: number }[] = [
    ...report.byPillar.map((g) => ({ key: `PILLAR:${g.key}`, posts: g.posts, z: g.z })),
    ...report.byHookStyle.map((g) => ({ key: `HOOK:${g.key}`, posts: g.posts, z: g.z })),
    ...report.byBand.map((g) => ({ key: `TIME_BAND:${g.key}`, posts: g.posts, z: g.z })),
    ...report.byMediaKind.map((g) => ({ key: `MEDIA:${g.key}`, posts: g.posts, z: g.z })),
  ];
  const byKey = new Map(stats.map((s) => [s.key, s]));

  return entries.map((e) => {
    const key = `${e.kind}:${e.value}`;
    const stat = byKey.get(key);
    if (!stat || stat.posts < MIN_SAMPLES_PER_DIRECTION) {
      return { kind: e.kind, value: e.value, result: "PENDING", score: null };
    }

    const result =
      stat.z >= PROBE_GOOD_Z ? "GOOD" : stat.z <= PROBE_BAD_Z ? "BAD" : "NEUTRAL";
    return { kind: e.kind, value: e.value, result, score: stat.z };
  });
}

// ============================================================
// 6. Hướng nội dung đang triển khai + nhận xét
// ============================================================

export type DirectionStatus =
  | "EXPLORING"
  | "RISING"
  | "STABLE"
  | "DECLINING"
  | "EXHAUSTED";

export const DIRECTION_STATUS_LABELS: Record<DirectionStatus, string> = {
  EXPLORING: "Đang thử",
  RISING: "Đang lên",
  STABLE: "Ổn định",
  DECLINING: "Đang giảm",
  EXHAUSTED: "Đã bão hoà",
};

export type DirectionDraft = {
  kind: "PILLAR" | "HOOK" | "TIME_BAND" | "MEDIA_KIND" | "SERVICE_AREA";
  value: string;
  label: string;
  status: DirectionStatus;
  sampleSize: number;
  avgScore: number;
  prevAvgScore: number | null;
  changePct: number | null;
  estLifeDays: number | null;
  recommendation: string;
};

/** Ngưỡng coi một hướng là đang lên / đang giảm. */
export const RISING_PCT = 15;
export const DECLINING_PCT = -15;
/** Một hướng chiếm hơn tỉ lệ này VÀ đang giảm thì coi là đã bão hoà. */
export const EXHAUSTED_SHARE = 0.5;
/** Cửa sổ ước lượng độ bền (ngày). */
const LIFE_WINDOW_DAYS = 14;
/** Chặn trên của ước lượng độ bền — không hứa xa hơn 3 tháng. */
export const MAX_EST_LIFE_DAYS = 90;

/**
 * Dựng danh sách hướng nội dung đang triển khai — dữ liệu cho phần NHẬN XÉT.
 *
 * `estLifeDays` là ƯỚC LƯỢNG THÔ: ngoại suy tuyến tính từ mức hiệu quả hiện tại
 * và mức của kỳ trước, giả định tốc độ giảm giữ nguyên. Nó KHÔNG phải dự báo
 * của Facebook và không phải mô hình học máy. Giao diện bắt buộc nói rõ điều
 * này (xem `honesty` trong Commentary) để người dùng không hiểu sai.
 *
 * Trả null khi chưa đủ mẫu hoặc chưa có kỳ trước — thà nói "chưa biết" còn hơn
 * đưa ra một con số trông chắc chắn mà không có cơ sở.
 */
export function computeDirections(report: PerformanceReport): DirectionDraft[] {
  const out: DirectionDraft[] = [];

  const push = (
    kind: DirectionDraft["kind"],
    group: GroupStat,
    label: string
  ) => {
    const changePct = group.changePct;
    const exhausted =
      changePct !== null &&
      changePct <= DECLINING_PCT &&
      group.share >= EXHAUSTED_SHARE &&
      group.posts >= MIN_SAMPLES_PER_DIRECTION;

    let status: DirectionStatus;
    if (group.posts < MIN_SAMPLES_PER_DIRECTION) status = "EXPLORING";
    else if (exhausted) status = "EXHAUSTED";
    else if (changePct === null) status = "STABLE";
    else if (changePct >= RISING_PCT) status = "RISING";
    else if (changePct <= DECLINING_PCT) status = "DECLINING";
    else status = "STABLE";

    const prevAvgScore =
      changePct !== null ? group.avgScore / (1 + changePct / 100) : null;

    out.push({
      kind,
      value: group.key,
      label,
      status,
      sampleSize: group.posts,
      avgScore: group.avgScore,
      prevAvgScore: prevAvgScore !== null && Number.isFinite(prevAvgScore) ? prevAvgScore : null,
      changePct,
      estLifeDays: estimateLifeDays(group, status),
      recommendation: recommendFor(status, group),
    });
  };

  for (const g of report.byPillar) push("PILLAR", g, g.key);
  for (const g of report.byHookStyle) push("HOOK", g, g.label);
  for (const g of report.byBand) push("TIME_BAND", g, g.label);
  for (const g of report.byMediaKind) push("MEDIA_KIND", g, g.label);
  for (const g of report.byServiceArea) push("SERVICE_AREA", g, g.key);

  return out;
}

/**
 * Ước lượng số ngày còn lại của một hướng.
 *
 * Công thức: nếu hiệu quả đang giảm `p%` mỗi 14 ngày thì còn `avgScore / (giảm
 * tuyệt đối mỗi ngày)` ngày nữa là về 0. Kẹp `[0, 90]`.
 */
function estimateLifeDays(group: GroupStat, status: DirectionStatus): number | null {
  if (status === "EXPLORING") return null;
  if (status === "EXHAUSTED") return 0;
  if (group.changePct === null) return null;
  if (group.changePct >= 0) return MAX_EST_LIFE_DAYS;

  const dropPerWindow = (group.avgScore * Math.abs(group.changePct)) / 100;
  if (dropPerWindow <= 0) return null;

  const dropPerDay = dropPerWindow / LIFE_WINDOW_DAYS;
  const days = group.avgScore / dropPerDay;
  if (!Number.isFinite(days)) return null;

  return Math.max(0, Math.min(MAX_EST_LIFE_DAYS, Math.round(days)));
}

function recommendFor(status: DirectionStatus, group: GroupStat): string {
  switch (status) {
    case "RISING":
      return "Tăng tỉ trọng";
    case "DECLINING":
      return "Giảm tỉ trọng, đổi góc tiếp cận";
    case "EXHAUSTED":
      return "Tạm dừng hướng này và thử hướng khác";
    case "EXPLORING":
      return `Cần thêm bài để đánh giá (${group.posts}/${MIN_SAMPLES_PER_DIRECTION})`;
    case "STABLE":
    default:
      return "Giữ nguyên";
  }
}

// ============================================================
// 7. Nhận xét
// ============================================================

export type Commentary = {
  /** Một câu tóm tắt tình hình hiện tại. */
  headline: string;
  /** Nội dung đang triển khai theo hướng nào. */
  directionSummary: string;
  /** Nhận xét cụ thể theo từng điểm. */
  bullets: string[];
  /** Việc nên làm tiếp. */
  actions: string[];
  /**
   * Các dòng minh bạch BẮT BUỘC hiển thị kèm nhận xét. Có ba giới hạn mà nếu
   * không nói rõ thì người dùng sẽ hiểu nhận xét là số liệu chính thức của
   * Facebook hoặc là dự báo chắc chắn.
   */
  honesty: string[];
};

/** Ba giới hạn luôn phải nói rõ. */
export const HONESTY_NOTES = [
  `Số liệu cấp bài do Facebook cập nhật khoảng 24 giờ một lần — số hiển thị có thể chậm hơn thực tế trong ngày.`,
  `"Còn hiệu quả ~N ngày" là ước lượng thô, ngoại suy từ chính số liệu của Page bạn, KHÔNG phải dự báo của Facebook.`,
  `Khi token chưa có quyền xem lượt hiển thị, thứ hạng chỉ dựa trên tương tác (cảm xúc, bình luận, chia sẻ).`,
];

/**
 * Sinh nhận xét cho người dùng.
 *
 * Cố ý dùng HÀM THUẦN sinh câu chữ thay vì gọi AI viết nhận xét: cùng một bộ
 * số liệu luôn cho cùng một câu, người dùng kiểm chứng được, và không có nguy
 * cơ AI "bịa" thêm kết luận không có trong dữ liệu.
 */
export function buildCommentary(
  report: PerformanceReport,
  directions: DirectionDraft[],
  phase: LearningPhase,
  regression: RegressionReport,
  probe: { used: number; budget: number } | null
): Commentary {
  if (report.sampleSize === 0) {
    return {
      headline: "Chưa có bài AutoPilot nào được đăng nên chưa có số liệu để nhận xét.",
      directionSummary:
        "Hệ thống sẽ bắt đầu dò tìm hướng đi ngay khi có bài đầu tiên lên sóng.",
      bullets: [
        "Bài soạn tay không được dùng để tối ưu — chỉ số liệu của bài do AutoPilot tạo mới phản ánh đúng vòng lặp tự động.",
      ],
      actions: [
        "Bật AutoPilot cho Page này để hệ thống bắt đầu dò hướng.",
        "Đảm bảo hồ sơ thương hiệu và trụ cột nội dung đã đầy đủ.",
      ],
      honesty: [HONESTY_NOTES[0], HONESTY_NOTES[2]],
    };
  }

  const bullets: string[] = [];
  const actions: string[] = [];

  // ---- Nhận xét về hướng đang chiếm ưu thế ----
  const topPillar = [...report.byPillar].sort((a, b) => b.share - a.share)[0] ?? null;
  const risingPillars = directions.filter((d) => d.kind === "PILLAR" && d.status === "RISING");
  const decliningPillars = directions.filter(
    (d) => d.kind === "PILLAR" && (d.status === "DECLINING" || d.status === "EXHAUSTED")
  );

  if (topPillar) {
    bullets.push(
      `Nội dung hiện nghiêng về "${topPillar.key}" (${Math.round(
        topPillar.share * 100
      )}% số bài) với tương tác trung bình ${formatScore(topPillar.avgScore)}.`
    );
  }
  if (risingPillars.length > 0) {
    bullets.push(
      `Đang lên: ${risingPillars
        .map((d) => `"${d.label}" (${pctStr(d.changePct)})`)
        .join(", ")} — nên viết thêm theo hướng này.`
    );
  }
  if (decliningPillars.length > 0) {
    bullets.push(
      `Đang xuống: ${decliningPillars
        .map(
          (d) =>
            `"${d.label}" (${pctStr(d.changePct)}${
              d.estLifeDays !== null ? `, ước lượng còn ~${d.estLifeDays} ngày` : ""
            })`
        )
        .join(", ")}.`
    );
  }

  // ---- Hook & khung giờ ----
  const topHook = directions
    .filter((d) => d.kind === "HOOK" && d.status === "RISING")
    .sort((a, b) => b.avgScore - a.avgScore)[0];
  if (topHook) {
    bullets.push(`Kiểu mở bài hiệu quả nhất hiện tại: ${topHook.label}.`);
  }

  const topBand = directions
    .filter((d) => d.kind === "TIME_BAND" && d.avgScore > 0)
    .sort((a, b) => b.avgScore - a.avgScore)[0];
  if (topBand) {
    bullets.push(`Khung giờ người xem đáp lại tốt nhất: ${topBand.label}.`);
  }

  if (report.trend7d) {
    const c = report.trend7d.changePct;
    bullets.push(
      `So với 7 ngày trước, hiệu quả 7 ngày gần đây ${c >= 0 ? "tăng" : "giảm"} ${Math.abs(
        Math.round(c)
      )}%.`
    );
  }

  if (!report.reachAvailable) {
    bullets.push(
      "Chưa có số lượt hiển thị/tiếp cận vì token thiếu quyền read_insights — thứ hạng hiện chỉ dựa trên tương tác."
    );
    actions.push(
      "Thêm quyền read_insights cho Facebook App rồi đồng bộ lại ở trang Facebook Apps để xếp hạng chính xác hơn."
    );
  }

  // ---- Giai đoạn & việc nên làm ----
  if (phase === "PROBE" || phase === "REPROBE") {
    const used = probe?.used ?? 0;
    const budget = probe?.budget ?? PROBE_MAX_POSTS;
    actions.push(
      `Đang dò có kiểm soát: ${used}/${budget} bài — hệ thống đang thử đều các trụ cột, kiểu mở bài và khung giờ để tìm hướng đi.`
    );
  } else {
    actions.push(
      "Hệ thống đang áp dụng số liệu vào việc chọn trụ cột và khung giờ cho các bài tiếp theo (mức điều chỉnh tối đa ±30%)."
    );
  }

  if (regression.triggered) {
    bullets.push(`Phát hiện nội dung bắt đầu lỗi thời: ${regression.reason}`);
    actions.push(
      "Hệ thống đã tự chuyển sang kiểm tra lại để tìm hướng mới — nội dung thương hiệu vẫn giữ nguyên, chỉ đổi cách triển khai."
    );
  } else if (regression.signals.length > 0) {
    bullets.push(`Theo dõi: ${regression.reason}`);
  }

  if (decliningPillars.some((d) => d.status === "EXHAUSTED")) {
    actions.push(
      "Cân nhắc hạ tỉ trọng trụ cột đã bão hoà ở trang Thương hiệu, hoặc viết lại hướng đó theo góc khác."
    );
  }

  if (report.confidence === "LOW") {
    actions.push(
      `Cần thêm bài đã đăng để kết luận chắc hơn (hiện ${report.sampleSize} bài; cần từ ${MIN_SAMPLES_FOR_EXPLOIT} bài để bắt đầu tối ưu).`
    );
  }

  // ---- Câu tóm tắt ----
  const headline =
    report.confidence === "NONE"
      ? `Chưa đủ dữ liệu để kết luận (0 bài đã đăng đủ chín).`
      : `Đã phân tích ${report.sampleSize} bài AutoPilot trong ${report.windowDays} ngày — độ tin cậy ${
          report.confidence === "HIGH" ? "cao" : report.confidence === "MEDIUM" ? "trung bình" : "thấp"
        }.`;

  const directionSummary =
    topPillar !== null
      ? `Nội dung đang triển khai nghiêng về trụ cột "${topPillar.key}"; ${
          risingPillars.length > 0
            ? `hướng đang lên là ${risingPillars.map((d) => `"${d.label}"`).join(", ")}`
            : "chưa có hướng nào tăng rõ"
        }; ${
          decliningPillars.length > 0
            ? `hướng đang xuống là ${decliningPillars.map((d) => `"${d.label}"`).join(", ")}`
            : "không có hướng nào giảm rõ"
        }.`
      : "Chưa xác định được hướng nào đang chiếm ưu thế.";

  if (actions.length === 0) {
    actions.push("Tiếp tục theo dõi — chưa cần thay đổi gì.");
  }

  const honesty = [...HONESTY_NOTES];
  if (!report.reachAvailable) honesty.splice(1, 1);

  return { headline, directionSummary, bullets, actions, honesty };
}

function formatScore(score: number): string {
  return `${Math.round(score * 10) / 10} điểm`;
}

function pctStr(changePct: number | null): string {
  if (changePct === null) return "chưa đủ dữ liệu";
  return `${changePct > 0 ? "+" : ""}${Math.round(changePct)}%`;
}
