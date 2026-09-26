// ============================================================
// PHÂN TÍCH SỐ LIỆU HIỆU QUẢ — logic THUẦN.
//
// Nhận danh sách bài đã đăng kèm số liệu, trả về:
//   - Bức tranh tổng thể (trung vị, mức tin cậy, xu hướng 7 ngày).
//   - Hiệu quả theo từng hướng: trụ cột, band giờ, kiểu hook, loại media,
//     địa bàn.
//   - Đề xuất điều chỉnh CÓ GIỚI HẠN (trọng số trụ cột, band giờ ưu tiên).
//
// BA NGUYÊN TẮC KHÔNG ĐƯỢC VI PHẠM
//
// 1. KHÔNG BAO GIỜ đổi sự thật thương hiệu. Hàm ở đây chỉ trả về SỐ (trọng
//    số, band giờ, tên kiểu hook). Không hàm nào trả về chủ đề mới, sản phẩm
//    mới, địa danh mới, hay nội dung văn bản để đăng. Tầng gọi (autopilot.ts)
//    chỉ dùng chúng để chọn lại thứ tự ưu tiên giữa những thứ ĐÃ CÓ.
//
// 2. KHÔNG GHI GÌ XUỐNG DB. Đề xuất trọng số chỉ nằm trong bộ nhớ của lượt
//    lập kế hoạch; trọng số gốc người dùng đặt trong ContentPillar không bị
//    sửa. Người dùng tắt tối ưu là mọi thứ trở về như cũ.
//
// 3. KHÔNG HỌC TỪ NHIỄU. Mọi đề xuất đều có cổng mẫu tối thiểu và biên độ
//    chặn trên. Dưới ngưỡng thì trả về "không áp dụng" kèm lý do, thay vì
//    đoán bừa từ 2-3 bài.
//
// Tách khỏi autopilot.ts (có "server-only") để kiểm thử độc lập:
// xem scripts/test-insights.mjs.
// ============================================================

import {
  averageOf,
  CONFIDENCE_THRESHOLDS,
  dispersionOf,
  HOOK_STYLES,
  HOOK_STYLE_LABELS,
  MIN_SAMPLES_FOR_TIME_BIAS,
  MIN_SAMPLES_PER_DIRECTION,
  madOf,
  medianOf,
  mediaKindOf,
  RECENT_WINDOW_DAYS,
  robustZ,
  TIME_BANDS,
  TIME_BAND_LABELS,
  TIME_BAND_RANGES,
  type HookStyle,
  type TimeBand,
// Đuôi ".ts" là BẮT BUỘC, không phải phong cách: các module thuần này được
// kiểm thử bằng `node --experimental-strip-types` (scripts/test-insights.mjs),
// và Node ESM không tự thêm đuôi khi resolve. Next.js/TS vẫn chấp nhận đuôi
// tường minh nên cả hai môi trường đều chạy được.
} from "./insights-core.ts";

// ============================================================
// Kiểu dữ liệu
// ============================================================

/**
 * Một bài đã đăng, đã quy đổi thành các ĐẶC TRƯNG so sánh được.
 *
 * Chỉ gồm bài do AutoPilot tạo (`origin = AUTOPILOT`): bài người dùng tự soạn
 * có chủ đích riêng (chiến dịch, thông báo...) nên học từ chúng sẽ dạy hệ
 * thống những hướng không lặp lại được.
 */
export type InsightSample = {
  postId: string;
  pillarName: string | null;
  serviceArea: string | null;
  /** Dòng đầu bài viết — dùng để chấm kiểu mở bài và hiển thị. */
  hook: string;
  hookStyle: HookStyle;
  topic: string | null;
  contentChars: number;
  mediaKind: "IMAGE" | "VIDEO";
  band: TimeBand;
  publishedAt: Date;
  /** STANDARD | PROBE */
  probeKind: string;
  reactions: number;
  comments: number;
  shares: number;
  /** Số người tiếp cận/xem — null khi token thiếu `read_insights`. */
  distributionValue: number | null;
};

/** Một bài đã được chấm điểm. */
export type ScoredSample = InsightSample & {
  score: number;
  engagement: number;
  /** Robust z so với trung vị của cả Page. */
  z: number;
};

/** Thống kê của một HƯỚNG (một trụ cột, một band giờ...). */
export type GroupStat = {
  key: string;
  /** Nhãn hiển thị tiếng Việt (band giờ, kiểu hook); bằng key với trụ cột/địa bàn. */
  label: string;
  posts: number;
  /** Tỉ lệ số bài của hướng này trên tổng số bài đang xét. */
  share: number;
  avgScore: number;
  avgEngagement: number;
  avgDistribution: number | null;
  /** Robust z của avgScore so với trung vị Page. */
  z: number;
  /** % thay đổi hiệu quả so với 7 ngày trước đó (âm = đang tụt). */
  changePct: number | null;
};

export type Confidence = "NONE" | "LOW" | "MEDIUM" | "HIGH";

export type PerformanceReport = {
  sampleSize: number;
  windowDays: number;
  /**
   * Có ít nhất một bài kèm số người tiếp cận hay không.
   * false = token thiếu `read_insights`; xếp hạng chỉ dựa trên tương tác và
   * giao diện PHẢI nói rõ điều này cho người dùng.
   */
  reachAvailable: boolean;
  confidence: Confidence;
  medianScore: number;
  madScore: number;
  medianEngagement: number;
  medianDistribution: number | null;
  byPillar: GroupStat[];
  byBand: GroupStat[];
  byHookStyle: GroupStat[];
  byMediaKind: GroupStat[];
  byServiceArea: GroupStat[];
  /** Bài hiệu quả nhất (tối đa 3) và kém nhất (tối đa 3). */
  topPosts: ScoredSample[];
  weakPosts: ScoredSample[];
  /** Xu hướng 7 ngày gần nhất so với 7 ngày trước đó. Null khi thiếu mẫu. */
  trend7d: { recentAvg: number; previousAvg: number; changePct: number } | null;
};

// ============================================================
// Phân tích
// ============================================================

function confidenceOf(sampleSize: number): Confidence {
  if (sampleSize < CONFIDENCE_THRESHOLDS.low) return sampleSize === 0 ? "NONE" : "LOW";
  if (sampleSize < CONFIDENCE_THRESHOLDS.medium) return "LOW";
  if (sampleSize < CONFIDENCE_THRESHOLDS.high) return "MEDIUM";
  return "HIGH";
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * % thay đổi giữa hai kỳ. Trả null khi kỳ trước bằng 0 (chia cho 0) — giao
 * diện sẽ hiện "—" thay vì "∞%".
 */
function changePctOf(recent: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous <= 0) return null;
  return ((recent - previous) / previous) * 100;
}

/** Nhãn hiển thị cho một giá trị hướng. */
function labelOf(kind: GroupKey, value: string): string {
  if (kind === "band") return TIME_BAND_LABELS[value as TimeBand] ?? value;
  if (kind === "hook") return HOOK_STYLE_LABELS[value as HookStyle] ?? value;
  if (kind === "media") return value === "VIDEO" ? "Video" : "Ảnh";
  return value;
}

type GroupKey = "pillar" | "band" | "hook" | "media" | "area";

/**
 * Gom nhóm bài theo một hàm lấy khoá rồi tính thống kê cho từng nhóm.
 *
 * `changePct` được tính BÊN TRONG nhóm: so 7 ngày gần nhất với 7 ngày trước đó,
 * cần ít nhất 2 bài mỗi kỳ — ít hơn thì không đủ để nói hướng đó đang lên hay
 * xuống, và trả null thay vì báo động sai.
 */
function groupStats(
  scored: ScoredSample[],
  kind: GroupKey,
  keyOf: (s: ScoredSample) => string | null,
  now: Date
): GroupStat[] {
  const buckets = new Map<string, ScoredSample[]>();

  for (const s of scored) {
    const key = keyOf(s);
    if (!key) continue;
    const list = buckets.get(key);
    if (list) list.push(s);
    else buckets.set(key, [s]);
  }

  const total = scored.length || 1;
  const recentCut = now.getTime() - RECENT_WINDOW_DAYS * DAY_MS;
  const previousCut = recentCut - RECENT_WINDOW_DAYS * DAY_MS;

  const out: GroupStat[] = [];
  for (const [key, list] of buckets) {
    const scores = list.map((s) => s.score);
    const distributions = list
      .map((s) => s.distributionValue)
      .filter((d): d is number => typeof d === "number");

    const recent = list.filter((s) => s.publishedAt.getTime() >= recentCut);
    const previous = list.filter(
      (s) =>
        s.publishedAt.getTime() >= previousCut && s.publishedAt.getTime() < recentCut
    );

    const changePct =
      recent.length >= 2 && previous.length >= 2
        ? changePctOf(
            averageOf(recent.map((s) => s.score)),
            averageOf(previous.map((s) => s.score))
          )
        : null;

    out.push({
      key,
      label: labelOf(kind, key),
      posts: list.length,
      share: list.length / total,
      avgScore: averageOf(scores),
      avgEngagement: averageOf(list.map((s) => s.engagement)),
      avgDistribution: distributions.length > 0 ? averageOf(distributions) : null,
      // z của cả NHÓM (không phải từng bài) — dùng trung vị Page ở dưới
      z: 0,
      changePct,
    });
  }

  // Sắp xếp giảm dần theo hiệu quả — giao diện hiển thị luôn theo thứ tự này
  return out.sort((a, b) => b.avgScore - a.avgScore);
}

/**
 * Phân tích toàn bộ số liệu của một Page.
 *
 * @param samples bài AutoPilot đã đăng trong cửa sổ đánh giá
 * @param opts.now mốc thời gian — truyền vào để hàm thuần và test tất định
 */
export function analyzePerformance(
  samples: InsightSample[],
  opts: { now: Date; windowDays?: number }
): PerformanceReport {
  const now = opts.now;
  const windowDays = opts.windowDays ?? 90;

  const scored: ScoredSample[] = samples.map((s) => ({
    ...s,
    score: s.reactions + 3 * s.comments + 5 * s.shares,
    engagement: s.reactions + 3 * s.comments + 5 * s.shares,
    z: 0,
  }));

  const scores = scored.map((s) => s.score);
  const medianScore = medianOf(scores);
  const madScore = madOf(scores, medianScore);
  // Độ tán xạ có đường lùi khi MAD = 0 — xem dispersionOf trong insights-core.ts.
  // Thiếu bước này thì Page nhiều bài cùng 0 tương tác sẽ không bao giờ có
  // hướng nào được nhận ra là tốt/kém, và tính năng im lặng không làm gì.
  const dispersion = dispersionOf(scores, medianScore, madScore);

  for (const s of scored) s.z = robustZ(s.score, medianScore, dispersion);

  const distributions = scored
    .map((s) => s.distributionValue)
    .filter((d): d is number => typeof d === "number");

  const byPillar = groupStats(scored, "pillar", (s) => s.pillarName, now);
  const byBand = groupStats(scored, "band", (s) => s.band, now);
  const byHookStyle = groupStats(scored, "hook", (s) => s.hookStyle, now);
  const byMediaKind = groupStats(scored, "media", (s) => s.mediaKind, now);
  const byServiceArea = groupStats(scored, "area", (s) => s.serviceArea, now);

  // z cho từng nhóm: so hiệu quả TRUNG BÌNH của nhóm với trung vị Page. Khác z
  // của từng bài (so điểm một bài) — ở đây trả lời "hướng này nói chung thế nào".
  //
  // ⚠️ PHẢI dùng `dispersion`, không phải `madScore`: khi MAD = 0 mà ở đây lại
  // chia cho 0 thì mọi nhóm đều z = 0 và không đề xuất nào được sinh ra.
  for (const group of [byPillar, byBand, byHookStyle, byMediaKind, byServiceArea]) {
    for (const g of group) g.z = robustZ(g.avgScore, medianScore, dispersion);
  }

  const recentCut = now.getTime() - RECENT_WINDOW_DAYS * DAY_MS;
  const previousCut = recentCut - RECENT_WINDOW_DAYS * DAY_MS;
  const recent = scored.filter((s) => s.publishedAt.getTime() >= recentCut);
  const previous = scored.filter(
    (s) =>
      s.publishedAt.getTime() >= previousCut && s.publishedAt.getTime() < recentCut
  );

  const trend7d =
    recent.length >= 2 && previous.length >= 2
      ? (() => {
          const recentAvg = averageOf(recent.map((s) => s.score));
          const previousAvg = averageOf(previous.map((s) => s.score));
          return {
            recentAvg,
            previousAvg,
            changePct: changePctOf(recentAvg, previousAvg) ?? 0,
          };
        })()
      : null;

  const sortedByScore = [...scored].sort((a, b) => b.score - a.score);

  return {
    sampleSize: scored.length,
    windowDays,
    reachAvailable: distributions.length > 0,
    confidence: confidenceOf(scored.length),
    medianScore,
    madScore,
    medianEngagement: medianScore,
    medianDistribution: distributions.length > 0 ? medianOf(distributions) : null,
    byPillar,
    byBand,
    byHookStyle,
    byMediaKind,
    byServiceArea,
    topPosts: sortedByScore.slice(0, 3),
    weakPosts: sortedByScore.slice(-3).reverse(),
    trend7d,
  };
}

// ============================================================
// Đề xuất 1: trọng số trụ cột
// ============================================================

/** Biên độ tối đa được phép chỉnh trọng số (±30%). */
export const PILLAR_WEIGHT_MAX_FACTOR = 1.3;
/** Sàn tối đa được phép hạ trọng số (không hạ dưới 50% giá trị gốc). */
export const PILLAR_WEIGHT_MIN_FACTOR = 0.5;

export type PillarWeightSuggestion = {
  /** Trọng số hiệu dụng theo tên trụ cột. Không áp dụng thì bằng trọng số gốc. */
  weights: Record<string, number>;
  applied: boolean;
  reason: string;
};

/**
 * Đề xuất trọng số trụ cột dựa trên hiệu quả thực tế.
 *
 * VÌ SAO CHẶN BIÊN ĐỘ: số liệu vài chục bài vẫn còn nhiễu. Nếu cho phép đẩy
 * một trụ cột từ 10% lên 60% chỉ vì nó đang may mắn, Page có thể mất hẳn
 * nhóm nội dung khác trong nhiều tuần trước khi phát hiện sai. Biên độ ±30% và
 * sàn 50% khiến mỗi lượt chỉ "nghiêng" nhẹ, sai thì vẫn sửa được nhanh.
 *
 * VÌ SAO CHUẨN HOÁ VỀ ĐÚNG TỔNG CŨ: tổng trọng số quyết định số bài mỗi ngày.
 * Nếu tổng đổi, người dùng thấy số bài thay đổi mà không hiểu vì sao — đúng
 * thứ họ không cho phép tính năng này làm.
 */
export function suggestPillarWeights(
  pillars: { name: string; weight: number }[],
  report: PerformanceReport
): PillarWeightSuggestion {
  const original: Record<string, number> = {};
  for (const p of pillars) original[p.name] = p.weight;

  const noop = (reason: string): PillarWeightSuggestion => ({
    weights: { ...original },
    applied: false,
    reason,
  });

  if (pillars.length <= 1) {
    return noop("Chỉ có một trụ cột nên không cần điều chỉnh tỉ trọng.");
  }
  if (report.confidence === "NONE") {
    return noop("Chưa có bài nào đủ chín để đánh giá (cần ít nhất 8 bài đã đăng).");
  }

  const statByName = new Map(report.byPillar.map((g) => [g.key, g]));

  // Cổng chất lượng: chỉ trụ cột có ĐỦ MẪU mới được điều chỉnh. Trụ cột chưa
  // đủ mẫu giữ nguyên trọng số — không kéo nó xuống chỉ vì thiếu dữ liệu.
  const adjustable = pillars.filter((p) => {
    const stat = statByName.get(p.name);
    return stat !== undefined && stat.posts >= MIN_SAMPLES_PER_DIRECTION;
  });

  if (adjustable.length < 2) {
    return noop(
      `Cần ít nhất 2 trụ cột có từ ${MIN_SAMPLES_PER_DIRECTION} bài trở lên mới đánh giá được — hiện có ${adjustable.length}.`
    );
  }

  const proposed: Record<string, number> = { ...original };
  for (const p of adjustable) {
    const stat = statByName.get(p.name)!;
    // tanh giữ phản ứng trong khoảng (0,1): z càng lớn càng tiến gần biên độ
    // tối đa, z nhỏ thì gần như không đổi. Tránh nhảy bậc khi z vừa vượt ngưỡng.
    const factor = Math.min(
      PILLAR_WEIGHT_MAX_FACTOR,
      Math.max(
        1 + 0.3 * Math.tanh(stat.z / 2),
        // Chặn dưới theo biên độ, rồi mới áp sàn để sàn luôn thắng
        1 - 0.3
      )
    );
    const clamped = Math.min(
      Math.max(factor, PILLAR_WEIGHT_MIN_FACTOR),
      PILLAR_WEIGHT_MAX_FACTOR
    );
    proposed[p.name] = p.weight * clamped;
  }

  const normalized = normalizeToTotal(proposed, original, adjustable.map((p) => p.name));

  const changed = Object.keys(original).filter(
    (name) => Math.abs(normalized[name] - original[name]) >= 1
  );
  if (changed.length === 0) {
    return noop("Hiệu quả giữa các trụ cột chênh lệch chưa đủ rõ để đổi tỉ trọng.");
  }

  return {
    weights: normalized,
    applied: true,
    reason: `Điều chỉnh theo số liệu (tối đa ±30%): ${changed
      .map((n) => `"${n}" ${original[n]} → ${normalized[n]}`)
      .join(", ")}.`,
  };
}

/**
 * Chuẩn hoá trọng số về ĐÚNG tổng ban đầu, dùng phương pháp largest-remainder
 * để tổng luôn khớp (làm tròn đơn thuần có thể lệch 1–2 điểm, đủ để đổi số bài).
 *
 * `adjustableNames` là những trụ cột ĐƯỢC PHÉP đổi. Chỉ nhóm này được chuẩn
 * hoá lại với nhau; các trụ cột còn lại giữ nguyên trọng số gốc.
 *
 * VÌ SAO PHẢI GIỚI HẠN PHẠM VI CHUẨN HOÁ (lỗi thật đã gặp): nếu chuẩn hoá trên
 * TẤT CẢ trụ cột, một trụ cột chưa đủ mẫu (không được phép điều chỉnh) vẫn bị
 * dịch 1–2 điểm chỉ vì phép chia lại phần dư. Người dùng sẽ thấy trọng số của
 * trụ cột họ không hề "được" tối ưu cũng bị thay đổi — khó hiểu và khó tin.
 */
function normalizeToTotal(
  proposed: Record<string, number>,
  original: Record<string, number>,
  adjustableNames: string[]
): Record<string, number> {
  const out: Record<string, number> = { ...original };

  if (adjustableNames.length < 2) return out;

  const targetTotal = adjustableNames.reduce((a, n) => a + original[n], 0);
  const proposedTotal = adjustableNames.reduce((a, n) => a + proposed[n], 0);
  if (proposedTotal <= 0 || targetTotal <= 0) return out;

  const scaled = adjustableNames.map((name) => {
    const exact = (proposed[name] / proposedTotal) * targetTotal;
    const floor = Math.floor(exact);
    return { name, floor, remainder: exact - floor };
  });

  let remaining = targetTotal - scaled.reduce((a, s) => a + s.floor, 0);
  // Chia phần dư cho những trụ cột bị cắt nhiều nhất khi làm tròn
  const order = [...scaled].sort((a, b) => b.remainder - a.remainder);
  for (const item of order) {
    if (remaining <= 0) break;
    item.floor += 1;
    remaining -= 1;
  }

  for (const s of scaled) out[s.name] = Math.max(s.floor, 1);
  return out;
}

// ============================================================
// Đề xuất 2: band giờ ưu tiên
// ============================================================

/**
 * Tỉ lệ bài tối đa được dồn vào band giờ tốt nhất. Cố ý chỉ 50%: giờ đăng của
 * một Page thay đổi theo mùa và theo lịch sinh hoạt, nên phải luôn giữ một nửa
 * số bài ở các khung khác để còn phát hiện khi band tốt nhất hết tốt.
 */
export const TIME_BIAS_SHARE = 0.5;

export type TimeBias = {
  /** Phút tính từ 00:00 (giờ Việt Nam) — đã cắt theo khung giờ người dùng đặt. */
  startMin: number;
  endMin: number;
  band: TimeBand;
  share: number;
  reason: string;
};

export type TimeBiasSuggestion = {
  bias: TimeBias | null;
  reason: string;
};

/**
 * Đề xuất dồn một phần bài vào band giờ hiệu quả nhất.
 *
 * Bốn cổng phải qua, thiếu một cổng là bỏ (trả `bias: null`):
 *   1. Đủ tin cậy tổng thể (MEDIUM trở lên) — dưới ngưỡng thì "band tốt nhất"
 *      chỉ là ngẫu nhiên.
 *   2. Band đó có đủ mẫu.
 *   3. Band giao với khung giờ người dùng đặt — KHÔNG BAO GIỜ đăng ngoài khung
 *      người dùng chọn, kể cả vì số liệu.
 *   4. Phần giao đủ rộng để chứa ít nhất một khoảng cách tối thiểu giữa 2 bài.
 */
export function suggestTimeBias(
  report: PerformanceReport,
  config: { windowStart: string; windowEnd: string; minGapMinutes: number },
  parseHm: (value: string) => number | null
): TimeBiasSuggestion {
  const none = (reason: string): TimeBiasSuggestion => ({ bias: null, reason });

  if (report.confidence === "NONE" || report.confidence === "LOW") {
    return none("Chưa đủ số liệu để kết luận khung giờ nào tốt hơn.");
  }

  const eligible = report.byBand.filter(
    (b) => b.posts >= MIN_SAMPLES_FOR_TIME_BIAS && TIME_BANDS.includes(b.key as TimeBand)
  );
  if (eligible.length === 0) {
    return none(
      `Chưa có khung giờ nào đạt ${MIN_SAMPLES_FOR_TIME_BIAS} bài để so sánh công bằng.`
    );
  }

  const best = [...eligible].sort((a, b) => b.avgScore - a.avgScore)[0];
  // Band tốt nhất phải thực sự tốt hơn mức trung bình, nếu không giữ nguyên
  if (best.z <= 0.2) {
    return none("Các khung giờ đang cho hiệu quả tương đương nhau — chưa cần dồn bài.");
  }

  const band = best.key as TimeBand;
  const range = TIME_BAND_RANGES[band];

  const startMin = parseHm(config.windowStart);
  const endMin = parseHm(config.windowEnd);
  if (startMin === null || endMin === null || endMin <= startMin) {
    return none("Khung giờ đăng của bạn không hợp lệ nên không dồn bài theo khung giờ được.");
  }

  // Giao giữa band tốt nhất và khung giờ người dùng đặt
  const from = Math.max(range.startMin, startMin);
  const to = Math.min(range.endMin, endMin);

  const gap = Math.max(config.minGapMinutes || 0, 30);
  if (to - from < gap) {
    return none(
      `Khung giờ ${TIME_BAND_LABELS[band]} của bạn quá hẹp so với giãn cách tối thiểu ${gap} phút nên không dồn bài được.`
    );
  }

  return {
    bias: {
      startMin: from,
      endMin: to,
      band,
      share: TIME_BIAS_SHARE,
      reason: `${TIME_BAND_LABELS[band]} đang cho hiệu quả cao hơn ${Math.round(
        best.z * 10
      ) / 10} độ lệch so với trung vị — dồn ${Math.round(TIME_BIAS_SHARE * 100)}% số bài vào khung này.`,
    },
    reason: "",
  };
}

// ============================================================
// Đề xuất 3: kiểu mở bài
// ============================================================

export type HookSuggestion = { style: HookStyle | null; reason: string };

/**
 * Kiểu mở bài hiệu quả nhất — chỉ dùng để GỢI Ý trong prompt, không ép buộc.
 * Khác trọng số trụ cột (đổi phân bổ thật), đây chỉ là một dòng chỉ dẫn văn
 * phong nên rủi ro thấp hơn; vẫn phải qua cổng mẫu tối thiểu.
 */
export function suggestHookStyle(report: PerformanceReport): HookSuggestion {
  if (report.confidence === "NONE") {
    return { style: null, reason: "Chưa có bài nào đủ chín để đánh giá kiểu mở bài." };
  }

  const eligible = report.byHookStyle.filter(
    (h) => h.posts >= MIN_SAMPLES_PER_DIRECTION && HOOK_STYLES.includes(h.key as HookStyle)
  );
  if (eligible.length < 2) {
    return {
      style: null,
      reason: `Cần ít nhất 2 kiểu mở bài có từ ${MIN_SAMPLES_PER_DIRECTION} bài mới so sánh được.`,
    };
  }

  const best = [...eligible].sort((a, b) => b.avgScore - a.avgScore)[0];
  if (best.z <= 0.2) {
    return {
      style: null,
      reason: "Các kiểu mở bài đang cho hiệu quả tương đương nhau.",
    };
  }

  return {
    style: best.key as HookStyle,
    reason: `Kiểu "${HOOK_STYLE_LABELS[best.key as HookStyle]}" (${best.posts} bài) đang hiệu quả cao hơn trung vị.`,
  };
}

// ============================================================
// Dòng số liệu đưa vào prompt AI
// ============================================================

/** Câu chỉ thị an toàn, LẶP LẠI ở mọi khối số liệu đưa cho AI. */
export {
  PERFORMANCE_SAFETY_CLAUSE,
  type BrandContext,
} from "./ai-prompts.ts";

/**
 * Dựng các dòng mô tả số liệu để chèn vào prompt.
 *
 * Chỉ mô tả HƯỚNG và MỨC TƯƠNG QUAN, không đưa con số tuyệt đối của Facebook:
 * đưa số tuyệt đối vào dễ khiến model nhắc lại chúng trong bài đăng.
 */
export function buildInsightLines(report: PerformanceReport): string[] {
  if (report.sampleSize === 0) return [];

  const lines: string[] = [];
  const reachNote = report.reachAvailable
    ? "Xếp hạng dựa trên cả lượt xem/tiếp cận và tương tác."
    : "Token chưa có quyền xem lượt hiển thị nên xếp hạng CHỈ dựa trên tương tác (cảm xúc, bình luận, chia sẻ).";
  lines.push(`- Quy mô dữ liệu: ${report.sampleSize} bài AutoPilot đã đăng. ${reachNote}`);

  const strong = report.byPillar.filter((g) => g.z >= 0.4).slice(0, 2);
  const weak = report.byPillar.filter((g) => g.z <= -0.4).slice(-2);

  if (strong.length > 0) {
    lines.push(
      `- Trụ cột đang được người xem đáp lại tốt: ${strong
        .map((g) => `"${g.key}" (${g.posts} bài)`)
        .join(", ")}.`
    );
  }
  if (weak.length > 0) {
    lines.push(
      `- Trụ cột đang kém hiệu quả hơn: ${weak
        .map((g) => `"${g.key}" (${g.posts} bài)`)
        .join(", ")} — nên viết khác đi, đổi góc hoặc cách dẫn dắt.`
    );
  }

  const hooks = report.byHookStyle.filter((g) => g.z >= 0.3).slice(0, 2);
  if (hooks.length > 0) {
    lines.push(
      `- Kiểu mở bài hiệu quả: ${hooks
        .map((g) => HOOK_STYLE_LABELS[g.key as HookStyle] ?? g.key)
        .join(", ")}.`
    );
  }

  const bands = report.byBand.filter((g) => g.z >= 0.3).slice(0, 2);
  if (bands.length > 0) {
    lines.push(
      `- Khung giờ đang đông người xem: ${bands
        .map((g) => TIME_BAND_LABELS[g.key as TimeBand] ?? g.key)
        .join(", ")}.`
    );
  }

  const media = report.byMediaKind.filter((g) => g.posts >= 3 && g.z >= 0.4);
  if (media.length > 0) {
    lines.push(`- Loại nội dung hiệu quả hơn: ${labelOf("media", media[0].key)}.`);
  }

  if (report.trend7d && report.trend7d.changePct <= -15) {
    lines.push(
      `- CẢNH BÁO: hiệu quả 7 ngày gần đây đang giảm ${Math.abs(
        Math.round(report.trend7d.changePct)
      )}% so với 7 ngày trước. Cần đổi góc tiếp cận rõ rệt hơn, tránh lặp lại cách viết cũ.`
    );
  }

  return lines;
}

/** Nhãn tiếng Việt + khoá nhóm, dùng chung cho UI và hàm nhận xét. */
export const GROUP_LABELS: Record<GroupKey, string> = {
  pillar: "Trụ cột nội dung",
  band: "Khung giờ đăng",
  hook: "Kiểu mở bài",
  media: "Loại nội dung",
  area: "Địa bàn",
};

export { labelOf, mediaKindOf };
