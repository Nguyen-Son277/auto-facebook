// ============================================================
// LÕI XỬ LÝ SỐ LIỆU FACEBOOK INSIGHTS — logic THUẦN.
//
// Tách khỏi fb-insights.ts (file đó có "server-only" + gọi mạng) để kiểm thử
// độc lập bằng Node: xem scripts/test-insights.mjs. Cùng lý do với việc tách
// autopilot-plan.ts khỏi autopilot.ts — đây là phần dễ sai nhất của tính năng
// và sai ở đây thì bộ lập kế hoạch sẽ chọn sai hướng cho cả Page.
//
// BA NHÓM VIỆC Ở ĐÂY
//   1. Đọc payload Graph API (chịu được nhiều hình dạng response).
//   2. Phân loại lỗi để biết đường lùi mà không làm hỏng lượt lập kế hoạch.
//   3. Quy đổi thô: điểm hiệu quả, band giờ, kiểu mở bài.
// ============================================================

/**
 * Nhóm metric của MỘT BÀI, xếp theo mức quan trọng.
 *
 * Vì sao chia nhóm: Facebook trả lỗi `3001 / 1504028` ("invalid metric") cho
 * TOÀN BỘ lệnh gọi nếu chỉ một metric trong danh sách đã bị ngừng hỗ trợ. Nhờ
 * chia nhóm, khi nhóm `distribution` lỗi ta vẫn xin được `video`/`click` và
 * ngược lại — mất ít dữ liệu nhất có thể.
 *
 * LƯU Ý DEPRECATION: các metric `*_unique` kiểu cũ
 * (post_impressions_unique, post_video_views_unique...) đã bị Meta ngừng hỗ trợ
 * cho MỌI phiên bản API từ 15/06/2026. Danh sách dưới đây dùng metric thay thế
 * (`post_media_view`, `post_total_media_view_unique`) và chỉ giữ
 * `post_impressions` (tổng) vì nó chưa bị ảnh hưởng. Meta đổi tiếp thì SỬA
 * DUY NHẤT Ở ĐÂY.
 */
export type InsightMetricGroup = {
  /** Tên nhóm — dùng để gọi lại riêng nhóm bị lỗi. */
  key: string;
  metrics: string[];
};

export const INSIGHT_METRIC_GROUPS: InsightMetricGroup[] = [
  {
    key: "distribution",
    metrics: ["post_media_view", "post_total_media_view_unique", "post_impressions"],
  },
  { key: "video", metrics: ["post_video_views", "post_video_avg_time_watched"] },
  { key: "click", metrics: ["post_clicks"] },
  { key: "reaction", metrics: ["post_reactions_by_type_total"] },
];

/**
 * Metric tối thiểu còn dùng được khi cả nhóm `distribution` bị từ chối.
 * Chỉ một metric để giảm khả năng bị "invalid metric" lần nữa.
 */
export const MINIMAL_DISTRIBUTION_METRIC = "post_media_view";

/** Nhóm metric cấp PAGE (khác cấp bài). */
export const PAGE_METRIC_GROUPS: InsightMetricGroup[] = [
  {
    key: "page",
    metrics: [
      "page_impressions",
      "page_media_view",
      "page_total_media_view_unique",
      "page_post_engagements",
      "page_views_total",
      "page_fans",
      "page_follows",
      "page_fans_city",
    ],
  },
];

export const ALL_POST_METRICS: string[] = INSIGHT_METRIC_GROUPS.flatMap((g) => g.metrics);
export const ALL_PAGE_METRICS: string[] = PAGE_METRIC_GROUPS.flatMap((g) => g.metrics);

// ============================================================
// Ngưỡng nghiệp vụ
// ============================================================

/**
 * Số bài AutoPilot đã ĐĂNG tối thiểu để chuyển từ "đang dò" sang "đang khai
 * thác". Dưới ngưỡng này thì mọi kết luận đều là nhiễu: 3 bài may mắn không
 * chứng minh được hướng nào tốt.
 */
export const MIN_SAMPLES_FOR_EXPLOIT = 8;
/** Số mẫu tối thiểu để một hướng cụ thể được coi là có tín hiệu. */
export const MIN_SAMPLES_PER_DIRECTION = 3;
/** Một hướng cần ngần này mẫu mới đủ tin cậy để đổi band giờ. */
export const MIN_SAMPLES_FOR_TIME_BIAS = 5;
/** Ngưỡng tổng số mẫu cho từng mức tin cậy. */
export const CONFIDENCE_THRESHOLDS = { low: 8, medium: 20, high: 50 } as const;

/** Ngân sách tối đa cho MỘT đợt dò (tránh dò vô hạn khi Page ít người xem). */
export const PROBE_MAX_POSTS = 12;
/** Số ngày tối thiểu giữa hai lần "kiểm tra lại" để chống rung (flapping). */
export const REPROBE_COOLDOWN_DAYS = 14;
/** Cửa sổ đánh giá hiệu quả (ngày). */
export const PERFORMANCE_WINDOW_DAYS = 90;
/** Cửa sổ so sánh gần đây (ngày) — dùng cho trend 7 ngày. */
export const RECENT_WINDOW_DAYS = 7;
/** Kết luận/nhận xét lưu cache quá ngần này thì coi là cũ, tính lại. */
export const LEARNING_SUMMARY_TTL_HOURS = 24;
/** Số liệu cấp bài của Facebook cập nhật ~24h/lần; làm mới dày hơn là vô ích. */
export const INSIGHTS_STALE_HOURS = 18;

// ============================================================
// 1. Đọc payload Graph API
// ============================================================

/** Giá trị một metric: số, hoặc object tra cứu (page_fans_city, reactions...). */
export type MetricValue = number | Record<string, number>;
export type ParsedMetrics = {
  values: Record<string, MetricValue>;
  /** Metric xin nhưng Facebook không trả về — giao diện sẽ nói rõ thiếu gì. */
  missing: string[];
};

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * Đọc khối `insights.data[]` của Graph API.
 *
 * Chịu được các biến thể thật gặp phải:
 *   - `values[].value` là SỐ (metric đếm) hoặc OBJECT (metric chia nhỏ như
 *     `page_fans_city`, `post_reactions_by_type_total`).
 *   - `values` có nhiều mốc thời gian (period day/week) → lấy mốc CUỐI CÙNG,
 *     vì đó là số liệu mới nhất.
 *   - Metric xin nhưng không có trong response → ghi vào `missing` chứ không
 *     ném lỗi: thiếu một metric không được làm hỏng cả lượt thu thập.
 */
export function parseInsightPayload(raw: unknown, metricNames: string[]): ParsedMetrics {
  const values: Record<string, MetricValue> = {};
  const root = asRecord(raw);
  const data = root?.data;

  if (Array.isArray(data)) {
    for (const item of data) {
      const row = asRecord(item);
      if (!row) continue;
      const name = typeof row.name === "string" ? row.name : "";
      if (!name) continue;

      const points = Array.isArray(row.values) ? row.values : [];
      // Lấy mốc cuối cùng có giá trị — số liệu mới nhất của metric đó.
      let picked: MetricValue | undefined;
      for (const point of points) {
        const p = asRecord(point);
        const value = p?.value;
        if (typeof value === "number" && Number.isFinite(value)) {
          picked = value;
        } else {
          const record = asRecord(value);
          if (record) {
            const numeric: Record<string, number> = {};
            for (const [k, v] of Object.entries(record)) {
              if (typeof v === "number" && Number.isFinite(v)) numeric[k] = v;
            }
            if (Object.keys(numeric).length > 0) picked = numeric;
          }
        }
      }

      if (picked !== undefined) values[name] = picked;
    }
  }

  const missing = metricNames.filter((m) => values[m] === undefined);
  return { values, missing };
}

/** Lấy một metric dạng số. Metric chia nhỏ (object) bị coi là không có. */
export function numericMetric(
  values: Record<string, MetricValue>,
  key: string
): number | null {
  const v = values[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Cộng mọi giá trị của một metric chia nhỏ (ví dụ tổng các loại cảm xúc). */
export function sumNumericRecord(value: MetricValue | undefined): number | null {
  const record = asRecord(value);
  if (!record) return null;
  let total = 0;
  let seen = false;
  for (const v of Object.values(record)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      total += v;
      seen = true;
    }
  }
  return seen ? total : null;
}

// ============================================================
// 2. Tương tác từ danh sách bài (không cần read_insights)
// ============================================================

export type PostInteraction = {
  reactions: number;
  comments: number;
  shares: number;
  /** created_time của Facebook (ISO) — dùng đối chiếu khi cần. */
  createdTime: string | null;
};

const SUMMARY_TOTAL = (holder: unknown): number => {
  const rec = asRecord(holder);
  const summary = asRecord(rec?.summary);
  const total = summary?.total_count;
  return typeof total === "number" && Number.isFinite(total) ? total : 0;
};

/**
 * Đọc `GET /{page-id}/posts` để lấy cảm xúc / bình luận / chia sẻ của từng bài.
 *
 * Vì sao cần riêng hàm này: đây là nhóm số liệu DUY NHẤT lấy được mà không cần
 * quyền `read_insights`, nhờ vậy tính năng vẫn hoạt động (kém chính xác hơn)
 * với app chưa được duyệt quyền đó.
 *
 * `shares` là object `{ count }` chứ không phải `summary` như hai trường kia —
 * đây là điểm dễ đọc sai nhất của payload này.
 */
export function parseInteractionSummary(raw: unknown): Map<string, PostInteraction> {
  const out = new Map<string, PostInteraction>();
  const root = asRecord(raw);
  const data = Array.isArray(root?.data) ? (root!.data as unknown[]) : [];

  for (const item of data) {
    const row = asRecord(item);
    if (!row) continue;
    const id = typeof row.id === "string" ? row.id : "";
    if (!id) continue;

    const sharesRec = asRecord(row.shares);
    const sharesRaw = sharesRec?.count;

    out.set(id, {
      reactions: SUMMARY_TOTAL(row.reactions),
      comments: SUMMARY_TOTAL(row.comments),
      shares:
        typeof sharesRaw === "number" && Number.isFinite(sharesRaw) ? sharesRaw : 0,
      createdTime: typeof row.created_time === "string" ? row.created_time : null,
    });
  }

  return out;
}

// ============================================================
// 3. Phân loại lỗi Graph API
//
// Mỗi loại lỗi có cách lùi KHÁC NHAU, nên phải phân biệt được:
//   - invalid metric  → xin lại nhóm nhỏ hơn (metric đã bị Meta bỏ)
//   - 100 likes       → chờ Page lớn hơn, thử lại dày vô ích
//   - token hỏng      → báo người dùng đồng bộ lại, lùi 7 ngày
//   - object không có → bài đã bị xoá, lùi 7 ngày
// ============================================================

type ErrorParts = { code?: number; subcode?: number; message: string };

/**
 * Trích mã lỗi/thông điệp từ nhiều hình dạng "lỗi" khác nhau.
 *
 * Chấp nhận cả FacebookApiError (có `.code`), lỗi thường và object thuần
 * `{ code, message }` — vì hàm này còn được dùng ở tầng thuần, nơi không được
 * import lớp lỗi của tầng mạng.
 */
export function errorPartsOf(err: unknown): ErrorParts {
  if (typeof err === "string") return { message: err };

  const top = asRecord(err);
  if (top) {
    const nested = asRecord(top.error);
    const source = nested ?? top;
    const code = source.code;
    const subcode = source.error_subcode;
    const message = source.message;
    const base = err instanceof Error ? err.message : "";
    return {
      code: typeof code === "number" ? code : undefined,
      subcode: typeof subcode === "number" ? subcode : undefined,
      message: typeof message === "string" ? message : base,
    };
  }

  if (err instanceof Error) return { message: err.message };
  return { message: "" };
}

/** Facebook từ chối metric (đã bị ngừng hỗ trợ hoặc không hợp lệ). */
export function isInvalidMetricError(err: unknown): boolean {
  const { code, subcode, message } = errorPartsOf(err);
  if (code === 3001) return true;
  if (subcode === 1504028) return true;
  return /invalid metric|no metric was specified|không hợp lệ/i.test(message);
}

/** Page chưa đủ 100 lượt thích nên Facebook không có số liệu Insights. */
export function isLowFansError(err: unknown): boolean {
  const { message } = errorPartsOf(err);
  return /100 (or more )?likes|insights data is only available/i.test(message);
}

/** Token hết hạn / bị thu hồi. */
export function isTokenInvalidError(err: unknown): boolean {
  const { code, message } = errorPartsOf(err);
  if (code === 190) return true;
  return /access token|session has expired|oauth/i.test(message);
}

/** Bài/Page không còn tồn tại hoặc không có quyền xem. */
export function isNotFoundError(err: unknown): boolean {
  const { code, message } = errorPartsOf(err);
  if (code !== 100) return false;
  return /does not exist|unsupported|unknown path|cannot be loaded/i.test(message);
}

// ============================================================
// 4. Nhịp làm mới số liệu
// ============================================================

export type InsightStatus =
  | "UNKNOWN"
  | "OK"
  | "PARTIAL"
  | "FRESH"
  | "NO_PERMISSION"
  | "LOW_FANS"
  | "TOKEN_INVALID"
  | "ERROR";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Nhịp làm mới theo trạng thái. Khác nhau vì hậu quả khác nhau:
 *   - Số liệu bình thường: Facebook cập nhật ~24h/lần → 18h là đủ, gọi dày hơn
 *     chỉ tốn quota mà không có số mới.
 *   - Bài còn "nóng" (dưới 24h): số liệu đang tăng, cần xem lại sớm hơn.
 *   - Lỗi quyền / ít người thích / token hỏng: nguyên nhân không tự khỏi trong
 *     ngày → lùi hẳn 7 ngày để không đập vào tường.
 */
export function insightRetryMs(status: string): number {
  switch (status) {
    case "OK":
    case "PARTIAL":
      return INSIGHTS_STALE_HOURS * HOUR_MS;
    case "FRESH":
      return 6 * HOUR_MS;
    case "ERROR":
      return 6 * HOUR_MS;
    case "NO_PERMISSION":
    case "LOW_FANS":
    case "TOKEN_INVALID":
      return 7 * DAY_MS;
    case "UNKNOWN":
    default:
      return 0; // chưa từng lấy → lấy ngay
  }
}

/**
 * Số liệu đã cũ chưa, và còn bao lâu mới nên thử lại.
 *
 * Hàm thuần + tất định (nhận `now` từ ngoài) để kiểm thử được và để nhiều lượt
 * chạy trong cùng mili giây cho cùng kết quả.
 */
export function insightFreshness(
  status: string,
  fetchedAt: Date | null | undefined,
  now: Date
): { stale: boolean; retryAfterMs: number } {
  const retryAfterMs = insightRetryMs(status);

  if (!fetchedAt) return { stale: true, retryAfterMs: 0 };

  const age = now.getTime() - fetchedAt.getTime();
  // `age` âm (đồng hồ máy chạy lệch) → coi như vừa lấy, tránh gọi liên tục.
  if (age < 0) return { stale: false, retryAfterMs: Math.max(retryAfterMs - 0, 0) };

  const stale = age >= retryAfterMs;
  return { stale, retryAfterMs: Math.max(retryAfterMs - age, 0) };
}

/** Bài đã đủ "chín" để số liệu ổn định chưa (Facebook chốt sau ~24h). */
export function isMatureForLearning(publishedAt: Date | null, now: Date): boolean {
  if (!publishedAt) return false;
  return now.getTime() - publishedAt.getTime() >= 24 * HOUR_MS;
}

// ============================================================
// 5. Điểm hiệu quả
// ============================================================

export type PostScoreInput = {
  reactions: number;
  comments: number;
  shares: number;
  mediaView?: number | null;
  impressions?: number | null;
  videoViews?: number | null;
};

/**
 * Điểm "được người xem đáp lại" của một bài.
 *
 * Trọng số phản ánh CÔNG SỨC người xem bỏ ra, không phải mức độ Facebook ưa:
 *   - cảm xúc là hành động rẻ nhất → 1 điểm
 *   - bình luận tốn công hơn (phải viết) → 3 điểm
 *   - chia sẻ là hành động mạnh nhất (đưa nội dung tới người khác) → 5 điểm
 *
 * Cố ý KHÔNG dùng số người tiếp cận ở đây: reach phụ thuộc quảng cáo và lượt
 * chia sẻ, nên trộn vào sẽ khiến bài "được đẩy" trông hay hơn bài "được thích".
 * Reach được dùng riêng ở `distributionValue`.
 */
export function engagementOf(input: {
  reactions: number;
  comments: number;
  shares: number;
}): number {
  return input.reactions + 3 * input.comments + 5 * input.shares;
}

/**
 * Giá trị "phân phối" của bài: càng cao nghĩa là Facebook càng đẩy bài đó ra
 * nhiều người. Ưu tiên metric mới, lùi dần về metric cũ khi thiếu quyền.
 */
export function distributionValueOf(input: {
  mediaView?: number | null;
  impressions?: number | null;
  videoViews?: number | null;
}): number | null {
  const candidates = [input.mediaView, input.impressions, input.videoViews];
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) return c;
  }
  return null;
}

/**
 * Điểm chuẩn hoá (robust z-score) so với trung vị của chính Page.
 *
 * Dùng MEDIAN + MAD thay cho trung bình + độ lệch chuẩn vì số liệu mạng xã hội
 * có đuôi rất dài: một bài viral sẽ kéo trung bình lệch hẳn, khiến mọi bài còn
 * lại trông như "tệ". Median/MAD chống được outlier đó.
 *
 * `scale` do người gọi truyền vào — xem `dispersionOf`. Cố ý không tự tính
 * trong hàm này để tầng phân tích quyết định được cách xử lý khi MAD = 0.
 */
export function robustZ(score: number, median: number, scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 0;
  const z = (score - median) / scale;
  // Chặn biên: một bài viral cực đoan không nên cho z vô cực
  return Math.max(-4, Math.min(4, z));
}

/**
 * Độ tán xạ dùng để chuẩn hoá điểm — có đường lùi khi MAD bằng 0.
 *
 * VÌ SAO CẦN ĐƯỜNG LÙI (lỗi thật đã gặp):
 * MAD = 0 khi có HƠN MỘT NỬA số bài cùng một điểm. Trên thực tế điều này rất
 * phổ biến: Page mới thường có nhiều bài 0 cảm xúc, 0 bình luận → trung vị = 0
 * và MAD = 0. Nếu cứ chia cho 1.4826 × 0 thì mọi z-score thành 0, nghĩa là
 * KHÔNG hướng nào được nhận ra là tốt hay kém — tính năng tối ưu sẽ im lặng
 * không làm gì cả mà không báo lỗi. Đúng kiểu hỏng khó phát hiện nhất.
 *
 * Thứ tự lùi:
 *   1. 1.4826 × MAD (robust, chống outlier) — dùng khi > 0.
 *   2. Độ lệch chuẩn — vẫn đo được mức tán xạ khi MAD = 0.
 *   3. max(trung vị, 1) — "so tương đối với chính mức trung vị" khi mọi bài
 *      giống hệt nhau. Không còn cách nào đo tán xạ thì ít nhất vẫn phân biệt
 *      được bài vượt trội so với nền chung.
 */
export function dispersionOf(values: number[], median: number, mad: number): number {
  const robust = 1.4826 * mad;
  if (Number.isFinite(robust) && robust > 0) return robust;

  const std = stdDevOf(values);
  if (Number.isFinite(std) && std > 0) return std;

  return Math.max(Math.abs(median), 1);
}

/** Độ lệch chuẩn (mẫu). 0 khi mảng rỗng hoặc chỉ có một phần tử. */
export function stdDevOf(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / values.length;
  return Math.sqrt(variance);
}

/** Trung vị của một dãy (không sửa mảng đầu vào). */
export function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Độ lệch tuyệt đối trung vị (MAD). */
export function madOf(values: number[], median: number): number {
  if (values.length === 0) return 0;
  return medianOf(values.map((v) => Math.abs(v - median)));
}

/** Trung bình cộng; 0 khi mảng rỗng (tránh NaN lan ra giao diện). */
export function averageOf(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// ============================================================
// 6. Quy đổi đặc trưng của bài
// ============================================================

export const TIME_BANDS = ["SANG", "TRUA", "CHIEU", "TOI"] as const;
export type TimeBand = (typeof TIME_BANDS)[number];

export const TIME_BAND_RANGES: Record<TimeBand, { startMin: number; endMin: number }> = {
  SANG: { startMin: 6 * 60, endMin: 11 * 60 },
  TRUA: { startMin: 11 * 60, endMin: 14 * 60 },
  CHIEU: { startMin: 14 * 60, endMin: 18 * 60 },
  TOI: { startMin: 18 * 60, endMin: 22 * 60 },
};

export const TIME_BAND_LABELS: Record<TimeBand, string> = {
  SANG: "Sáng 6–11h",
  TRUA: "Trưa 11–14h",
  CHIEU: "Chiều 14–18h",
  TOI: "Tối 18–22h",
};

/**
 * Xếp giờ (theo giờ Việt Nam) vào một trong 4 band.
 *
 * Hàm này PHẢI toàn ánh (mọi giờ đều ra một band) — nếu trả null cho giờ ngoài
 * 6–22h thì thống kê sẽ lặng lẽ bỏ sót bài đăng ngoài khung, và tổng số bài
 * theo band không còn khớp tổng số bài thật.
 */
export function bandOfHour(hourVn: number): TimeBand {
  if (hourVn < 11) return "SANG";
  if (hourVn < 14) return "TRUA";
  if (hourVn < 18) return "CHIEU";
  return "TOI";
}

/** Band chứa một instant, tính theo lịch Việt Nam (UTC+7). */
export function bandOfDate(date: Date): TimeBand {
  // +7h rồi đọc giờ UTC — không dùng getHours() vì nó phụ thuộc múi giờ máy chạy
  const vn = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return bandOfHour(vn.getUTCHours());
}

export const HOOK_STYLES = ["CauHoi", "ConSo", "DanhSach", "KeChuyen"] as const;
export type HookStyle = (typeof HOOK_STYLES)[number];

export const HOOK_STYLE_LABELS: Record<HookStyle, string> = {
  CauHoi: "Đặt câu hỏi",
  ConSo: "Nêu con số",
  DanhSach: "Liệt kê gạch đầu dòng",
  KeChuyen: "Kể chuyện",
};

/**
 * Câu chỉ thị văn phong cho từng kiểu mở bài.
 *
 * Dùng khi DÒ: nói cho AI biết mở bài theo kiểu nào, để so sánh được các kiểu
 * với nhau. Đây là chỉ thị về CÁCH VIẾT, không phải chủ đề mới — nhờ vậy việc
 * dò không kéo nội dung ra ngoài hồ sơ thương hiệu.
 *
 * Kiểu "ConSo" đặc biệt phải kèm ràng buộc không bịa số, nếu không AI sẽ tự
 * nghĩ ra "giảm 90% tiền điện" — đúng lỗi mà prompt gốc đang chặn.
 */
export const HOOK_STYLE_INSTRUCTIONS: Record<HookStyle, string> = {
  CauHoi: "Mở bài bằng MỘT câu hỏi trực tiếp hướng tới khách hàng.",
  ConSo:
    "Mở bài bằng một con số hoặc mức độ cụ thể, nhưng CHỈ được dùng con số có trong hồ sơ thương hiệu — tuyệt đối không tự nghĩ ra số liệu.",
  DanhSach:
    "Mở bài bằng ý chính ngắn, sau đó liệt kê 3–5 gạch đầu dòng (mỗi dòng một ý).",
  KeChuyen:
    "Mở bài bằng một tình huống hoặc khoảnh khắc ngắn, dẫn dắt tự nhiên vào nội dung.",
};

const BULLET_RE = /^\s*(?:[•\-*–—]|\p{Extended_Pictographic})/u;

/**
 * Đoán kiểu mở bài từ câu đầu (hook).
 *
 * Chỉ là heuristic trên DÒNG ĐẦU, không phân tích cả bài: dòng đầu là thứ
 * Facebook hiện trước nút "Xem thêm", nên nó mới là thứ quyết định người xem
 * có bấm vào hay không — và cũng là thứ ta muốn so sánh giữa các bài.
 *
 * Thứ tự kiểm tra quan trọng: dấu hỏi được xét trước dấu hiệu số, vì
 * "Bạn có biết 90% khách hàng..." vừa có hỏi vừa có số nhưng bản chất là câu hỏi.
 */
export function hookStyleOf(text: string | null | undefined): HookStyle {
  const first = (text ?? "").split("\n")[0]?.trim() ?? "";
  if (!first) return "KeChuyen";

  if (first.includes("?") || /\b(bạn|có phải|tại sao|vì sao|làm sao|khi nào|bao giờ)\b/i.test(first)) {
    return "CauHoi";
  }
  if (BULLET_RE.test(first)) return "DanhSach";
  if (/\d/.test(first) || /%/.test(first)) return "ConSo";
  return "KeChuyen";
}

/** Loại media của bài, suy từ danh sách loại media đã gắn. */
export function mediaKindOf(types: string[]): "IMAGE" | "VIDEO" {
  return types.some((t) => t === "VIDEO") ? "VIDEO" : "IMAGE";
}

/**
 * Tỉ lệ người xem đáp lại = điểm tương tác / số người tiếp cận.
 *
 * Trả null khi không có số người tiếp cận — giao diện hiện "—" thay vì 0, vì 0
 * trông như "bài không ai tương tác" trong khi thực tế là "chưa có dữ liệu".
 */
export function interactionRateOf(input: {
  reactions: number;
  comments: number;
  shares: number;
  distributionValue?: number | null;
}): number | null {
  const dist = input.distributionValue;
  if (typeof dist !== "number" || !Number.isFinite(dist) || dist <= 0) return null;
  return engagementOf(input) / dist;
}
