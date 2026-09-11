// ============================================================
// Kiểm thử logic THUẦN của chế độ tự động (src/lib/autopilot-plan.ts).
//
// Chạy: npm run test:plan
//
// Không cần dev server, không cần database, không cần mock — nên chạy được
// bất cứ lúc nào và không đụng tới dev.db.
// ============================================================

import {
  clampPlanAheadDays,
  clampPostsPerDay,
  clampVideoPercent,
  decideMediaKind,
  videoQuotaForDay,
  formatHm,
  isoDayOf,
  parseDaysOfWeek,
  parseHm,
  pickPillar,
  planTimeSlots,
  startOfDay,
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
console.log(`\n${"=".repeat(52)}`);
console.log(`Kết quả: ${passed} đạt, ${failed} lỗi (tổng ${passed + failed})`);
console.log("=".repeat(52));
process.exit(failed === 0 ? 0 : 1);
