// ============================================================
// Kiểm thử tầng biểu đồ của trang Số liệu (/insights).
//
// Chạy: npm run test:insights-charts
//
// KHÔNG cần dev server, KHÔNG cần database, KHÔNG cần React.
// Đây là hai module THUẦN:
//   - src/lib/chart-geometry.ts      — toán học biểu đồ
//   - src/lib/insights-chart-data.ts — dựng series từ dữ liệu thô
//
// VÌ SAO CẦN: biểu đồ sai trục hoặc chia cho 0 sẽ vẽ ra NaN/Infinity — lỗi
// loại này không làm test cũ đỏ (test cũ chỉ kiểm logic học) nhưng làm hỏng
// giao diện. Các ca dưới đây phủ đúng các trường hợp dữ liệu xấu: rỗng, toàn
// null, toàn 0, thiếu ngày xen kẽ, 1 điểm, mẫu số bằng 0.
// ============================================================

import {
  barPct,
  buildPolyline,
  clamp,
  formatCompact,
  formatDecimal,
  formatInt,
  formatSignedPct,
  labelStep,
  maxOf,
  niceMax,
  runsOf,
  scaleX,
  scaleY,
  yTicks,
} from "../src/lib/chart-geometry.ts";
import {
  buildAdjustmentRows,
  buildDirectionBars,
  buildGroupBars,
  buildKpis,
  buildPageDaily,
  buildPillarWeightRows,
  changePctOf,
  confidenceLabel,
  filterPosts,
  shortDay,
  toneOfZ,
  topPostsByEngagement,
} from "../src/lib/insights-chart-data.ts";

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ✔ ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const section = (t) => console.log(`\n▸ ${t}`);

// ============================================================
section("1. chart-geometry: trục, tỉ lệ, an toàn với dữ liệu xấu");
// ============================================================

check("maxOf bỏ qua null/NaN và trả null khi không có số nào", maxOf([null, undefined, NaN]) === null);
check("maxOf lấy đúng số lớn nhất", maxOf([3, null, 9, 2]) === 9);

check("niceMax mảng rỗng → 1 (không chia cho 0)", niceMax([]) === 1);
check("niceMax toàn null → 1", niceMax([null, null]) === 1);
check("niceMax toàn 0 → 1", niceMax([0, 0, 0]) === 1);
check("niceMax toàn số âm → 1", niceMax([-5, -2]) === 1);
check("niceMax là trần không nhỏ hơn giá trị lớn nhất", niceMax([1234]) >= 1234, String(niceMax([1234])));
check("niceMax chia hết cho số khoảng (trục đẹp)", niceMax([1234]) % 4 === 0, String(niceMax([1234])));
check("niceMax giữ nguyên khi đã đẹp", niceMax([1000]) === 1000, String(niceMax([1000])));

check("yTicks trả count+1 mốc (gồm 0 và max)", yTicks(1000, 4).length === 5);
check("yTicks bắt đầu từ 0 và kết thúc ở max", yTicks(1000, 4)[0] === 0 && yTicks(1000, 4)[4] === 1000);
check("yTicks với max = 0 vẫn an toàn", yTicks(0, 4).every((t) => Number.isFinite(t)));

check("scaleY đỉnh (max) nằm ở 0", scaleY(1000, 1000, 100) === 0);
check("scaleY đáy (0) nằm ở height", scaleY(0, 1000, 100) === 100);
check("scaleY max = 0 không trả NaN", Number.isFinite(scaleY(0, 0, 100)));
check("scaleY vượt max bị kẹp trong khung", scaleY(9999, 1000, 100) === 0);

check("scaleX điểm đầu ở 0", scaleX(0, 14, 280) === 0);
check("scaleX điểm cuối ở đúng bề rộng", scaleX(13, 14, 280) === 280);
check("scaleX với 1 điểm → giữa trục", scaleX(0, 1, 280) === 140);
check("scaleX với count = 0 không chia cho 0", Number.isFinite(scaleX(0, 0, 280)));

check("buildPolyline mảng rỗng → chuỗi rỗng", buildPolyline([]) === "");
check(
  "buildPolyline 3 điểm ra 3 lệnh M/L",
  (buildPolyline([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }]).match(/[ML]/g) ?? []).length === 3
);
check("buildPolyline 1 điểm vẫn hợp lệ", buildPolyline([{ x: 5, y: 6 }]) === "M5 6");

check("runsOf toàn null → rỗng", runsOf([null, null]).length === 0);
check("runsOf null xen giữa tạo 2 đoạn", runsOf([1, null, 2]).length === 2);
check("runsOf null đầu/cuối không tính là đoạn", runsOf([null, 1, 2, null]).length === 1);
check("runsOf giữ đúng chỉ số gốc", JSON.stringify(runsOf([null, 1, 2, null, 3])) === "[[1,2],[4]]");

check("labelStep 14 điểm / tối đa 7 nhãn → 2", labelStep(14, 7) === 2);
check("labelStep khi đủ chỗ → 1", labelStep(5, 7) === 1);
check("labelStep không bao giờ trả 0", labelStep(30, 7) >= 1);

check("barPct max = 0 → 0 (không chia cho 0)", barPct(50, 0) === 0);
check("barPct value null → 0", barPct(null, 100) === 0);
check("barPct value âm → 0", barPct(-5, 100) === 0);
check("barPct phần tử lớn nhất → 100", barPct(100, 100) === 100);
check("barPct kẹp trên ở 100 khi vượt max", barPct(500, 100) === 100);

check("clamp kẹp đúng khoảng", clamp(15, 0, 10) === 10);
check("clamp NaN → min", clamp(NaN, 2, 10) === 2);

check("formatInt phân cách nghìn kiểu Việt Nam", formatInt(1234567) === "1.234.567", formatInt(1234567));
check("formatInt null → —", formatInt(null) === "—");
check("formatDecimal dùng dấu phẩy", formatDecimal(12.34, 1) === "12,3", formatDecimal(12.34, 1));
check("formatSignedPct thêm dấu + khi tăng", formatSignedPct(12.4) === "+12%", formatSignedPct(12.4));
check("formatSignedPct giữ dấu - khi giảm", formatSignedPct(-7.6) === "-8%", formatSignedPct(-7.6));
check("formatSignedPct null → —", formatSignedPct(null) === "—");
check("formatCompact dưới 1000 giữ nguyên", formatCompact(999) === "999");
check("formatCompact nghìn", formatCompact(1500) === "1,5K", formatCompact(1500));
check("formatCompact triệu", formatCompact(2_400_000) === "2,4M", formatCompact(2_400_000));

// ============================================================
section("2. insights-chart-data: đảo thứ tự, gom nhóm, mẫu số 0");
// ============================================================

const snap = (over = {}) => ({
  dayKey: "2026-09-01",
  fans: null,
  follows: null,
  pageViewsTotal: null,
  mediaView: null,
  postEngagements: null,
  ...over,
});

check("shortDay cắt đúng ngày/tháng", shortDay("2026-09-30") === "30/09", shortDay("2026-09-30"));
check("changePctOf kỳ trước = 0 → null (không ∞%)", changePctOf(10, 0) === null);
check("changePctOf tính đúng phần trăm", changePctOf(150, 100) === 50);
check("confidenceLabel dịch đủ 4 mức", confidenceLabel("HIGH") === "cao" && confidenceLabel("NONE") === "chưa có");

// snapshots truyền vào theo thứ tự MỚI NHẤT TRƯỚC (đúng như insights-view)
const dailyDesc = [
  snap({ dayKey: "2026-09-03", pageViewsTotal: 300, mediaView: null, postEngagements: 30 }),
  snap({ dayKey: "2026-09-02", pageViewsTotal: 200, mediaView: 20, postEngagements: 10 }),
  snap({ dayKey: "2026-09-01", pageViewsTotal: 100, mediaView: 10, postEngagements: 5 }),
];
const daily = buildPageDaily(dailyDesc);

check("buildPageDaily đảo thành cũ → mới", daily.labels.join(",") === "01/09,02/09,03/09", daily.labels.join(","));
check("buildPageDaily giữ nguyên vị trí giá trị null", daily.cards[1].values[2] === null);
check("buildPageDaily tính % so với đầu kỳ", Math.round(daily.cards[0].changePct) === 200, String(daily.cards[0].changePct));
check("buildPageDaily: chỉ số toàn null → hasData false", daily.cards[3].hasData === false);
check("buildPageDaily: chỉ số có số → hasData true", daily.cards[0].hasData === true);
check("buildPageDaily mảng rỗng vẫn trả 4 thẻ", buildPageDaily([]).cards.length === 4);

const kpiView = {
  posts: [
    { id: "p1", hook: "a", publishedAt: "2026-09-01T00:00:00.000Z", origin: "AUTOPILOT", probeKind: "STANDARD", engagement: 100, distribution: 1000, interactionRate: 0.1, hasInsight: true },
    { id: "p2", hook: "b", publishedAt: "2026-09-02T00:00:00.000Z", origin: "MANUAL", probeKind: "STANDARD", engagement: 50, distribution: null, interactionRate: null, hasInsight: true },
  ],
  snapshots: [snap({ dayKey: "2026-09-01", pageViewsTotal: 10, postEngagements: 3 })],
  autoPilotPublished: 1,
  missingInsightCount: 0,
};
const kpiOff = buildKpis(kpiView, null);
check("buildKpis khi tắt tối ưu vẫn đủ 4 thẻ", kpiOff.length === 4);
check("buildKpis khi tắt tối ưu tính tương tác TB đúng", kpiOff[2].value === "75", kpiOff[2].value);

const kpiOn = buildKpis(kpiView, {
  phaseLabel: "Đang dò tìm hướng đi",
  confidence: "LOW",
  trend7d: { recentAvg: 12.5, previousAvg: 10, changePct: 25 },
  progress: { phase: "PROBE", probeUsed: 3, probeBudget: 12, probeExhausted: false, missingForExploit: 5, explorationRate: 0.2, sampleSize: 3 },
});
check("buildKpis khi bật tối ưu đủ 4 thẻ", kpiOn.length === 4);
check("buildKpis bật tối ưu: xu hướng tăng → tone up", kpiOn[0].tone === "up", kpiOn[0].tone);
check("buildKpis bật tối ưu: tiếp cận TB trên 1 bài", kpiOn[2].value === "1.000", kpiOn[2].value);
check("buildKpis bật tối ưu: tiến độ dò hiện đúng", kpiOn[3].sub.includes("3/12"), kpiOn[3].sub);

const group = [
  { key: "a", label: "A", posts: 5, share: 0.5, avgScore: 20, avgEngagement: 5, avgDistribution: 100, z: 0.9, changePct: 10 },
  { key: "b", label: "B", posts: 3, share: 0.3, avgScore: 10, avgEngagement: 2, avgDistribution: 50, z: -0.8, changePct: null },
];
const bars = buildGroupBars(group);
check("buildGroupBars: hướng cao nhất dài 100%", bars[0].barPct === 100);
check("buildGroupBars: hướng thấp hơn đúng tỉ lệ", bars[1].barPct === 50, String(bars[1].barPct));
check("buildGroupBars: map z → màu pos/neg", bars[0].tone === "pos" && bars[1].tone === "neg");
check("buildGroupBars: nhóm rỗng → rỗng", buildGroupBars([]).length === 0);
check("buildGroupBars: nhóm toàn điểm 0 không chia cho 0", buildGroupBars([{ ...group[0], avgScore: 0 }])[0].barPct === 0);

check("toneOfZ: |z| < 0,4 → flat", toneOfZ(0.2) === "flat");

const dirs = buildDirectionBars([
  { kind: "PILLAR", value: "p1", label: "Trụ cột 1", sampleSize: 4, avgScore: 30, changePct: 5, status: "RISING", estLifeDays: 10, recommendation: "tăng" },
  { kind: "PILLAR", value: "p2", label: "Trụ cột 2", sampleSize: 0, avgScore: 99, changePct: null, status: "EXPLORING", estLifeDays: null, recommendation: "theo dõi" },
]);
check("buildDirectionBars bỏ hướng chưa có bài", dirs.length === 1, String(dirs.length));
check("buildDirectionBars giữ kind để hiển thị loại", dirs[0].kind === "PILLAR" && dirs[0].barPct === 100);

const weights = buildPillarWeightRows([
  { name: "A", original: 2, effective: 2.6 },
  { name: "B", original: 2, effective: 1.4 },
]);
check("buildPillarWeightRows phát hiện trụ cột bị đổi", weights[0].changed && weights[1].changed);
check("buildPillarWeightRows giữ nguyên khi không đổi", !buildPillarWeightRows([{ name: "A", original: 1, effective: 1 }])[0].changed);
check("buildPillarWeightRows không chia cho 0 khi mọi trọng số = 0", buildPillarWeightRows([{ name: "A", original: 0, effective: 0 }])[0].primaryPct === 0);

const adj = buildAdjustmentRows([
  { id: "a1", kindLabel: "Khung giờ", baselineMedian: 10, baselineSamples: 8, resultMedian: 12, resultSamples: 6, status: "KEPT", reason: null, appliedAt: "2026-09-01T00:00:00.000Z", lockedUntil: null },
  { id: "a2", kindLabel: "Trụ cột", baselineMedian: 10, baselineSamples: 8, resultMedian: null, resultSamples: null, status: "PENDING", reason: "đang chờ", appliedAt: "2026-09-02T00:00:00.000Z", lockedUntil: "2026-09-20T00:00:00.000Z" },
]);
check("buildAdjustmentRows dịch trạng thái sang tiếng Việt", adj[0].statusLabel === "Giữ" && adj[1].statusLabel === "Đang kiểm chứng");
check("buildAdjustmentRows: chưa có kết quả → pct 0, an toàn", adj[1].secondaryPct === 0 && adj[1].result === null);

const posts = [
  { id: "1", origin: "AUTOPILOT", engagement: 10, publishedAt: "2026-09-01T00:00:00.000Z" },
  { id: "2", origin: "MANUAL", engagement: 30, publishedAt: "2026-09-02T00:00:00.000Z" },
  { id: "3", origin: "AUTOPILOT", engagement: 20, publishedAt: "2026-09-03T00:00:00.000Z" },
];
check("filterPosts all giữ nguyên số bài", filterPosts(posts, "all").length === 3);
check("filterPosts auto chỉ lấy bài AutoPilot", filterPosts(posts, "auto").every((p) => p.origin === "AUTOPILOT"));
check("filterPosts manual chỉ lấy bài soạn tay", filterPosts(posts, "manual").length === 1);
check("topPostsByEngagement sắp giảm dần", topPostsByEngagement(posts, 2)[0].engagement === 30);
check("topPostsByEngagement tôn trọng limit", topPostsByEngagement(posts, 1).length === 1);

// ============================================================
console.log(`Kết quả: ${passed} đạt, ${failed} lỗi (tổng ${passed + failed})`);
console.log("=".repeat(52));

process.exit(failed > 0 ? 1 : 0);
