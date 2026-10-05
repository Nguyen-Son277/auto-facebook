// ============================================================
// Kiểm thử logic THUẦN của chế độ tự động (src/lib/autopilot-plan.ts).
//
// Chạy: npm run test:plan
//
// Không cần dev server, không cần database, không cần mock — nên chạy được
// bất cứ lúc nào và không đụng tới dev.db.
// ============================================================

import {
  aiTimeoutMs,
  boundedTimeout,
  clampPlanAheadDays,
  clampPostsPerDay,
  clampVideoPercent,
  deadlineExceeded,
  decideMediaKind,
  hasRoomForPost,
  isBlockingPlanError,
  makeDeadline,
  orderDaysByNeed,
  remainingBudgetMs,
  shouldAbortPage,
  videoQuotaForDay,
  formatHm,
  isoDayOf,
  parseDaysOfWeek,
  parseHm,
  parseServiceAreas,
  pickPillar,
  pickProduct,
  pickServiceArea,
  detectPostProduct,
  splitListItems,
  planTimeSlots,
  startOfDay,
  DEFAULT_AI_CALL_TIMEOUT_MS,
  MIN_MEDIA_BUDGET_MS,
  MIN_POST_BUDGET_MS,
  MAX_CONSECUTIVE_SLOT_FAILURES,
} from "../src/lib/autopilot-plan.ts";

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

/** Hàm "ngẫu nhiên" tất định để kết quả test lặp lại được. */
function seededRandom(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const minutesOf = (d) => d.getHours() * 60 + d.getMinutes();

// ============================================================
section("Đọc và ghi giờ");
// ============================================================

check("parseHm('07:30') = 450", parseHm("07:30") === 450);
check("parseHm('00:00') = 0", parseHm("00:00") === 0);
check("parseHm('23:59') = 1439", parseHm("23:59") === 1439);
check("parseHm('7:05') chấp nhận 1 chữ số giờ", parseHm("7:05") === 425);
check("parseHm('24:00') bị từ chối", parseHm("24:00") === null);
check("parseHm('12:60') bị từ chối", parseHm("12:60") === null);
check("parseHm('abc') bị từ chối", parseHm("abc") === null);
check("parseHm('') bị từ chối", parseHm("") === null);
check("formatHm(450) = '07:30'", formatHm(450) === "07:30");
check("formatHm(0) = '00:00'", formatHm(0) === "00:00");
check("formatHm khớp ngược với parseHm", formatHm(parseHm("21:45")) === "21:45");

// ============================================================
section("Thứ trong tuần (1 = Thứ Hai … 7 = Chủ Nhật)");
// ============================================================

// 2026-03-16 là Thứ Hai
check("Thứ Hai = 1", isoDayOf(new Date(2026, 2, 16)) === 1);
check("Thứ Bảy = 6", isoDayOf(new Date(2026, 2, 21)) === 6);
check("Chủ Nhật = 7 (không phải 0)", isoDayOf(new Date(2026, 2, 22)) === 7);

check("parseDaysOfWeek('1,3,5') = [1,3,5]", parseDaysOfWeek("1,3,5").join() === "1,3,5");
check("parseDaysOfWeek sắp xếp lại", parseDaysOfWeek("5,1,3").join() === "1,3,5");
check("parseDaysOfWeek bỏ trùng", parseDaysOfWeek("1,1,2").join() === "1,2");
check("parseDaysOfWeek bỏ giá trị sai", parseDaysOfWeek("1,9,0,abc,3").join() === "1,3");
check("parseDaysOfWeek rỗng → cả tuần", parseDaysOfWeek("").join() === "1,2,3,4,5,6,7");

check(
  "startOfDay cắt về 00:00:00",
  (() => {
    const d = startOfDay(new Date(2026, 2, 16, 17, 45, 30, 500));
    return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0;
  })()
);

// ============================================================
section("Chia khung giờ thành slot đăng bài");
// ============================================================

const day = new Date(2026, 2, 16); // Thứ Hai
const base = { postsPerDay: 3, windowStart: "07:00", windowEnd: "21:00", minGapMinutes: 120 };

const slots3 = planTimeSlots(base, day, null, seededRandom(1));
check("3 bài/ngày → đúng 3 slot", slots3.length === 3, `nhận ${slots3.length}`);
check(
  "mọi slot nằm trong khung 07:00–21:00",
  slots3.every((s) => minutesOf(s) >= 420 && minutesOf(s) <= 1260),
  slots3.map((s) => formatHm(minutesOf(s))).join(", ")
);
check(
  "các slot theo thứ tự tăng dần",
  slots3.every((s, i) => i === 0 || s.getTime() > slots3[i - 1].getTime())
);
check(
  "khoảng cách giữa 2 bài ≥ 120 phút",
  slots3.every((s, i) => i === 0 || minutesOf(s) - minutesOf(slots3[i - 1]) >= 120),
  slots3.map((s) => formatHm(minutesOf(s))).join(", ")
);
check("slot đúng ngày được yêu cầu", slots3.every((s) => s.getDate() === 16 && s.getMonth() === 2));

const slots1 = planTimeSlots({ ...base, postsPerDay: 1 }, day, null, seededRandom(7));
check("1 bài/ngày → đúng 1 slot", slots1.length === 1);

const slots8 = planTimeSlots(
  { postsPerDay: 8, windowStart: "06:00", windowEnd: "22:00", minGapMinutes: 30 },
  day,
  null,
  seededRandom(3)
);
check("8 bài/ngày khung rộng → đủ 8 slot", slots8.length === 8, `nhận ${slots8.length}`);
check(
  "8 bài vẫn giữ khoảng cách ≥ 30 phút",
  slots8.every((s, i) => i === 0 || minutesOf(s) - minutesOf(slots8[i - 1]) >= 30)
);

// Khung hẹp: 08:00–09:00 = 60 phút, giãn cách 120 phút → chỉ nhét vừa 1 bài
const narrow = planTimeSlots(
  { postsPerDay: 5, windowStart: "08:00", windowEnd: "09:00", minGapMinutes: 120 },
  day,
  null,
  seededRandom(5)
);
check("khung quá hẹp → tự giảm số bài, không xếp chồng", narrow.length === 1, `nhận ${narrow.length}`);

const inverted = planTimeSlots({ ...base, windowStart: "21:00", windowEnd: "07:00" }, day, null, seededRandom(2));
check("khung giờ ngược (21:00→07:00) → không tạo slot nào", inverted.length === 0);

const zeroSpan = planTimeSlots({ ...base, windowStart: "09:00", windowEnd: "09:00" }, day, null, seededRandom(2));
check("khung giờ rỗng → không tạo slot nào", zeroSpan.length === 0);

// notBefore: mô phỏng "đang là 15:00 hôm nay"
const afternoon = new Date(2026, 2, 16, 15, 0, 0, 0);
const todaySlots = planTimeSlots(base, day, afternoon, seededRandom(1));
check(
  "bỏ qua slot đã trôi qua trong ngày hôm nay",
  todaySlots.every((s) => s.getTime() >= afternoon.getTime()),
  todaySlots.map((s) => formatHm(minutesOf(s))).join(", ")
);
check("slot còn lại ít hơn cả ngày", todaySlots.length < slots3.length, `${todaySlots.length} vs ${slots3.length}`);

const lateNight = planTimeSlots(base, day, new Date(2026, 2, 16, 23, 30), seededRandom(1));
check("đã quá khung giờ → không tạo slot nào cho hôm nay", lateNight.length === 0);

// Tất định: cùng seed → cùng kết quả
const a = planTimeSlots(base, day, null, seededRandom(99));
const b = planTimeSlots(base, day, null, seededRandom(99));
check("cùng seed cho ra cùng kết quả", a.map(minutesOf).join() === b.map(minutesOf).join());

// Khác seed → giờ đăng khác nhau (không lặp y hệt mỗi ngày)
const c = planTimeSlots(base, day, null, seededRandom(1234));
check("seed khác → giờ đăng khác (không rập khuôn)", a.map(minutesOf).join() !== c.map(minutesOf).join());

// ============================================================
section("Xoay vòng trụ cột nội dung theo tỉ trọng");
// ============================================================

const pillars = [
  { id: "a", name: "Giới thiệu sản phẩm", weight: 40, position: 0, goal: "sales" },
  { id: "b", name: "Chia sẻ kiến thức", weight: 25, position: 1, goal: "education" },
  { id: "c", name: "Khách hàng thực tế", weight: 20, position: 2, goal: "awareness" },
  { id: "d", name: "Tương tác", weight: 15, position: 3, goal: "engagement" },
];

check("không có trụ cột → trả null", pickPillar([], []) === null);
check("một trụ cột → luôn chọn nó", pickPillar([pillars[0]], []).id === "a");
check("một trụ cột → vẫn chọn dù vừa dùng", pickPillar([pillars[0]], ["Giới thiệu sản phẩm"]).id === "a");

// Mô phỏng 200 lượt chọn, tích lũy lịch sử đầy đủ
const history = [];
const counts = new Map();
for (let i = 0; i < 200; i++) {
  const p = pickPillar(pillars, history);
  history.unshift(p.name);
  counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
}

const pct = (name) => ((counts.get(name) ?? 0) / 200) * 100;
for (const p of pillars) {
  const got = pct(p.name);
  check(
    `"${p.name}" đạt ~${p.weight}% (thực tế ${got.toFixed(1)}%)`,
    Math.abs(got - p.weight) <= 5,
    `lệch ${Math.abs(got - p.weight).toFixed(1)} điểm %`
  );
}

check("mọi trụ cột đều được dùng", pillars.every((p) => (counts.get(p.name) ?? 0) > 0));

// Không lặp lại ngay lập tức
let consecutive = 0;
for (let i = 1; i < history.length; i++) {
  if (history[i] === history[i - 1]) consecutive++;
}
check("không bao giờ chọn cùng trụ cột 2 lần liên tiếp", consecutive === 0, `có ${consecutive} lần lặp`);

// Mọi trụ cột xuất hiện sớm, không để trụ cột nào bị bỏ quên
const firstTen = history.slice(-10);
check("4 trụ cột đều xuất hiện trong 10 lượt đầu", new Set(firstTen).size === 4, `chỉ có ${new Set(firstTen).size}`);

// Trụ cột bị tắt không được chọn (mô phỏng: chỉ truyền vào trụ cột đang bật)
const onlyTwo = pillars.slice(0, 2);
const twoHistory = [];
for (let i = 0; i < 20; i++) {
  const p = pickPillar(onlyTwo, twoHistory);
  twoHistory.unshift(p.name);
}
check("chỉ chọn trong danh sách được truyền vào", twoHistory.every((n) => n === pillars[0].name || n === pillars[1].name));

// Tỉ trọng 0 không làm vỡ phép chia
const zeroWeight = [
  { id: "x", name: "X", weight: 0, position: 0, goal: "sales" },
  { id: "y", name: "Y", weight: 50, position: 1, goal: "sales" },
];
check("tỉ trọng 0 không gây chia cho 0", pickPillar(zeroWeight, []) !== null);

// ============================================================
section("Giới hạn thông số người dùng nhập");
// ============================================================

check("số bài/ngày 0 → nâng lên 1", clampPostsPerDay(0) === 1);
check("số bài/ngày 99 → hạ xuống 10", clampPostsPerDay(99) === 10);
check("số bài/ngày -5 → nâng lên 1", clampPostsPerDay(-5) === 1);
check("số bài/ngày 3.7 → làm tròn thành 4", clampPostsPerDay(3.7) === 4);
check("số bài/ngày NaN → mặc định 2", clampPostsPerDay(NaN) === 2);
check("lên kế hoạch trước 0 ngày → nâng lên 1", clampPlanAheadDays(0) === 1);
check("lên kế hoạch trước 30 ngày → hạ xuống 7", clampPlanAheadDays(30) === 7);

// ============================================================
// TRÁNH XẾP CHỒNG LÊN BÀI ĐÃ CÓ
//
// Lỗi thật đã gặp: bộ lập kế hoạch chạy lượt hai cho cùng một ngày và chèn
// bài vào giữa các bài của lượt đầu, phá vỡ khoảng cách tối thiểu.
// ============================================================
console.log("\n— Tránh xếp chồng lên bài đã có —");

{
  const cfg = {
    windowStart: "08:00",
    windowEnd: "20:00",
    postsPerDay: 3,
    minGapMinutes: 60,
  };
  const day = new Date(2026, 0, 15);

  // Lượt 1: chưa có bài nào
  const first = planTimeSlots(cfg, day, null, () => 0.5);
  check("lượt đầu xếp được bài", first.length > 0);

  // Lượt 2: truyền giờ của lượt 1 vào → không được trùng/sát
  const takenMs = first.map((d) => d.getTime());
  const second = planTimeSlots(cfg, day, null, () => 0.5, takenMs);

  const tooClose = second.filter((d) =>
    takenMs.some((t) => Math.abs(t - d.getTime()) < 60 * 60 * 1000)
  );
  check(
    "lượt hai KHÔNG xếp bài sát bài đã có",
    tooClose.length === 0,
    `${tooClose.length} slot quá gần`
  );
}

{
  // Trường hợp biên: ngày đã kín thì không được trả slot nào
  const cfg = { windowStart: "08:00", windowEnd: "10:00", postsPerDay: 2, minGapMinutes: 60 };
  const day = new Date(2026, 0, 15);
  const full = planTimeSlots(cfg, day, null, () => 0.5);
  const again = planTimeSlots(cfg, day, null, () => 0.5, full.map((d) => d.getTime()));
  check("ngày đã kín → không xếp thêm bài nào", again.length === 0, `còn ${again.length} slot`);
}

// ============================================================
// XEN KẼ ẢNH / VIDEO
// ============================================================
console.log("\n— Xen kẽ ảnh/video —");

check("tỉ lệ video âm → 0", clampVideoPercent(-10) === 0);
check("tỉ lệ video 150 → 100", clampVideoPercent(150) === 100);
check("tỉ lệ video NaN → mặc định 25", clampVideoPercent(NaN) === 25);

check("4 bài, 25% video → hạn ngạch 1", videoQuotaForDay(4, 25) === 1);
check("4 bài, 50% video → hạn ngạch 2", videoQuotaForDay(4, 50) === 2);
check("4 bài, 0% video → hạn ngạch 0", videoQuotaForDay(4, 0) === 0);
check("4 bài, 100% video → hạn ngạch 4", videoQuotaForDay(4, 100) === 4);
check(
  "3 bài, 10% video → vẫn đảm bảo ít nhất 1 (đặt >0 mà không bao giờ có thì vô nghĩa)",
  videoQuotaForDay(3, 10) === 1
);
check("hạn ngạch không vượt quá số bài", videoQuotaForDay(2, 90) <= 2);

check(
  "IMAGE_ONLY luôn trả ảnh dù random thế nào",
  [0, 0.5, 0.99].every((r) => decideMediaKind("IMAGE_ONLY", 0, 4, 50, 0, () => r) === "IMAGE")
);
check(
  "VIDEO_ONLY luôn trả video",
  [0, 0.5, 0.99].every((r) => decideMediaKind("VIDEO_ONLY", 0, 4, 50, 0, () => r) === "VIDEO")
);
check(
  "MIXED: dùng hết hạn ngạch video rồi → chuyển sang ảnh",
  decideMediaKind("MIXED", 2, 4, 25, 1, () => 0) === "IMAGE"
);
check(
  "MIXED: số bài còn lại vừa đủ lấp hạn ngạch → buộc phải là video",
  decideMediaKind("MIXED", 3, 4, 25, 0, () => 0.99) === "VIDEO"
);

// Tỉ lệ phải hội tụ đúng qua nhiều ngày — đây là điều người dùng thật sự thấy
{
  const POSTS = 4;
  const PCT = 50;
  const DAYS = 200;
  let videos = 0;
  let rngState = 12345;
  // LCG để kết quả tái lập được, không phụ thuộc Math.random
  const rng = () => {
    rngState = (rngState * 1103515245 + 12345) % 2147483648;
    return rngState / 2147483648;
  };

  for (let d = 0; d < DAYS; d++) {
    let used = 0;
    for (let i = 0; i < POSTS; i++) {
      const kind = decideMediaKind("MIXED", i, POSTS, PCT, used, rng);
      if (kind === "VIDEO") {
        used++;
        videos++;
      }
    }
    // Mỗi ngày phải đúng hạn ngạch, không hơn không kém
    if (used !== videoQuotaForDay(POSTS, PCT)) {
      check(`ngày ${d}: số video đúng hạn ngạch`, false, `được ${used}`);
      break;
    }
  }

  const actualPct = (videos / (POSTS * DAYS)) * 100;
  check(
    `qua ${DAYS} ngày, tỉ lệ video thực tế ≈ ${PCT}% (đo được ${actualPct.toFixed(1)}%)`,
    Math.abs(actualPct - PCT) < 1
  );
}

// Không được dồn cục: với 25% và 4 bài/ngày, mỗi ngày đúng 1 video
{
  let allOk = true;
  for (let d = 0; d < 50; d++) {
    let used = 0;
    for (let i = 0; i < 4; i++) {
      if (decideMediaKind("MIXED", i, 4, 25, used, Math.random) === "VIDEO") used++;
    }
    if (used !== 1) {
      allOk = false;
      break;
    }
  }
  check("25% + 4 bài/ngày → ngày nào cũng đúng 1 video, không dồn cục", allOk);
}

// ============================================================
// Thứ tự ưu tiên ngày + chính sách khi lỗi
// ============================================================

/** Ngày UTC để test thuần — giá trị tuyệt đối, không phụ thuộc máy chạy. */
const utcDay = (iso) => new Date(`${iso}T00:00:00.000Z`);
const dayOfMonth = (x) => x.day.toISOString().slice(8, 10);

// Ngày càng TRỐNG càng lên trước — đây là cơ chế trám lại ngày đã bị xoá bài.
{
  const ordered = orderDaysByNeed(
    [
      { day: utcDay("2026-09-14"), existing: 2 },
      { day: utcDay("2026-09-15"), existing: 0 },
      { day: utcDay("2026-09-16"), existing: 1 },
    ],
    2
  );
  check(
    "ngày trống nhất được trám trước",
    ordered.map((x) => x.existing).join(",") === "0,1,2",
    ordered.map((x) => x.existing).join(",")
  );
  check("không mất ngày nào khi sắp xếp", ordered.length === 3);
}

// Bằng nhau về mức thiếu → giữ thứ tự thời gian
{
  const ordered = orderDaysByNeed(
    [
      { day: utcDay("2026-09-16"), existing: 0 },
      { day: utcDay("2026-09-14"), existing: 0 },
      { day: utcDay("2026-09-15"), existing: 0 },
    ],
    2
  );
  check(
    "hoà thì xếp theo thứ tự thời gian",
    ordered.map(dayOfMonth).join(",") === "14,15,16",
    ordered.map(dayOfMonth).join(",")
  );
}

// Nhờ "trám trước", ngày bị xoá trắng không còn bị ngày khác chiếm lượt
{
  const ordered = orderDaysByNeed(
    [
      { day: utcDay("2026-09-14"), existing: 2 },
      { day: utcDay("2026-09-15"), existing: 2 },
      { day: utcDay("2026-09-16"), existing: 0 },
    ],
    2
  );
  check("ngày bị xoá hết bài (16/09) lên đầu hàng đợi", dayOfMonth(ordered[0]) === "16");
}

// Không sửa mảng gốc, và giữ nguyên các trường phụ
{
  const src = [
    { day: utcDay("2026-09-14"), existing: 2, needed: 0, isToday: true },
    { day: utcDay("2026-09-15"), existing: 0, needed: 2, isToday: false },
  ];
  const ordered = orderDaysByNeed(src, 2);
  check("không sửa mảng gốc", src[0].existing === 2);
  check("giữ nguyên trường phụ (needed, isToday)", ordered[0].needed === 2 && ordered[0].isToday === false);
}

// postsPerDay = 0 không được gây chia cho 0
{
  const ordered = orderDaysByNeed(
    [
      { day: utcDay("2026-09-14"), existing: 3 },
      { day: utcDay("2026-09-15"), existing: 1 },
    ],
    0
  );
  check("postsPerDay = 0 vẫn sắp xếp được (không chia cho 0)", ordered.length === 2);
}

// Chính sách lỗi: 1 lỗi thoáng qua KHÔNG được bỏ cả ngày
check("0 lỗi → chưa bỏ Page", shouldAbortPage(0) === false);
check("1 lỗi → vẫn thử tiếp (không xoá trắng ngày)", shouldAbortPage(1) === false);
check("2 lỗi liên tiếp → bỏ Page trong lượt này", shouldAbortPage(2) === true);
check("ngưỡng bỏ Page đúng bằng 2", MAX_CONSECUTIVE_SLOT_FAILURES === 2);

// ============================================================
section("Địa bàn hoạt động (xoay vòng)");
// ============================================================

check("danh sách rỗng → tắt tính năng (null)", pickServiceArea([], []) === null);
check("một địa bàn → luôn dùng địa bàn đó", pickServiceArea(["Dĩ An"], []) === "Dĩ An");

{
  // Vòng lặp thật của AutoPilot: chọn rồi ghi lại vào lịch sử
  const areas = ["Thủ Dầu Một", "Dĩ An", "Thuận An"];
  const recent = [];
  const picked = [];
  for (let i = 0; i < 4; i++) {
    const a = pickServiceArea(areas, recent);
    picked.push(a);
    recent.unshift(a);
  }
  check("phủ đủ 3 địa bàn trong 3 bài đầu", new Set(picked.slice(0, 3)).size === 3, picked.join(" → "));
  check(
    "không nhắm trùng bài liền trước",
    picked.every((a, i) => i === 0 || a !== picked[i - 1]),
    picked.join(" → ")
  );
}

check("ưu tiên địa bàn ít dùng nhất", pickServiceArea(["A", "B", "C"], ["A", "A", "B"]) === "C");
check(
  "so trùng lịch sử bỏ qua hoa/thường",
  pickServiceArea(["Dĩ An", "Thủ Dầu Một"], ["dĩ an"]) === "Thủ Dầu Một"
);

// parseServiceAreas: bỏ dòng trống, khử trùng, chấp nhận cả dấu phẩy
{
  const r = parseServiceAreas("Bình Dương\n\nDĩ An, Binh Duong");
  check("bỏ dòng trống + khử trùng + tách dấu phẩy", r.length === 2, JSON.stringify(r));
}
check("đầu vào rỗng → mảng rỗng", parseServiceAreas(null).length === 0);

// ============================================================
// SẢN PHẨM: đọc tên có ngoặc đơn + xoay vòng + suy ra từ nội dung bài
// ============================================================

section("Đọc danh sách: dấu phẩy bên trong một mục KHÔNG phải dấu phân cách");
// Bối cảnh: tên sản phẩm thật hay kèm ngoặc liệt kê biến thể hoặc liệt kê chất
// liệu. Bản cũ cắt thẳng theo dấu phẩy nên chẻ chúng thành các mục rác, và bài
// đăng thật ra chuỗi cụt "Rèm vải buông (1 lớp ở Quận 9 loại nào tốt?".

{
  const raw = "Rèm vải buông (1 lớp, 2 lớp, voan)\nRèm Roman (rèm xếp lớp)";
  const items = splitListItems(raw);
  check("giữ nguyên tên có ngoặc đơn", items[0] === "Rèm vải buông (1 lớp, 2 lớp, voan)", JSON.stringify(items));
  check("vẫn tách theo xuống dòng", items[1] === "Rèm Roman (rèm xếp lớp)");

  const areas = parseServiceAreas("Bình Dương, Thủ Dầu Một; Dĩ An");
  check("dấu phẩy ngoài ngoặc vẫn tách", areas.length === 3, JSON.stringify(areas));
  check(
    "không còn mảnh cụt từ ngoặc đơn",
    !areas.some((a) => a.includes("("))
  );
}

{
  // "Rèm tre, nứa, trúc" là MỘT sản phẩm (ba chất liệu), không phải ba sản phẩm.
  const items = parseServiceAreas("Rèm tre, nứa, trúc\nRèm ngăn lạnh PVC");
  check(
    "chữ thường sau dấu phẩy = mô tả nối tiếp, KHÔNG tách",
    items.length === 2 && items[0] === "Rèm tre, nứa, trúc",
    JSON.stringify(items)
  );
  check(
    "chữ HOA sau dấu phẩy = mục mới, CÓ tách",
    parseServiceAreas("Rèm cuốn, Rèm cầu vồng").length === 2
  );
  check(
    "chữ số sau dấu phẩy = mục mới, CÓ tách",
    parseServiceAreas("Khu 1, 2, 3").length === 3
  );
  check(
    "dấu phẩy đứng trước dấu xuống dòng bị bỏ",
    parseServiceAreas("Dĩ An,\nThuận An")[0] === "Dĩ An"
  );
}

section("pickProduct: xoay vòng sản phẩm (chống trùng chủ thể)");
// Vì sao quan trọng: đây là chốt chặn tất định để chuỗi bài không quay về đúng
// một sản phẩm rồi chỉ đổi khu vực — nguyên nhân Facebook giảm phân phối.

{
  const products = ["Rèm vải buông", "Rèm cầu vồng", "Rèm cuốn"];
  check("không có sản phẩm → null", pickProduct([], []) === null);
  check("một sản phẩm → luôn chọn sản phẩm đó", pickProduct(["Rèm cuốn"], []) === "Rèm cuốn");
  check(
    "chưa dùng gì → chọn sản phẩm đầu",
    pickProduct(products, []) === "Rèm vải buông"
  );
  check(
    "sản phẩm vừa dùng bị tránh",
    pickProduct(products, ["Rèm vải buông"]) === "Rèm cầu vồng"
  );
  check(
    "chọn sản phẩm ít dùng nhất",
    pickProduct(products, ["Rèm vải buông", "Rèm vải buông", "Rèm cầu vồng"]) === "Rèm cuốn"
  );
  check(
    "so trùng bỏ qua hoa/thường",
    pickProduct(["Rèm Cuốn", "Rèm cầu vồng"], ["rèm cuốn"]) === "Rèm cầu vồng"
  );

  // Mô phỏng một dãy bài: 7 bài liên tiếp trên 3 sản phẩm không được lặp liền kề.
  let recent = [];
  const seq = [];
  for (let i = 0; i < 7; i++) {
    const p = pickProduct(products, recent);
    seq.push(p);
    recent = [p, ...recent];
  }
  check(
    "7 bài liên tiếp không lặp sản phẩm liền trước",
    seq.every((p, i) => i === 0 || p !== seq[i - 1]),
    JSON.stringify(seq)
  );
  check(
    "7 bài trải đều cả 3 sản phẩm",
    new Set(seq).size === 3,
    JSON.stringify(seq)
  );
}

section("detectPostProduct: suy ra sản phẩm từ nội dung đã đăng");
// Dùng để biết sản phẩm nào vừa lên bài mà không cần thêm cột DB cho dữ liệu cũ.

{
  const products = ["Rèm vải", "Rèm vải buông", "Rèm cầu vồng", "Rèm cuốn"];
  check("null → null", detectPostProduct(null, products) === null);
  check("nội dung rỗng → null", detectPostProduct("   ", products) === null);
  check("không có sản phẩm nào → null", detectPostProduct("bài gì đó", []) === null);

  check(
    "khớp ở dòng đầu (hook)",
    detectPostProduct("Rèm cầu vồng Quận 7 cho không gian hiện đại\n\nMô tả…", products) === "Rèm cầu vồng"
  );
  check(
    "khớp tên DÀI NHẤT trước (Rèm vải buông ≠ Rèm vải)",
    detectPostProduct("Tư vấn rèm vải buông Hòa Phú cho phòng khách", products) === "Rèm vải buông"
  );
  check(
    "dòng đầu không có thì quét cả bài",
    detectPostProduct("Một khách cần xử lý nắng\n\nCửa hàng gợi ý rèm cuốn.", products) === "Rèm cuốn"
  );
  check(
    "bỏ dấu khi so khớp",
    detectPostProduct("Tu van REM CAU VONG Quan 7", products) === "Rèm cầu vồng"
  );
}


// ============================================================
section("Ngân sách thời gian (deadline) — planner tự dừng trước khi bị kill");
// ============================================================
// Bối cảnh: một lượt lập kế hoạch gọi AI cho từng bài nên mất ~170 giây, vượt
// xa thời gian sống của một function serverless. Bản cũ chạy tới xong nên bị
// kill giữa chừng: thuê bao không được nhả, sổ theo dõi không được ghi, và lỗi
// thật không được lưu. Các hàm dưới đây là chốt chặn cho việc tự dừng sạch.

{
  const t0 = new Date("2026-09-28T00:00:00.000Z");

  // Không truyền / ngân sách vô lệ => KHÔNG giới hạn (giữ hành vi cũ cho test tay)
  check("makeDeadline(0) → null (không giới hạn)", makeDeadline(0, t0) === null);
  check("makeDeadline(-1) → null", makeDeadline(-1, t0) === null);
  check("makeDeadline(NaN) → null", makeDeadline(Number.NaN, t0) === null);

  const d = makeDeadline(40_000, t0);
  check("makeDeadline cộng đúng ngân sách", d !== null && d.at === t0.getTime() + 40_000);

  check("deadline null → không bao giờ hết hạn", deadlineExceeded(null, t0) === false);
  check("deadline undefined → không hết hạn", deadlineExceeded(undefined, t0) === false);
  check("trước hạn → false", deadlineExceeded(d, new Date(t0.getTime() + 39_999)) === false);
  check("đúng mốc hạn → true", deadlineExceeded(d, new Date(t0.getTime() + 40_000)) === true);
  check("quá hạn → true", deadlineExceeded(d, new Date(t0.getTime() + 41_000)) === true);

  check("remainingBudgetMs null → vô hạn", remainingBudgetMs(null, t0) === Number.POSITIVE_INFINITY);
  check("remainingBudgetMs đếm lùi đúng", remainingBudgetMs(d, new Date(t0.getTime() + 10_000)) === 30_000);
  check("remainingBudgetMs không âm", remainingBudgetMs(d, new Date(t0.getTime() + 99_000)) === 0);

  // aiTimeoutMs: lời gọi AI không bao giờ được phép vượt phần ngân sách còn lại,
  // nếu không nó sẽ kéo dài qua hạn và cả lượt bị nền tảng cắt ngang.
  check(
    "không có hạn → dùng trần mặc định",
    aiTimeoutMs(null, t0) === DEFAULT_AI_CALL_TIMEOUT_MS
  );
  check(
    "còn nhiều ngân sách → kẹp theo trần",
    aiTimeoutMs(d, t0) === DEFAULT_AI_CALL_TIMEOUT_MS
  );
  check(
    "còn ít hơn trần → lấy phần còn lại",
    aiTimeoutMs(d, new Date(t0.getTime() + 35_000)) === 5_000
  );
  check(
    "đã quá hạn → sàn 1ms (không trả 0/âm)",
    aiTimeoutMs(d, new Date(t0.getTime() + 50_000)) === 1
  );
  check(
    "trần truyền vào được tôn trọng",
    aiTimeoutMs(d, t0, 1_000) === 1_000
  );
}

// ============================================================
section("Cổng 'đủ thời gian mới bắt đầu' — không tạo lỗi giả");
// ============================================================
// Bối cảnh: bản đầu chỉ kiểm `deadlineExceeded` (còn > 0 ms) nên vẫn khởi động
// một bài cần ~10 giây khi chỉ còn 3 giây → lời gọi đứt chắc chắn và ghi một lỗi
// GIẢ ("Model không trả lời trong 3 giây"), rồi lỗi giả đó lại kích hoạt lớp
// nghỉ-sau-lỗi. Đã gặp thật trên production.
{
  const t0 = new Date("2026-09-28T00:00:00.000Z");
  const d = makeDeadline(40_000, t0); // hạn ở t0 + 40s

  check("không có hạn → luôn đủ thời gian", hasRoomForPost(null, t0, MIN_POST_BUDGET_MS) === true);
  check(
    "còn 40s → đủ cho 1 bài",
    hasRoomForPost(d, t0, MIN_POST_BUDGET_MS) === true
  );
  check(
    "còn đúng bằng ngưỡng → vẫn đủ (biên trên)",
    hasRoomForPost(d, new Date(t0.getTime() + 40_000 - MIN_POST_BUDGET_MS), MIN_POST_BUDGET_MS) === true
  );
  check(
    "thiếu 1ms so với ngưỡng → KHÔNG bắt đầu",
    hasRoomForPost(d, new Date(t0.getTime() + 40_000 - MIN_POST_BUDGET_MS + 1), MIN_POST_BUDGET_MS) === false
  );
  check(
    "còn 3s → KHÔNG bắt đầu (đúng ca lỗi giả đã gặp)",
    hasRoomForPost(d, new Date(t0.getTime() + 37_000), MIN_POST_BUDGET_MS) === false
  );
  check(
    "còn 5s → không đủ cho bước ảnh",
    hasRoomForPost(d, new Date(t0.getTime() + 35_000), MIN_MEDIA_BUDGET_MS) === false
  );
  check(
    "còn 20s → đủ cho bước ảnh",
    hasRoomForPost(d, new Date(t0.getTime() + 20_000), MIN_MEDIA_BUDGET_MS) === true
  );
}

// ============================================================
section("boundedTimeout — bước ảnh không được vượt hạn của lượt");
// ============================================================
// searchMedia từng hardcode 20 giây và được gọi tối đa 3 lần cho MỘT bài
// (~60 giây) nằm ngoài hạn → đủ đẩy function vượt maxDuration và bị kill.
{
  const t0 = new Date("2026-09-28T00:00:00.000Z");
  const d = makeDeadline(40_000, t0);

  check("không có hạn → giữ mặc định 20s", boundedTimeout(20_000, null, t0) === 20_000);
  check("còn nhiều thời gian → giữ 20s", boundedTimeout(20_000, d, t0) === 20_000);
  check(
    "còn 5s → kẹp xuống 5s (không chờ 20s)",
    boundedTimeout(20_000, d, new Date(t0.getTime() + 35_000)) === 5_000
  );
  check(
    "đã quá hạn → sàn 1s (không trả 0/âm)",
    boundedTimeout(20_000, d, new Date(t0.getTime() + 99_000)) === 1_000
  );
  check("sàn truyền vào được tôn trọng", boundedTimeout(20_000, d, new Date(t0.getTime() + 99_000), 2_500) === 2_500);
}

// ============================================================
section("isBlockingPlanError — cảnh báo thiếu ảnh KHÔNG phải lỗi chặn");
// ============================================================
// Cảnh báo thiếu ảnh được lưu CHUNG cột lastPlanError với lỗi thật. Nếu dùng
// thẳng cột đó làm điều kiện nghỉ-sau-lỗi thì một bài thiếu ảnh sẽ khoá việc lập
// kế hoạch của cả Page — đã gặp thật trên production.
{
  check("null → không chặn", isBlockingPlanError(null) === false);
  check("chuỗi rỗng → không chặn", isBlockingPlanError("") === false);
  check(
    "cảnh báo thiếu ảnh → KHÔNG chặn",
    isBlockingPlanError("1 bài không tìm được ảnh: Không tìm được ảnh/video phù hợp trên Pexels.") === false
  );
  check(
    "nhiều bài thiếu ảnh → KHÔNG chặn",
    isBlockingPlanError("3 bài không tìm được ảnh: hết thời gian của lượt này") === false
  );
  check(
    "timeout model → CHẶN",
    isBlockingPlanError("Model không trả lời trong 35 giây (hạn chờ của lượt này) — thử lại.") === true
  );
  check(
    "thiếu API key → CHẶN",
    isBlockingPlanError("Không gọi được AI Provider: fetch failed") === true
  );
}

// ============================================================
console.log(`\n${"=".repeat(52)}`);
console.log(`Kết quả: ${passed} đạt, ${failed} lỗi (tổng ${passed + failed})`);
console.log("=".repeat(52));
process.exit(failed === 0 ? 0 : 1);
