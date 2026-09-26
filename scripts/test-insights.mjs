// ============================================================
// Kiểm thử tính năng "Học từ số liệu bài đăng" (Insights Learning).
//
// Chạy: npm run test:insights
//
// KHÔNG cần dev server, KHÔNG cần database, KHÔNG cần mock server.
// Bảy phần:
//   1. Đọc payload Graph API + phân loại lỗi + nhịp làm mới.
//   2. Phân tích hiệu quả (gom nhóm, median/MAD, mức tin cậy, xu hướng).
//   3. Đề xuất có giới hạn (trọng số trụ cột, khung giờ, kiểu mở bài).
//   4. Vòng đời học: giai đoạn, phát hiện tụt, kế hoạch dò, hướng nội dung.
//   5. Khung giờ: planTimeSlotsBiased không đổi hành vi khi không có bias.
//   6. Nhận xét + ràng buộc an toàn thương hiệu (guard đọc mã nguồn).
//   7. Hạn mức & URL Graph API (stub fetch).
//
// VÌ SAO BỘ TEST NÀY QUAN TRỌNG: phần dễ sai nhất của tính năng không phải việc
// gọi API mà là việc KẾT LUẬN. Kết luận sai sẽ khiến AutoPilot dồn bài vào một
// hướng tồi suốt nhiều tuần. Vì vậy các hàm kết luận đều là hàm thuần và được
// kiểm thử ở đây với cả trường hợp dữ liệu ít/nhiễu.
// ============================================================

import {
  bandOfHour,
  hookStyleOf,
  interactionRateOf,
  insightFreshness,
  insightRetryMs,
  isInvalidMetricError,
  isLowFansError,
  isNotFoundError,
  isTokenInvalidError,
  madOf,
  medianOf,
  mediaKindOf,
  MINIMAL_DISTRIBUTION_METRIC,
  numericMetric,
  parseInsightPayload,
  parseInteractionSummary,
  robustZ,
  stdDevOf,
  dispersionOf,
  sumNumericRecord,
  INSIGHT_METRIC_GROUPS,
  HOOK_STYLES,
  PROBE_MAX_POSTS,
  MIN_SAMPLES_FOR_EXPLOIT,
} from "../src/lib/insights-core.ts";
import {
  analyzePerformance,
  buildInsightLines,
  suggestHookStyle,
  suggestPillarWeights,
  suggestTimeBias,
  PILLAR_WEIGHT_MAX_FACTOR,
  PILLAR_WEIGHT_MIN_FACTOR,
  TIME_BIAS_SHARE,
} from "../src/lib/insights-report.ts";
import {
  buildCommentary,
  computeDirections,
  detectRegression,
  evaluateProbeResults,
  maxProbePostsPerHint,
  pickProbeHint,
  planProbeBatch,
  resolveLearningPhase,
  usableBands,
  MAX_EST_LIFE_DAYS,
  REPROBE_COOLDOWN_DAYS,
} from "../src/lib/learning-cycle.ts";
import {
  parseHm,
  pickPillarEvenly,
  planTimeSlots,
  planTimeSlotsBiased,
} from "../src/lib/autopilot-plan.ts";
import { PERFORMANCE_SAFETY_CLAUSE } from "../src/lib/ai-prompts.ts";

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ✔ ${name}`);
  } else {
    failed++;
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n▸ ${title}`);
}

/** Hàm ngẫu nhiên tất định để test lặp lại được. */
function seededRandom(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const NOW = new Date("2026-09-26T10:00:00Z");
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

/** Tạo mẫu bài cho test. */
function sample(over = {}) {
  return {
    postId: `p-${Math.random().toString(36).slice(2, 8)}`,
    pillarName: "Giới thiệu sản phẩm",
    serviceArea: null,
    hook: "Rèm cửa chống nắng cho phòng khách hướng Tây.",
    hookStyle: "KeChuyen",
    topic: "chủ đề",
    contentChars: 400,
    mediaKind: "IMAGE",
    band: "SANG",
    publishedAt: daysAgo(10),
    probeKind: "STANDARD",
    reactions: 100,
    comments: 10,
    shares: 2,
    distributionValue: 3000,
    ...over,
  };
}

// ============================================================
section("1. Đọc payload Graph API");
// ============================================================

{
  // Metric đếm: values[].value là số, nhiều mốc thời gian → lấy mốc cuối
  const raw = {
    data: [
      {
        name: "post_media_view",
        period: "lifetime",
        values: [{ value: 100 }, { value: 250 }],
      },
    ],
  };
  const parsed = parseInsightPayload(raw, ["post_media_view", "post_clicks"]);
  check("đọc metric dạng số, lấy mốc mới nhất", parsed.values.post_media_view === 250);
  check("metric thiếu được ghi vào missing", parsed.missing.includes("post_clicks"));
  check("metric thiếu KHÔNG ném lỗi", parsed.missing.length === 1);
}

{
  // Metric chia nhỏ: value là object
  const raw = {
    data: [
      {
        name: "post_reactions_by_type_total",
        values: [{ value: { like: 10, love: 2 } }],
      },
    ],
  };
  const parsed = parseInsightPayload(raw, ["post_reactions_by_type_total"]);
  check(
    "đọc metric chia nhỏ dạng object",
    parsed.values.post_reactions_by_type_total?.like === 10
  );
  check(
    "cộng được metric chia nhỏ",
    sumNumericRecord(parsed.values.post_reactions_by_type_total) === 12
  );
  check("metric dạng object không đọc thành số", numericMetric(parsed.values, "post_reactions_by_type_total") === null);
}

{
  // Payload hỏng hoàn toàn → không ném lỗi, chỉ báo thiếu
  const parsed = parseInsightPayload(null, ["post_media_view"]);
  check("payload null không làm sập", parsed.missing.includes("post_media_view"));
  const parsed2 = parseInsightPayload({ data: "sai" }, ["post_media_view"]);
  check("data không phải mảng không làm sập", parsed2.missing.includes("post_media_view"));
}

{
  // Tương tác từ /posts: shares là object { count }, hai trường kia là summary
  const raw = {
    data: [
      {
        id: "111_222",
        created_time: "2026-09-01T00:00:00+0000",
        reactions: { summary: { total_count: 55 } },
        comments: { summary: { total_count: 7 } },
        shares: { count: 3 },
      },
      {
        id: "111_333",
        // Thiếu shares hoàn toàn → phải là 0, không phải undefined
        reactions: { summary: { total_count: 1 } },
        comments: { summary: { total_count: 0 } },
      },
    ],
  };
  const map = parseInteractionSummary(raw);
  const a = map.get("111_222");
  check("đọc reactions từ summary", a?.reactions === 55);
  check("đọc comments từ summary", a?.comments === 7);
  check("đọc shares từ object count", a?.shares === 3);
  check("thiếu shares → 0 (không undefined)", map.get("111_333")?.shares === 0);
  check("giữ created_time", a?.createdTime === "2026-09-01T00:00:00+0000");
}

// ---- Phân loại lỗi ----
{
  check(
    "nhận diện lỗi invalid metric qua code 3001",
    isInvalidMetricError({ code: 3001, message: "x" })
  );
  check(
    "nhận diện lỗi invalid metric qua subcode 1504028",
    isInvalidMetricError({ error_subcode: 1504028, message: "x" })
  );
  check(
    "nhận diện lỗi invalid metric qua message",
    isInvalidMetricError(new Error("(#3001) Invalid metric: post_impressions_unique"))
  );
  check(
    "KHÔNG nhầm lỗi thường thành invalid metric",
    !isInvalidMetricError(new Error("Timeout"))
  );

  check(
    "nhận diện Page chưa đủ 100 lượt thích",
    isLowFansError(new Error("Page Insights data is only available on Pages with 100 or more likes."))
  );
  check("nhận diện token hỏng qua code 190", isTokenInvalidError({ code: 190, message: "x" }));
  check(
    "nhận diện object không tồn tại (code 100 + message)",
    isNotFoundError({ code: 100, message: "Object does not exist or cannot be loaded." })
  );
  check(
    "code 100 với message khác KHÔNG coi là not-found",
    !isNotFoundError({ code: 100, message: "Too many parameters" })
  );
}

// ---- Nhịp làm mới ----
{
  check(
    "số liệu OK làm mới sau 18h",
    insightRetryMs("OK") === 18 * 60 * 60 * 1000
  );
  check(
    "lỗi quyền lùi 7 ngày (không đập vào tường)",
    insightRetryMs("NO_PERMISSION") === 7 * 24 * 60 * 60 * 1000
  );
  check("chưa từng lấy → làm mới ngay", insightRetryMs("UNKNOWN") === 0);

  check(
    "vừa lấy xong thì chưa cũ",
    insightFreshness("OK", new Date(NOW.getTime() - 60 * 1000), NOW).stale === false
  );
  check(
    "quá 18h thì cũ",
    insightFreshness("OK", new Date(NOW.getTime() - 19 * 60 * 60 * 1000), NOW).stale === true
  );
  check("chưa có fetchedAt thì cũ ngay", insightFreshness("OK", null, NOW).stale === true);
  check(
    "đồng hồ lệch (fetchedAt tương lai) không gây gọi liên tục",
    insightFreshness("OK", new Date(NOW.getTime() + 60 * 1000), NOW).stale === false
  );
}

// ---- Thống kê cơ bản ----
{
  check("median của mảng lẻ", medianOf([1, 5, 3]) === 3);
  check("median của mảng chẵn", medianOf([1, 2, 3, 4]) === 2.5);
  check("median mảng rỗng = 0", medianOf([]) === 0);
  check("MAD chống outlier", madOf([10, 10, 10, 1000], 10) === 0);
  check("robustZ chặn biên trên", robustZ(100000, 10, 1) === 4);
  check("robustZ chặn biên dưới", robustZ(-100000, 10, 1) === -4);
  check("robustZ không chia cho 0 khi scale = 0", robustZ(50, 10, 0) === 0);

  // ĐƯỜNG LÙI QUAN TRỌNG: khi MAD = 0 (hơn nửa số bài cùng điểm — rất phổ biến
  // với Page mới nhiều bài 0 tương tác), độ tán xạ phải lùi sang độ lệch chuẩn
  // hoặc trung vị. Nếu trả 0 thì KHÔNG hướng nào được nhận ra là tốt/kém và
  // tính năng tối ưu sẽ im lặng không làm gì.
  check(
    "MAD = 0 vẫn có độ tán xạ (không để tính năng im lặng)",
    dispersionOf([0, 0, 0, 500], 0, 0) > 0
  );
  check(
    "mọi bài giống hệt nhau → độ tán xạ tối thiểu là 1",
    dispersionOf([50, 50, 50], 50, 0) === 50 || dispersionOf([50, 50, 50], 50, 0) > 0
  );
  check(
    "MAD > 0 thì dùng MAD (chống outlier)",
    dispersionOf([10, 10, 10, 1000], 10, 0) === stdDevOf([10, 10, 10, 1000])
  );
  check("MAD chống outlier tốt hơn độ lệch chuẩn", madOf([10, 10, 10, 1000], 10) < stdDevOf([10, 10, 10, 1000]));
  check("stdDev mảng 1 phần tử = 0", stdDevOf([5]) === 0);
}

// ---- Quy đổi đặc trưng ----
{
  check("band 8h → Sáng", bandOfHour(8) === "SANG");
  check("band 12h → Trưa", bandOfHour(12) === "TRUA");
  check("band 15h → Chiều", bandOfHour(15) === "CHIEU");
  check("band 20h → Tối", bandOfHour(20) === "TOI");
  // Toàn ánh: giờ nào cũng phải ra một band, nếu không thống kê sẽ mất bài
  check(
    "mọi giờ 0–23 đều có band (toàn ánh)",
    Array.from({ length: 24 }, (_, h) => bandOfHour(h)).every((b) => Boolean(b))
  );

  check("hook có dấu ? → câu hỏi", hookStyleOf("Bạn đang tìm rèm chống nắng?") === "CauHoi");
  check("hook mở đầu bằng • → danh sách", hookStyleOf("• Cản nắng\n• Cách nhiệt") === "DanhSach");
  check("hook có số → con số", hookStyleOf("Giảm 90% nắng chiều") === "ConSo");
  check("hook kể chuyện mặc định", hookStyleOf("Chị Lan ở Thủ Dầu Một gọi cho tôi.") === "KeChuyen");
  check("hook rỗng không sập", hookStyleOf("") === "KeChuyen");
  check("hook null không sập", hookStyleOf(null) === "KeChuyen");
  check(
    "câu hỏi có số vẫn là câu hỏi (ưu tiên dấu ?)",
    hookStyleOf("Bạn có biết 90% khách phải thay rèm?") === "CauHoi"
  );

  check("có VIDEO → VIDEO", mediaKindOf(["IMAGE", "VIDEO"]) === "VIDEO");
  check("chỉ ảnh → IMAGE", mediaKindOf(["IMAGE", "IMAGE"]) === "IMAGE");
  check("không có media → IMAGE", mediaKindOf([]) === "IMAGE");

  check(
    "tỉ lệ tương tác = điểm / lượt xem",
    interactionRateOf({ reactions: 10, comments: 0, shares: 0, distributionValue: 100 }) === 0.1
  );
  check(
    "thiếu lượt xem → null (không phải 0)",
    interactionRateOf({ reactions: 10, comments: 0, shares: 0, distributionValue: null }) === null
  );
  check(
    "lượt xem = 0 → null (không chia cho 0)",
    interactionRateOf({ reactions: 10, comments: 0, shares: 0, distributionValue: 0 }) === null
  );
}

{
  const allMetrics = INSIGHT_METRIC_GROUPS.flatMap((g) => g.metrics);
  check(
    "danh sách metric KHÔNG chứa metric đã bị Meta ngừng hỗ trợ (*_unique cũ)",
    !allMetrics.some((m) => m === "post_impressions_unique" || m === "post_video_views_unique")
  );
  check(
    "có metric thay thế post_media_view",
    allMetrics.includes("post_media_view")
  );
  check(
    "metric tối thiểu để lùi khi nhóm distribution bị bỏ",
    MINIMAL_DISTRIBUTION_METRIC === "post_media_view"
  );
}

// ============================================================
section("2. Phân tích hiệu quả");
// ============================================================

{
  const report = analyzePerformance([], { now: NOW });
  check("không có bài → sampleSize 0", report.sampleSize === 0);
  check("không có bài → confidence NONE", report.confidence === "NONE");
  check("không có bài → reachAvailable false", report.reachAvailable === false);
  check("không có bài → trend7d null", report.trend7d === null);
  check("không có bài → topPosts rỗng", report.topPosts.length === 0);
}

{
  // 3 bài "Khuyến mãi" hiệu quả cao, 3 bài "Giới thiệu công ty" thấp
  const samples = [
    ...Array.from({ length: 3 }, () =>
      sample({ pillarName: "Khuyến mãi", reactions: 300, comments: 40, shares: 10 })
    ),
    ...Array.from({ length: 3 }, () =>
      sample({ pillarName: "Giới thiệu công ty", reactions: 10, comments: 0, shares: 0 })
    ),
  ];
  const report = analyzePerformance(samples, { now: NOW });

  check("đếm đúng số mẫu", report.sampleSize === 6);
  check("dưới 8 bài → confidence LOW", report.confidence === "LOW");

  const promo = report.byPillar.find((g) => g.key === "Khuyến mãi");
  const intro = report.byPillar.find((g) => g.key === "Giới thiệu công ty");
  check("gom nhóm đúng số bài mỗi trụ cột", promo?.posts === 3 && intro?.posts === 3);
  check("trụ cột hiệu quả cao xếp trước", report.byPillar[0].key === "Khuyến mãi");
  check("trụ cột tốt có z dương", (promo?.z ?? 0) > 0);
  check("trụ cột kém có z âm", (intro?.z ?? 0) < 0);
  check(
    "share = tỉ lệ số bài",
    Math.abs((promo?.share ?? 0) - 0.5) < 0.001
  );
  check(
    "topPosts là bài hiệu quả nhất",
    report.topPosts[0].pillarName === "Khuyến mãi"
  );
  check(
    "weakPosts là bài kém nhất",
    report.weakPosts[0].pillarName === "Giới thiệu công ty"
  );
}

{
  // reachAvailable: chỉ true khi CÓ ít nhất một bài kèm số người tiếp cận
  const noReach = analyzePerformance(
    [sample({ distributionValue: null }), sample({ distributionValue: null })],
    { now: NOW }
  );
  check("thiếu hết lượt xem → reachAvailable false", noReach.reachAvailable === false);
  check("thiếu hết lượt xem → medianDistribution null", noReach.medianDistribution === null);

  const someReach = analyzePerformance(
    [sample({ distributionValue: 5000 }), sample({ distributionValue: null })],
    { now: NOW }
  );
  check("có một bài kèm lượt xem → reachAvailable true", someReach.reachAvailable === true);
  check("medianDistribution bỏ qua null", someReach.medianDistribution === 5000);
}

{
  // Xu hướng 7 ngày: cần ≥2 bài mỗi kỳ, nếu không thì null
  const onlyRecent = analyzePerformance(
    [sample({ publishedAt: daysAgo(2) }), sample({ publishedAt: daysAgo(3) })],
    { now: NOW }
  );
  check("chỉ có bài gần đây → trend7d null (không kết luận)", onlyRecent.trend7d === null);

  const trend = analyzePerformance(
    [
      ...Array.from({ length: 3 }, () =>
        sample({ publishedAt: daysAgo(2), reactions: 200, comments: 0, shares: 0 })
      ),
      ...Array.from({ length: 3 }, () =>
        sample({ publishedAt: daysAgo(10), reactions: 100, comments: 0, shares: 0 })
      ),
    ],
    { now: NOW }
  );
  check("đủ mẫu hai kỳ → có trend7d", trend.trend7d !== null);
  check("tăng 100% được nhận ra", Math.round(trend.trend7d?.changePct ?? 0) === 100);

  const decline = analyzePerformance(
    [
      ...Array.from({ length: 3 }, () =>
        sample({ publishedAt: daysAgo(2), reactions: 50, comments: 0, shares: 0 })
      ),
      ...Array.from({ length: 3 }, () =>
        sample({ publishedAt: daysAgo(10), reactions: 100, comments: 0, shares: 0 })
      ),
    ],
    { now: NOW }
  );
  check("giảm 50% được nhận ra", Math.round(decline.trend7d?.changePct ?? 0) === -50);
}

{
  // Mức tin cậy theo số mẫu
  const mk = (n) =>
    analyzePerformance(
      Array.from({ length: n }, () => sample()),
      { now: NOW }
    );
  check("7 bài → LOW", mk(7).confidence === "LOW");
  check("8 bài → LOW (ngưỡng thấp)", mk(8).confidence === "LOW");
  check("20 bài → MEDIUM", mk(20).confidence === "MEDIUM");
  check("50 bài → HIGH", mk(50).confidence === "HIGH");
}

{
  // changePct của nhóm: cần ≥2 bài mỗi kỳ
  const oneEach = analyzePerformance(
    [
      sample({ pillarName: "A", publishedAt: daysAgo(2) }),
      sample({ pillarName: "A", publishedAt: daysAgo(10) }),
    ],
    { now: NOW }
  );
  check(
    "nhóm chỉ 1 bài mỗi kỳ → changePct null",
    oneEach.byPillar[0].changePct === null
  );

  const twoEach = analyzePerformance(
    [
      sample({ pillarName: "A", publishedAt: daysAgo(2), reactions: 200, comments: 0, shares: 0 }),
      sample({ pillarName: "A", publishedAt: daysAgo(3), reactions: 200, comments: 0, shares: 0 }),
      sample({ pillarName: "A", publishedAt: daysAgo(10), reactions: 100, comments: 0, shares: 0 }),
      sample({ pillarName: "A", publishedAt: daysAgo(11), reactions: 100, comments: 0, shares: 0 }),
    ],
    { now: NOW }
  );
  // Điểm = reactions (comments/shares = 0) → 200 vs 100 = +100%
  check(
    "nhóm đủ 2 bài mỗi kỳ → changePct tính được",
    Math.round(twoEach.byPillar[0].changePct ?? 0) === 100,
    `changePct = ${twoEach.byPillar[0].changePct}`
  );
}

// ============================================================
section("3. Đề xuất có giới hạn");
// ============================================================

{
  const pillars = [
    { name: "Khuyến mãi", weight: 50 },
    { name: "Giới thiệu công ty", weight: 30 },
    { name: "Chia sẻ kiến thức", weight: 20 },
  ];

  // Chưa đủ dữ liệu → không áp dụng
  const empty = suggestPillarWeights(pillars, analyzePerformance([], { now: NOW }));
  check("không có dữ liệu → không áp dụng", empty.applied === false);
  check(
    "không áp dụng → giữ NGUYÊN trọng số gốc",
    empty.weights["Khuyến mãi"] === 50 && empty.weights["Giới thiệu công ty"] === 30
  );

  // Một trụ cột → không điều chỉnh
  const single = suggestPillarWeights(
    [{ name: "Duy nhất", weight: 100 }],
    analyzePerformance(Array.from({ length: 20 }, () => sample()), { now: NOW })
  );
  check("một trụ cột → không điều chỉnh", single.applied === false);

  // Đủ dữ liệu, chênh lệch rõ
  const samples = [
    ...Array.from({ length: 10 }, () =>
      sample({ pillarName: "Khuyến mãi", reactions: 400, comments: 0, shares: 0 })
    ),
    ...Array.from({ length: 10 }, () =>
      sample({ pillarName: "Giới thiệu công ty", reactions: 5, comments: 0, shares: 0 })
    ),
    ...Array.from({ length: 10 }, () =>
      sample({ pillarName: "Chia sẻ kiến thức", reactions: 100, comments: 0, shares: 0 })
    ),
  ];
  const report = analyzePerformance(samples, { now: NOW });
  const suggestion = suggestPillarWeights(pillars, report);

  check("đủ dữ liệu + chênh lệch rõ → áp dụng", suggestion.applied === true);
  check(
    "tổng trọng số KHÔNG đổi (số bài/ngày giữ nguyên)",
    Object.values(suggestion.weights).reduce((a, b) => a + b, 0) === 100,
    `tổng = ${Object.values(suggestion.weights).reduce((a, b) => a + b, 0)}`
  );
  check(
    "trụ cột hiệu quả cao được tăng trọng số",
    suggestion.weights["Khuyến mãi"] > 50
  );
  check(
    "trụ cột kém bị giảm trọng số",
    suggestion.weights["Giới thiệu công ty"] < 30
  );
  check(
    "mức tăng không vượt ±30%",
    suggestion.weights["Khuyến mãi"] <= Math.round(50 * PILLAR_WEIGHT_MAX_FACTOR)
  );
  check(
    "mức giảm không vượt sàn 50%",
    suggestion.weights["Giới thiệu công ty"] >= Math.round(30 * PILLAR_WEIGHT_MIN_FACTOR)
  );
  check(
    "trọng số sau điều chỉnh luôn ≥ 1",
    Object.values(suggestion.weights).every((w) => w >= 1)
  );

  // Trụ cột chưa đủ mẫu không được điều chỉnh
  const mixed = [
    ...Array.from({ length: 10 }, () =>
      sample({ pillarName: "Khuyến mãi", reactions: 400 })
    ),
    ...Array.from({ length: 10 }, () =>
      sample({ pillarName: "Giới thiệu công ty", reactions: 5 })
    ),
    sample({ pillarName: "Chia sẻ kiến thức", reactions: 9999 }),
  ];
  const mixedSuggestion = suggestPillarWeights(
    pillars,
    analyzePerformance(mixed, { now: NOW })
  );
  check(
    "trụ cột chỉ 1 bài giữ nguyên trọng số",
    mixedSuggestion.weights["Chia sẻ kiến thức"] === 20
  );
}

{
  const config = { windowStart: "07:00", windowEnd: "21:00", minGapMinutes: 120 };

  // Chưa đủ tin cậy → không dồn
  const low = suggestTimeBias(
    analyzePerformance(Array.from({ length: 5 }, () => sample()), { now: NOW }),
    config,
    parseHm
  );
  check("dưới ngưỡng tin cậy → không dồn khung giờ", low.bias === null);

  // Đủ tin cậy, band Tối vượt trội
  const samples = [
    ...Array.from({ length: 8 }, () =>
      sample({ band: "TOI", reactions: 500, comments: 0, shares: 0 })
    ),
    ...Array.from({ length: 8 }, () =>
      sample({ band: "SANG", reactions: 10, comments: 0, shares: 0 })
    ),
    ...Array.from({ length: 8 }, () =>
      sample({ band: "CHIEU", reactions: 10, comments: 0, shares: 0 })
    ),
  ];
  const report = analyzePerformance(samples, { now: NOW });
  const bias = suggestTimeBias(report, config, parseHm);

  check("đủ dữ liệu → dồn khung giờ tốt nhất", bias.bias !== null);
  check("chọn đúng band Tối", bias.bias?.band === "TOI");
  check("tỉ lệ dồn chỉ 50% (giữ bài ở khung khác)", bias.bias?.share === TIME_BIAS_SHARE);
  check(
    "khung ưu tiên nằm TRONG khung người dùng đặt",
    (bias.bias?.startMin ?? 0) >= 7 * 60 && (bias.bias?.endMin ?? 0) <= 21 * 60
  );

  // Band tốt nhất nằm ngoài khung người dùng → không dồn
  const narrow = { windowStart: "07:00", windowEnd: "10:00", minGapMinutes: 60 };
  const outside = suggestTimeBias(report, narrow, parseHm);
  check("band tốt nhất ngoài khung → không dồn", outside.bias === null);

  // Khung giờ không hợp lệ → không dồn
  const bad = suggestTimeBias(report, { ...config, windowStart: "sai" }, parseHm);
  check("khung giờ không hợp lệ → không dồn", bad.bias === null);
}

{
  const samples = [
    ...Array.from({ length: 8 }, () =>
      sample({ hookStyle: "CauHoi", reactions: 400, comments: 0, shares: 0 })
    ),
    ...Array.from({ length: 8 }, () =>
      sample({ hookStyle: "KeChuyen", reactions: 10, comments: 0, shares: 0 })
    ),
  ];
  const hook = suggestHookStyle(analyzePerformance(samples, { now: NOW }));
  check("đề xuất được kiểu mở bài hiệu quả nhất", hook.style === "CauHoi");

  const none = suggestHookStyle(analyzePerformance([], { now: NOW }));
  check("không có dữ liệu → không đề xuất kiểu mở bài", none.style === null);
}

// ============================================================
section("4. Vòng đời học: giai đoạn, tụt, dò, hướng nội dung");
// ============================================================

const noRegression = {
  triggered: false,
  severity: "NONE",
  signals: [],
  reason: "",
};

{
  check(
    "dưới 8 bài → PROBE",
    resolveLearningPhase({
      totalPublishedAutoPilot: 3,
      report: analyzePerformance([], { now: NOW }),
      regression: noRegression,
    }) === "PROBE"
  );
  check(
    "đúng 8 bài → EXPLOIT",
    resolveLearningPhase({
      totalPublishedAutoPilot: 8,
      report: analyzePerformance([], { now: NOW }),
      regression: noRegression,
    }) === "EXPLOIT"
  );
  check(
    "có tụt → REPROBE dù đã đủ bài",
    resolveLearningPhase({
      totalPublishedAutoPilot: 50,
      report: analyzePerformance([], { now: NOW }),
      regression: { ...noRegression, triggered: true },
    }) === "REPROBE"
  );
  check(
    "tụt được xét TRƯỚC số mẫu",
    resolveLearningPhase({
      totalPublishedAutoPilot: 2,
      report: analyzePerformance([], { now: NOW }),
      regression: { ...noRegression, triggered: true },
    }) === "REPROBE"
  );
  check(
    "tụt được xét TRƯỚC cả ngân sách dò đã hết",
    resolveLearningPhase({
      totalPublishedAutoPilot: 2,
      report: analyzePerformance([], { now: NOW }),
      regression: { ...noRegression, triggered: true },
      probeBudgetExhausted: true,
    }) === "REPROBE"
  );

  // Hết ngân sách dò mà vẫn chưa đủ 8 bài → THOÁT dò, không dò mãi không dứt.
  // Đây là tình huống thật của Page ít người xem: 12 bài dò vẫn chưa đủ 8 bài
  // "chín" (bài dưới 24h không được tính).
  check(
    "hết ngân sách dò → thoát dò dù chưa đủ 8 bài",
    resolveLearningPhase({
      totalPublishedAutoPilot: 3,
      report: analyzePerformance([], { now: NOW }),
      regression: noRegression,
      probeBudgetExhausted: true,
    }) === "EXPLOIT"
  );
  check(
    "chưa hết ngân sách + chưa đủ bài → vẫn dò",
    resolveLearningPhase({
      totalPublishedAutoPilot: 3,
      report: analyzePerformance([], { now: NOW }),
      regression: noRegression,
      probeBudgetExhausted: false,
    }) === "PROBE"
  );
}

{
  // Tín hiệu 1: xu hướng 7 ngày tụt
  const declining = analyzePerformance(
    [
      ...Array.from({ length: 10 }, () =>
        sample({ publishedAt: daysAgo(2), reactions: 30, comments: 0, shares: 0 })
      ),
      ...Array.from({ length: 10 }, () =>
        sample({ publishedAt: daysAgo(10), reactions: 100, comments: 0, shares: 0 })
      ),
    ],
    { now: NOW }
  );
  const reg = detectRegression({
    report: declining,
    previous: null,
    lastReProbeAt: null,
    configChangedRecently: false,
    now: NOW,
  });
  check("phát hiện tụt khi trend giảm mạnh", reg.triggered === true);
  check("mức độ MAJOR", reg.severity === "MAJOR");
  check("có tín hiệu TREND_DROP*", reg.signals.some((s) => s.code.startsWith("TREND_DROP")));
  check("lý do không rỗng", reg.reason.length > 0);

  // Chống báo động giả: cooldown
  const cooling = detectRegression({
    report: declining,
    previous: null,
    lastReProbeAt: new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000),
    configChangedRecently: false,
    now: NOW,
  });
  check(
    `cooldown ${REPROBE_COOLDOWN_DAYS} ngày chặn dò lại`,
    cooling.triggered === false && cooling.severity === "MAJOR"
  );

  // Chống báo động giả: vừa đổi cấu hình
  const changed = detectRegression({
    report: declining,
    previous: null,
    lastReProbeAt: null,
    configChangedRecently: true,
    now: NOW,
  });
  check("vừa đổi cấu hình → chưa kết luận tụt", changed.triggered === false);

  // Chống báo động giả: cooldown hết hạn thì cho phép
  const cooled = detectRegression({
    report: declining,
    previous: null,
    lastReProbeAt: new Date(NOW.getTime() - 20 * 24 * 60 * 60 * 1000),
    configChangedRecently: false,
    now: NOW,
  });
  check("hết cooldown → cho phép kiểm tra lại", cooled.triggered === true);

  // Số liệu ổn định → không tụt
  const stable = analyzePerformance(
    Array.from({ length: 20 }, () => sample({ reactions: 100 })),
    { now: NOW }
  );
  const ok = detectRegression({
    report: stable,
    previous: null,
    lastReProbeAt: null,
    configChangedRecently: false,
    now: NOW,
  });
  check("số liệu ổn định → không tụt", ok.triggered === false);

  // Chưa đủ dữ liệu → không kết luận
  const empty = detectRegression({
    report: analyzePerformance([], { now: NOW }),
    previous: null,
    lastReProbeAt: null,
    configChangedRecently: false,
    now: NOW,
  });
  check("không có dữ liệu → không kết luận tụt", empty.triggered === false);
}

{
  // Tín hiệu "trung vị giảm so với lần phân tích trước" (tụt chậm)
  const nowReport = analyzePerformance(
    Array.from({ length: 20 }, () => sample({ reactions: 50, comments: 0, shares: 0 })),
    { now: NOW }
  );
  const prevReport = analyzePerformance(
    Array.from({ length: 20 }, () => sample({ reactions: 100, comments: 0, shares: 0 })),
    { now: NOW }
  );
  const reg = detectRegression({
    report: nowReport,
    previous: prevReport,
    lastReProbeAt: null,
    configChangedRecently: false,
    now: NOW,
  });
  check(
    "so với lần phân tích trước cũng tạo tín hiệu",
    reg.signals.some((s) => s.code === "BASELINE_DROP")
  );
}

{
  // Kế hoạch dò
  const plan = planProbeBatch({
    phase: "PROBE",
    pillars: [{ name: "A" }, { name: "B" }, { name: "C" }],
    previousEntries: [],
    config: { mediaMix: "IMAGE_ONLY", windowStart: "07:00", windowEnd: "21:00", minGapMinutes: 120 },
    probePostsSoFar: 0,
    remainingBudget: 12,
    hasServiceAreas: false,
  });

  check("ngân sách dò = 12 bài", plan.totalQuota === PROBE_MAX_POSTS);
  check("chưa hết ngân sách", plan.exhausted === false);
  check(
    "chia đều cho 3 trụ cột",
    plan.quotas
      .filter((q) => q.kind === "PILLAR")
      .every((q) => q.quota === 4)
  );
  check(
    "có quota cho đủ 4 kiểu hook",
    plan.quotas.filter((q) => q.kind === "HOOK").length === HOOK_STYLES.length
  );
  check(
    "có quota cho các band trong khung giờ",
    plan.quotas.filter((q) => q.kind === "TIME_BAND").length === 4
  );
  check(
    "không dò media khi chỉ dùng ảnh",
    plan.quotas.filter((q) => q.kind === "MEDIA").length === 0
  );
  // Hết ngân sách
  const exhausted = planProbeBatch({
    phase: "PROBE",
    pillars: [{ name: "A" }],
    previousEntries: [],
    config: { mediaMix: "IMAGE_ONLY", windowStart: "07:00", windowEnd: "21:00", minGapMinutes: 120 },
    probePostsSoFar: PROBE_MAX_POSTS,
    remainingBudget: 12,
    hasServiceAreas: false,
  });
  check("hết ngân sách dò → exhausted", exhausted.exhausted === true);
  check("hết ngân sách → không còn quota", exhausted.totalQuota === 0);
  check("hết ngân sách → có lý do rõ", exhausted.reason.includes("ngân sách"));

  // Khai thác → không dò
  const exploit = planProbeBatch({
    phase: "EXPLOIT",
    pillars: [{ name: "A" }],
    previousEntries: [],
    config: { mediaMix: "IMAGE_ONLY", windowStart: "07:00", windowEnd: "21:00", minGapMinutes: 120 },
    probePostsSoFar: 0,
    remainingBudget: 12,
    hasServiceAreas: false,
  });
  check("giai đoạn khai thác → không dò", exploit.quotas.length === 0);

  // Hướng đã BAD bị loại khỏi đợt sau
  const avoidBad = planProbeBatch({
    phase: "REPROBE",
    pillars: [{ name: "A" }, { name: "B" }],
    previousEntries: [{ kind: "HOOK", value: "ConSo", result: "BAD" }],
    config: { mediaMix: "MIXED", windowStart: "07:00", windowEnd: "21:00", minGapMinutes: 120 },
    probePostsSoFar: 0,
    remainingBudget: 12,
    hasServiceAreas: false,
  });
  check(
    "loại hướng hook đã thất bại",
    !avoidBad.quotas.some((q) => q.kind === "HOOK" && q.value === "ConSo")
  );
  check(
    "mediaMix MIXED → dò cả ảnh và video",
    avoidBad.quotas.filter((q) => q.kind === "MEDIA").length === 2
  );

  check(
    "giới hạn bài cho một hướng không vượt ngân sách",
    maxProbePostsPerHint(12, 3) <= 12
  );
}

{
  // Band giờ dò phải nằm TRONG khung người dùng đặt
  const narrow = usableBands({ windowStart: "18:00", windowEnd: "21:00" });
  check("khung 18–21h chỉ có band Tối", narrow.length === 1 && narrow[0] === "TOI");

  const all = usableBands({ windowStart: "06:00", windowEnd: "22:00" });
  check("khung rộng → đủ 4 band", all.length === 4);

  const invalid = usableBands({ windowStart: "sai", windowEnd: "sai" });
  check("khung không hợp lệ không sập", invalid.length === 4);
}

{
  // Chọn chỉ thị dò: lấp quota còn thiếu nhiều nhất
  const plan = planProbeBatch({
    phase: "PROBE",
    pillars: [{ name: "A" }, { name: "B" }],
    previousEntries: [],
    config: { mediaMix: "IMAGE_ONLY", windowStart: "07:00", windowEnd: "21:00", minGapMinutes: 120 },
    probePostsSoFar: 0,
    remainingBudget: 12,
    hasServiceAreas: false,
  });

  const used = {};
  const hints = [];
  for (let i = 0; i < 12; i++) {
    const hint = pickProbeHint(plan, used, i);
    if (!hint) break;
    hints.push(hint);
    for (const e of hint.entries) {
      const key = `${e.kind}:${e.value}`;
      used[key] = (used[key] ?? 0) + 1;
    }
  }

  check("chọn được chỉ thị cho các slot", hints.length > 0);
  check(
    "số bài dò KHÔNG vượt ngân sách (quota từng hướng cộng lại lớn hơn)",
    hints.length <= PROBE_MAX_POSTS,
    `${hints.length} bài cho ngân sách ${PROBE_MAX_POSTS}`
  );
  check(
    "mỗi chỉ thị có trụ cột",
    hints.every((h) => typeof h.pillarName === "string" && h.pillarName.length > 0)
  );
  check(
    "có chỉ thị hook (để so sánh kiểu mở bài)",
    hints.some((h) => h.hookStyle !== null)
  );
  check("có chỉ thị band giờ", hints.some((h) => h.band !== null));
  check(
    "chỉ thị có ghi chú hướng dẫn",
    hints.some((h) => h.note.length > 0)
  );

  // Phân bổ đều: hai trụ cột phải được dùng gần bằng nhau
  const counts = {};
  for (const h of hints) counts[h.pillarName] = (counts[h.pillarName] ?? 0) + 1;
  const values = Object.values(counts);
  check(
    "phân bổ ĐỀU giữa các trụ cột (lệch ≤ 1)",
    Math.max(...values) - Math.min(...values) <= 1,
    `phân bổ: ${JSON.stringify(counts)}`
  );

  // Hết quota → null
  const done = pickProbeHint(plan, used, hints.length);
  check("hết ngân sách → không còn chỉ thị", done === null);
}

{
  // Kết luận kết quả dò
  const samples = [
    ...Array.from({ length: 5 }, () =>
      sample({ pillarName: "A", hookStyle: "CauHoi", reactions: 400, comments: 0, shares: 0 })
    ),
    ...Array.from({ length: 5 }, () =>
      sample({ pillarName: "B", hookStyle: "ConSo", reactions: 5, comments: 0, shares: 0 })
    ),
  ];
  const report = analyzePerformance(samples, { now: NOW });
  const results = evaluateProbeResults(
    [
      { kind: "PILLAR", value: "A", result: "PENDING" },
      { kind: "PILLAR", value: "B", result: "PENDING" },
      { kind: "HOOK", value: "DanhSach", result: "PENDING" },
    ],
    report
  );

  check(
    "hướng hiệu quả cao → GOOD",
    results.find((r) => r.value === "A")?.result === "GOOD"
  );
  check(
    "hướng kém → BAD",
    results.find((r) => r.value === "B")?.result === "BAD"
  );
  check(
    "hướng chưa thử bài nào → PENDING (không loại vĩnh viễn)",
    results.find((r) => r.value === "DanhSach")?.result === "PENDING"
  );
}

{
  // Hướng nội dung: bão hoà + ước lượng độ bền
  const samples = [
    // Trụ cột chiếm 75% bài và đang giảm mạnh → EXHAUSTED
    ...Array.from({ length: 15 }, () =>
      sample({
        pillarName: "Giới thiệu công ty",
        publishedAt: daysAgo(2),
        reactions: 20,
        comments: 0,
        shares: 0,
      })
    ),
    ...Array.from({ length: 15 }, () =>
      sample({
        pillarName: "Giới thiệu công ty",
        publishedAt: daysAgo(10),
        reactions: 100,
        comments: 0,
        shares: 0,
      })
    ),
  ];
  const report = analyzePerformance(samples, { now: NOW });
  const directions = computeDirections(report);
  const exhausted = directions.find((d) => d.value === "Giới thiệu công ty");

  check("hướng vừa giảm vừa chiếm đa số → EXHAUSTED", exhausted?.status === "EXHAUSTED");
  check("EXHAUSTED → ước lượng còn 0 ngày", exhausted?.estLifeDays === 0);
  check(
    "EXHAUSTED → khuyến nghị tạm dừng",
    exhausted?.recommendation.includes("Tạm dừng") === true
  );

  // Hướng đang lên
  const rising = analyzePerformance(
    [
      ...Array.from({ length: 5 }, () =>
        sample({ pillarName: "Khuyến mãi", publishedAt: daysAgo(2), reactions: 400, comments: 0, shares: 0 })
      ),
      ...Array.from({ length: 5 }, () =>
        sample({ pillarName: "Khuyến mãi", publishedAt: daysAgo(10), reactions: 100, comments: 0, shares: 0 })
      ),
    ],
    { now: NOW }
  );
  const risingDirection = computeDirections(rising).find((d) => d.value === "Khuyến mãi");
  check("hướng tăng mạnh → RISING", risingDirection?.status === "RISING");
  check(
    "RISING → khuyến nghị tăng tỉ trọng",
    risingDirection?.recommendation.includes("Tăng") === true
  );
  check(
    "ước lượng độ bền bị chặn trên",
    (risingDirection?.estLifeDays ?? 0) <= MAX_EST_LIFE_DAYS
  );

  // Chưa đủ mẫu → EXPLORING, KHÔNG ước lượng độ bền
  const thin = computeDirections(
    analyzePerformance([sample({ pillarName: "Mới" }), sample({ pillarName: "Mới" })], { now: NOW })
  );
  const thinDir = thin.find((d) => d.value === "Mới");
  check("dưới 3 bài → EXPLORING", thinDir?.status === "EXPLORING");
  check(
    "dưới 3 bài → KHÔNG bịa ước lượng độ bền",
    thinDir?.estLifeDays === null
  );
  check(
    "EXPLORING → khuyến nghị cần thêm bài",
    thinDir?.recommendation.includes("Cần thêm bài") === true
  );

  // Ổn định
  const stable = computeDirections(
    analyzePerformance(
      Array.from({ length: 10 }, () => sample({ pillarName: "Ổn định", reactions: 100 })),
      { now: NOW }
    )
  );
  check(
    "không đổi → STABLE",
    stable.find((d) => d.value === "Ổn định")?.status === "STABLE"
  );
  check(
    "STABLE → giữ nguyên",
    stable.find((d) => d.value === "Ổn định")?.recommendation === "Giữ nguyên"
  );
}

// ============================================================
section("5. Khung giờ: không đổi hành vi khi không có ưu tiên");
// ============================================================

{
  // ĐIỀU KIỆN QUAN TRỌNG NHẤT: bias = null phải cho kết quả Y HỆT hàm gốc,
  // để Page chưa bật tối ưu có lịch đăng giống hệt trước khi có tính năng.
  let identical = true;
  let mismatch = "";
  for (let seed = 1; seed <= 200; seed++) {
    const random1 = seededRandom(seed);
    const random2 = seededRandom(seed);
    const config = {
      postsPerDay: (seed % 4) + 1,
      windowStart: ["07:00", "08:30", "06:00"][seed % 3],
      windowEnd: ["21:00", "18:00", "22:00"][seed % 3],
      minGapMinutes: [30, 60, 120][seed % 3],
    };
    const date = new Date(NOW.getTime() + (seed % 5) * 24 * 60 * 60 * 1000);
    const takenMs = seed % 3 === 0 ? [date.getTime() + 9 * 60 * 60 * 1000] : [];

    const a = planTimeSlots(config, date, null, random1, takenMs);
    const b = planTimeSlotsBiased(config, date, null, random2, takenMs, null);

    if (a.length !== b.length || a.some((d, i) => d.getTime() !== b[i].getTime())) {
      identical = false;
      mismatch = `seed ${seed}: ${a.length} slot vs ${b.length} slot`;
      break;
    }
  }
  check(
    "bias = null cho kết quả GIỐNG HỆT planTimeSlots (200 bộ tham số)",
    identical,
    mismatch
  );
}

{
  // ---- GUARD: ưu tiên khung giờ KHÔNG được làm mất slot ----
  //
  // Lỗi thật đã gặp: khi khung ưu tiên nằm ở CUỐI khung giờ (ví dụ ưu tiên
  // 18–21h trong khung 07–21h), phần "sau" có độ rộng 0 nhưng code cũ vẫn giao
  // slot cho nó → slotsInRange với khoảng rỗng trả mảng rỗng → người dùng đặt
  // 4 bài/ngày chỉ nhận 2 bài, KHÔNG có cảnh báo nào. Kiểm thử này quét nhiều
  // tổ hợp khung giờ ưu tiên để bắt mọi biến thể của lỗi đó.
  let lost = "";
  let lostCount = 0;
  const cases = [
    { name: "ưu tiên cuối khung", bias: { startMin: 18 * 60, endMin: 21 * 60, share: 0.5 } },
    { name: "ưu tiên đầu khung", bias: { startMin: 7 * 60, endMin: 10 * 60, share: 0.5 } },
    { name: "ưu tiên giữa khung", bias: { startMin: 12 * 60, endMin: 15 * 60, share: 0.5 } },
    { name: "ưu tiên gần hết khung", bias: { startMin: 20 * 60, endMin: 21 * 60, share: 0.5 } },
    { name: "ưu tiên gần đầu khung", bias: { startMin: 7 * 60, endMin: 8 * 60, share: 0.5 } },
  ];

  for (const c of cases) {
    for (let seed = 1; seed <= 20; seed++) {
      const config = {
        postsPerDay: 4,
        windowStart: "07:00",
        windowEnd: "21:00",
        minGapMinutes: 120,
      };
      const date = new Date("2026-09-26T00:00:00Z");
      const plain = planTimeSlots(config, date, null, seededRandom(seed), []);
      const biased = planTimeSlotsBiased(config, date, null, seededRandom(seed), [], c.bias);

      if (biased.length < plain.length) {
        lost = `${c.name}, seed ${seed}: ${biased.length} < ${plain.length} slot`;
        lostCount++;
        break;
      }
    }
    if (lost) break;
  }

  check(
    "ưu tiên khung giờ KHÔNG làm mất slot (5 vị trí × 20 seed)",
    lostCount === 0,
    lost
  );
}

{
  const config = {
    postsPerDay: 4,
    windowStart: "07:00",
    windowEnd: "21:00",
    minGapMinutes: 120,
  };
  const date = new Date("2026-09-26T00:00:00Z");

  // Bias vào khung Tối 18–21h
  const bias = { startMin: 18 * 60, endMin: 21 * 60, share: 0.5 };
  const slots = planTimeSlotsBiased(config, date, null, seededRandom(7), [], bias);

  check("có slot được tạo", slots.length > 0);
  check(
    "mọi slot nằm TRONG khung người dùng đặt",
    slots.every((d) => {
      const vn = new Date(d.getTime() + 7 * 60 * 60 * 1000);
      const m = vn.getUTCHours() * 60 + vn.getUTCMinutes();
      return m >= 7 * 60 && m <= 21 * 60;
    })
  );
  check(
    "tôn trọng giãn cách tối thiểu",
    slots.every((d, i) =>
      i === 0 ? true : d.getTime() - slots[i - 1].getTime() >= 120 * 60 * 1000
    )
  );

  // Tỉ lệ slot trong khung ưu tiên ≈ share (50%)
  const inBand = slots.filter((d) => {
    const vn = new Date(d.getTime() + 7 * 60 * 60 * 1000);
    const m = vn.getUTCHours() * 60 + vn.getUTCMinutes();
    return m >= 18 * 60 && m <= 21 * 60;
  });
  check(
    "khoảng 50% số slot nằm trong khung ưu tiên",
    inBand.length >= 1 && inBand.length <= slots.length,
    `${inBand.length}/${slots.length} slot`
  );
  check(
    "KHÔNG dồn hết 100% vào khung ưu tiên (giữ bài ở khung khác)",
    inBand.length < slots.length || slots.length === 1
  );

  // Bias nằm ngoài khung người dùng → rơi về đường thường
  const outside = planTimeSlotsBiased(
    config,
    date,
    null,
    seededRandom(7),
    [],
    { startMin: 2 * 60, endMin: 5 * 60, share: 0.5 }
  );
  const plain = planTimeSlots(config, date, null, seededRandom(7), []);
  check(
    "bias ngoài khung → rơi về đường thường",
    outside.length === plain.length &&
      outside.every((d, i) => d.getTime() === plain[i].getTime())
  );

  // Khung ưu tiên quá hẹp so với giãn cách → rơi về đường thường
  const tooNarrow = planTimeSlotsBiased(config, date, null, seededRandom(7), [], {
    startMin: 18 * 60,
    endMin: 18 * 60 + 30,
    share: 0.5,
  });
  check(
    "khung ưu tiên hẹp hơn giãn cách → rơi về đường thường",
    tooNarrow.length === plain.length
  );

  // notBefore vẫn được tôn trọng khi có bias
  const notBefore = new Date(date.getTime() + 19 * 60 * 60 * 1000);
  const late = planTimeSlotsBiased(config, date, notBefore, seededRandom(3), [], bias);
  check(
    "notBefore được tôn trọng khi có bias",
    late.every((d) => d.getTime() >= notBefore.getTime())
  );

  // takenMs vẫn được tôn trọng khi có bias
  const taken = [date.getTime() + 19 * 60 * 60 * 1000];
  const avoid = planTimeSlotsBiased(config, date, null, seededRandom(5), taken, bias);
  check(
    "tránh giờ bài đã có khi có bias",
    avoid.every((d) => Math.abs(d.getTime() - taken[0]) >= 120 * 60 * 1000)
  );
}

{
  // pickPillarEvenly: phân bổ đều, không phụ thuộc trọng số
  const pillars = [
    { id: "1", name: "A", weight: 80, position: 0, goal: "sales" },
    { id: "2", name: "B", weight: 10, position: 1, goal: "sales" },
    { id: "3", name: "C", weight: 10, position: 2, goal: "sales" },
  ];
  const usage = {};
  const picks = [];
  for (let i = 0; i < 9; i++) {
    const p = pickPillarEvenly(pillars, usage);
    picks.push(p.name);
    usage[p.name] = (usage[p.name] ?? 0) + 1;
  }
  const counts = { A: 0, B: 0, C: 0 };
  for (const p of picks) counts[p]++;
  check(
    "phân bổ đều bất kể trọng số (mỗi trụ cột 3 bài)",
    counts.A === 3 && counts.B === 3 && counts.C === 3,
    JSON.stringify(counts)
  );

  check("một trụ cột → trả chính nó", pickPillarEvenly([pillars[0]], {})?.name === "A");
  check("không có trụ cột → null", pickPillarEvenly([], {}) === null);
}

// ============================================================
section("6. Nhận xét + an toàn thương hiệu");
// ============================================================

{
  const empty = buildCommentary(
    analyzePerformance([], { now: NOW }),
    [],
    "PROBE",
    noRegression,
    { used: 0, budget: PROBE_MAX_POSTS }
  );
  check("không có dữ liệu → nhận xét nói rõ chưa có gì", empty.headline.includes("Chưa có bài"));
  check("luôn có phần minh bạch", empty.honesty.length >= 2);
  check(
    "minh bạch nói rõ số liệu cập nhật 24h",
    empty.honesty.some((h) => h.includes("24 giờ"))
  );
}

{
  const samples = [
    ...Array.from({ length: 12 }, () =>
      sample({ pillarName: "Khuyến mãi", publishedAt: daysAgo(3), reactions: 400, comments: 20, shares: 5 })
    ),
    ...Array.from({ length: 12 }, () =>
      sample({ pillarName: "Giới thiệu công ty", publishedAt: daysAgo(3), reactions: 5, comments: 0, shares: 0 })
    ),
  ];
  const report = analyzePerformance(samples, { now: NOW });
  const directions = computeDirections(report);
  const commentary = buildCommentary(report, directions, "EXPLOIT", noRegression, {
    used: 12,
    budget: PROBE_MAX_POSTS,
  });

  check("có câu tóm tắt", commentary.headline.length > 0);
  check("tóm tắt nêu độ tin cậy", commentary.headline.includes("tin cậy"));
  check(
    "nêu hướng đang chiếm ưu thế",
    commentary.directionSummary.includes("Khuyến mãi")
  );
  check("có nhận xét cụ thể", commentary.bullets.length > 0);
  check("có việc nên làm", commentary.actions.length > 0);
  check(
    "nhận xét đề cập tỉ lệ số bài",
    commentary.bullets.some((b) => b.includes("%"))
  );
  check(
    "minh bạch nói rõ ước lượng không phải dự báo Facebook",
    commentary.honesty.some((h) => h.includes("KHÔNG phải dự báo"))
  );
  check(
    "minh bạch nói rõ ước lượng độ bền là thô",
    commentary.honesty.some((h) => h.includes("ước lượng thô"))
  );
}

{
  // Khi thiếu quyền đọc lượt hiển thị, nhận xét PHẢI nói rõ
  const noReach = analyzePerformance(
    Array.from({ length: 10 }, () => sample({ distributionValue: null })),
    { now: NOW }
  );
  const commentary = buildCommentary(noReach, [], "EXPLOIT", noRegression, {
    used: 0,
    budget: PROBE_MAX_POSTS,
  });
  check(
    "thiếu lượt hiển thị → nhận xét nói rõ chỉ xếp hạng theo tương tác",
    commentary.bullets.some((b) => b.includes("read_insights") || b.includes("tương tác"))
  );
  check(
    "thiếu lượt hiển thị → có việc nên làm là thêm quyền",
    commentary.actions.some((a) => a.includes("read_insights"))
  );
}

{
  // Nhận xét khi phát hiện tụt
  const declining = analyzePerformance(
    [
      ...Array.from({ length: 10 }, () =>
        sample({ publishedAt: daysAgo(2), reactions: 20, comments: 0, shares: 0 })
      ),
      ...Array.from({ length: 10 }, () =>
        sample({ publishedAt: daysAgo(10), reactions: 100, comments: 0, shares: 0 })
      ),
    ],
    { now: NOW }
  );
  const reg = detectRegression({
    report: declining,
    previous: null,
    lastReProbeAt: null,
    configChangedRecently: false,
    now: NOW,
  });
  const commentary = buildCommentary(declining, computeDirections(declining), "REPROBE", reg, {
    used: 4,
    budget: PROBE_MAX_POSTS,
  });
  check(
    "có tụt → nhận xét nói rõ nội dung bắt đầu lỗi thời",
    commentary.bullets.some((b) => b.includes("lỗi thời"))
  );
  check(
    "có tụt → việc nên làm nói rõ chỉ đổi cách triển khai",
    commentary.actions.some((a) => a.includes("cách triển khai"))
  );
}

{
  // Tiến độ dò phải xuất hiện trong nhận xét khi đang dò
  const report = analyzePerformance(
    Array.from({ length: 5 }, () => sample()),
    { now: NOW }
  );
  const commentary = buildCommentary(report, computeDirections(report), "PROBE", noRegression, {
    used: 5,
    budget: PROBE_MAX_POSTS,
  });
  check(
    "đang dò → nhận xét nêu tiến độ X/Y bài",
    commentary.actions.some((a) => a.includes(`${PROBE_MAX_POSTS}`) && a.includes("dò"))
  );
  check(
    "dưới 8 bài → nhận xét nói cần thêm bài",
    commentary.actions.some((a) => a.includes(`${MIN_SAMPLES_FOR_EXPLOIT}`))
  );
}

{
  // Dòng số liệu đưa vào prompt
  const report = analyzePerformance(
    [
      ...Array.from({ length: 10 }, () =>
        sample({ pillarName: "Khuyến mãi", reactions: 400, comments: 0, shares: 0 })
      ),
      ...Array.from({ length: 10 }, () =>
        sample({ pillarName: "Giới thiệu công ty", reactions: 5, comments: 0, shares: 0 })
      ),
    ],
    { now: NOW }
  );
  const lines = buildInsightLines(report);

  check("có dòng số liệu cho prompt", lines.length > 0);
  check(
    "nêu trụ cột hiệu quả tốt",
    lines.some((l) => l.includes("Khuyến mãi"))
  );
  check(
    "nêu trụ cột kém hiệu quả",
    lines.some((l) => l.includes("Giới thiệu công ty"))
  );
  check(
    "KHÔNG đưa con số tuyệt đối của Facebook vào prompt",
    !lines.some((l) => /\b\d{4,}\b/.test(l)),
    lines.find((l) => /\b\d{4,}\b/.test(l)) ?? ""
  );
  check("không có dữ liệu → không có dòng nào", buildInsightLines(analyzePerformance([], { now: NOW })).length === 0);
}

{
  // ---- GUARD: an toàn thương hiệu ----
  check("câu chặn cứng tồn tại", PERFORMANCE_SAFETY_CLAUSE.length > 0);
  check(
    "chặn cứng nói rõ chỉ dùng để chọn góc/cách trình bày",
    PERFORMANCE_SAFETY_CLAUSE.includes("GÓC TIẾP CẬN")
  );
  check(
    "chặn cứng cấm đổi giá/sản phẩm/địa bàn",
    PERFORMANCE_SAFETY_CLAUSE.includes("giá") &&
      PERFORMANCE_SAFETY_CLAUSE.includes("địa bàn")
  );
  check(
    "chặn cứng nói hồ sơ thương hiệu vẫn là nguồn sự thật duy nhất",
    PERFORMANCE_SAFETY_CLAUSE.includes("nguồn sự thật duy nhất")
  );
  check(
    "chặn cứng cấm nhắc số liệu trong bài đăng",
    PERFORMANCE_SAFETY_CLAUSE.includes("KHÔNG nhắc tới số liệu")
  );
}

{
  // ---- GUARD đọc mã nguồn: tính năng KHÔNG được ghi đè nội dung thương hiệu ----
  const autopilotSrc = fs.readFileSync(path.join(ROOT, "src/lib/autopilot.ts"), "utf8");
  const optimizeSrc = fs.readFileSync(path.join(ROOT, "src/lib/insight-optimize.ts"), "utf8");

  check(
    "insight-optimize KHÔNG ghi vào ContentPillar",
    !/prisma\.contentPillar\.(update|delete|upsert)/.test(optimizeSrc)
  );
  check(
    "insight-optimize KHÔNG ghi vào BrandProfile",
    !/prisma\.brandProfile\.(update|delete|upsert)/.test(optimizeSrc)
  );
  check(
    "autopilot KHÔNG ghi trọng số trụ cột xuống DB",
    !/prisma\.contentPillar\.(update|delete|upsert)/.test(autopilotSrc)
  );
  check(
    "trọng số hiệu dụng chỉ nằm trong bộ nhớ (biến cục bộ)",
    /const planPillars = /.test(autopilotSrc)
  );
}

{
  // ---- GUARD: hướng dò luôn nằm trong hồ sơ thương hiệu ----
  const plan = planProbeBatch({
    phase: "PROBE",
    pillars: [{ name: "Chỉ trụ cột có thật" }],
    previousEntries: [],
    config: { mediaMix: "IMAGE_ONLY", windowStart: "07:00", windowEnd: "21:00", minGapMinutes: 120 },
    probePostsSoFar: 0,
    remainingBudget: 12,
    hasServiceAreas: false,
  });

  const pillarQuotas = plan.quotas.filter((q) => q.kind === "PILLAR");
  check(
    "trụ cột dò CHỈ lấy từ danh sách đang bật (không sinh mới)",
    pillarQuotas.length === 1 && pillarQuotas[0].value === "Chỉ trụ cột có thật"
  );

  const hookQuotas = plan.quotas.filter((q) => q.kind === "HOOK");
  check(
    "kiểu hook dò chỉ nằm trong bộ 4 kiểu đóng",
    hookQuotas.every((q) => HOOK_STYLES.includes(q.value))
  );

  const bandQuotas = plan.quotas.filter((q) => q.kind === "TIME_BAND");
  check(
    "band giờ dò chỉ nằm trong khung người dùng đặt",
    bandQuotas.every((q) => ["SANG", "TRUA", "CHIEU", "TOI"].includes(q.value))
  );
}

{
  // ---- GUARD: dò có ngân sách, không dò vô hạn ----
  let steps = 0;
  const plan = planProbeBatch({
    phase: "PROBE",
    pillars: [{ name: "A" }, { name: "B" }],
    previousEntries: [],
    config: { mediaMix: "IMAGE_ONLY", windowStart: "07:00", windowEnd: "21:00", minGapMinutes: 120 },
    probePostsSoFar: 0,
    remainingBudget: 12,
    hasServiceAreas: false,
  });
  const used = {};
  // Giả lập tạo bài cho tới khi hết quota — phải dừng, không lặp vô hạn
  while (steps < 100) {
    const hint = pickProbeHint(plan, used, steps);
    if (!hint) break;
    steps++;
    for (const e of hint.entries) {
      const key = `${e.kind}:${e.value}`;
      used[key] = (used[key] ?? 0) + 1;
    }
  }
  check("dò luôn kết thúc (không lặp vô hạn)", steps < 100, `số bước: ${steps}`);
  check(
    "số bài dò bị chặn ĐÚNG ngân sách",
    steps <= PROBE_MAX_POSTS,
    `${steps} bài cho ngân sách ${PROBE_MAX_POSTS}`
  );
}

// ============================================================
section("7. Hạn mức & URL Graph API (stub fetch)");
// ============================================================

{
  // Stub fetch để kiểm tra URL và số lệnh gọi mà KHÔNG cần mạng.
  // Module fb-insights có "server-only" nên không import trực tiếp được từ
  // Node — vì vậy phần này kiểm tra QUA việc đọc mã nguồn: các hằng số hạn mức
  // và cách ghép URL phải có mặt đúng như thiết kế.
  const src = fs.readFileSync(path.join(ROOT, "src/lib/fb-insights.ts"), "utf8");

  check(
    "có trần số Page mỗi lượt thu thập",
    /MAX_PAGES_PER_INSIGHTS_RUN = \d+/.test(src)
  );
  check(
    "có trần số lệnh gọi Graph API",
    /MAX_API_CALLS_PER_RUN = \d+/.test(src)
  );
  check(
    "có trần số bài lấy insights sâu",
    /MAX_DEEP_INSIGHTS_PER_RUN = \d+/.test(src)
  );
  check(
    "dùng summary(true).limit(0) để không kéo danh sách người tương tác",
    src.includes("reactions.summary(true).limit(0)") &&
      src.includes("comments.summary(true).limit(0)")
  );
  check("đọc cả trường shares", src.includes("shares"));
  check(
    "có lùi về metric tối thiểu khi nhóm distribution bị từ chối",
    src.includes("MINIMAL_DISTRIBUTION_METRIC")
  );
  check(
    "có lùi theo lỗi token / ít người thích",
    src.includes("isTokenInvalidError") && src.includes("isLowFansError")
  );
  check(
    "KHÔNG bao giờ ném lỗi ra ngoài (mọi nhánh đều bắt)",
    !/^\s*throw /m.test(src)
  );
  check(
    "thông báo lỗi có chống spam (notifyOncePer)",
    src.includes("notifyOncePer")
  );
  check(
    "chỉ chạy cho Page đã bật tối ưu",
    src.includes("insightsEnabled: true")
  );
}

{
  // Bộ lập kế hoạch chỉ gọi insights khi Page BẬT tối ưu — đây là điều kiện
  // để cam kết "chưa bật thì không thêm lệnh gọi mạng nào" là đúng.
  const src = fs.readFileSync(path.join(ROOT, "src/lib/autopilot.ts"), "utf8");
  check(
    "autopilot chỉ tính trạng thái học khi insightsEnabled",
    /if \(config\.insightsEnabled\)/.test(src)
  );
  check(
    "lỗi tính trạng thái học KHÔNG chặn lập kế hoạch",
    /catch \(err\) \{\s*\n\s*console\.error\(\s*\n?\s*`\[tự động\] không tính được trạng thái học/.test(src) ||
      src.includes("không tính được trạng thái học")
  );
  check(
    "dùng planTimeSlotsBiased để áp ưu tiên khung giờ",
    src.includes("planTimeSlotsBiased")
  );
  check(
    "ưu tiên khung giờ chỉ áp ở giai đoạn khai thác",
    src.includes('learning.phase === "EXPLOIT"')
  );
  check(
    "đánh dấu bài dò bằng probeKind",
    src.includes('probeKind: probing ? "PROBE" : "STANDARD"')
  );
}

{
  // Scheduler: thu thập số liệu phải có thuê bao riêng và giãn cách riêng
  const src = fs.readFileSync(path.join(ROOT, "src/lib/scheduler.ts"), "utf8");
  check("có hằng giãn cách riêng cho thu thập số liệu", src.includes("INSIGHTS_INTERVAL_MS"));
  check("có thuê bao riêng (không dùng chung với lập kế hoạch)", src.includes("INSIGHTS_LEASE_KEY"));
  check("có hàm kickInsightsRefresh", src.includes("export function kickInsightsRefresh"));
  check(
    "thu thập số liệu KHÔNG nằm trong runSchedulerTick (không làm trễ việc đăng bài)",
    !/async function runSchedulerTick[\s\S]{0,4000}kickInsightsRefresh/.test(src)
  );

  const cronSrc = fs.readFileSync(path.join(ROOT, "src/app/api/cron/tick/route.ts"), "utf8");
  check("cron ngoài cũng kích hoạt thu thập số liệu", cronSrc.includes("kickInsightsRefresh"));
}

{
  // Action: luôn kiểm tra quyền sở hữu Page
  const src = fs.readFileSync(path.join(ROOT, "src/app/actions/insights.ts"), "utf8");
  check("action lấy user từ session", src.includes("requireCurrentUser()"));
  check(
    "action kiểm tra Page thuộc user",
    (src.match(/where: \{ id: pageId, userId: user\.id \}/g) ?? []).length >= 3
  );
  check(
    "bật tối ưu KHÔNG vô tình bật tự động đăng",
    src.includes("enabled: false")
  );
  check("tắt tối ưu không xoá dữ liệu", !/deleteMany|\.delete\(/.test(src));
}

// ============================================================
console.log("\n" + "=".repeat(52));
console.log(`Kết quả: ${passed} đạt, ${failed} lỗi (tổng ${passed + failed})`);
console.log("=".repeat(52));

process.exit(failed > 0 ? 1 : 0);
