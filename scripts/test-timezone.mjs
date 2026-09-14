// ============================================================
// Kiểm thử: mọi phép quy đổi ngày/giờ phải GIỐNG NHAU ở mọi múi giờ tiến trình.
//
// Chạy: npm run test:timezone
//
// Vì sao cần: Vercel chạy UTC còn máy dev ở Việt Nam chạy +07. Trước đây bộ lập
// kế hoạch dùng getHours/setHours/getDay (giờ tiến trình), nên bài hẹn "07:00"
// trên máy +07 bị Vercel hiểu thành 07:00 UTC — lệch 7 tiếng và không bao giờ
// tới giờ đăng. Test này chạy cùng một đoạn mã dưới 2 múi giờ và so sánh.
//
// Không cần database, không cần dev server.
// ============================================================

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_URL = pathToFileURL(path.join(ROOT, "src/lib/autopilot-plan.ts")).href;

// Mốc thời gian cố định: 2026-09-14T03:00:00Z = 10:00 giờ Việt Nam ngày 14/09.
const AT = "2026-09-14T03:00:00.000Z";

const PROBE = `
import {
  startOfDay, addDays, isoDayOf, formatDateKey, vnYearMonth, vnTime, planTimeSlots,
} from ${JSON.stringify(PLAN_URL)};

const at = new Date(${JSON.stringify(AT)});
const cfg = { postsPerDay: 2, windowStart: "07:00", windowEnd: "21:00", minGapMinutes: 120 };

console.log(JSON.stringify({
  startOfDay: startOfDay(at).toISOString(),
  nextDay: addDays(startOfDay(at), 1).toISOString(),
  isoDay: isoDayOf(at),
  dateKey: formatDateKey(at),
  ym: vnYearMonth(at),
  vnTime0700: vnTime(2026, 8, 14, 7, 0).toISOString(),
  slots: planTimeSlots(cfg, at, null, () => 0.5).map((d) => d.toISOString()),
}));
`;

const probePath = path.join(os.tmpdir(), `tz-probe-${process.pid}.mjs`);
fs.writeFileSync(probePath, PROBE);

function runUnder(tz) {
  const out = execFileSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", probePath],
    { env: { ...process.env, TZ: tz }, encoding: "utf8" }
  );
  return JSON.parse(out.trim().split("\n").pop());
}

let passed = 0;
let failed = 0;
const failures = [];
function check(label, cond, extra = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

try {
  const vn = runUnder("Asia/Ho_Chi_Minh");
  const utc = runUnder("UTC");

  console.log("=== 1. Kết quả phải GIỐNG HỆT nhau ở 2 múi giờ ===");
  const same = JSON.stringify(vn) === JSON.stringify(utc);
  check("TZ=Asia/Ho_Chi_Minh và TZ=UTC cho cùng kết quả", same);
  if (!same) {
    console.log("    +07:", JSON.stringify(vn));
    console.log("    UTC:", JSON.stringify(utc));
  }

  console.log("\n=== 2. Giá trị phải đúng theo giờ Việt Nam ===");
  // 10:00 giờ VN ngày 14/09 → nửa đêm VN = 17:00Z ngày 13/09
  check("startOfDay = 00:00 giờ VN", vn.startOfDay === "2026-09-13T17:00:00.000Z", vn.startOfDay);
  check("addDays(+1) = 00:00 giờ VN hôm sau", vn.nextDay === "2026-09-14T17:00:00.000Z", vn.nextDay);
  check("vnTime(2026,8,14,07:00) = 00:00Z (07:00 giờ VN)", vn.vnTime0700 === "2026-09-14T00:00:00.000Z", vn.vnTime0700);
  check('formatDateKey = "2026-09-14"', vn.dateKey === "2026-09-14", vn.dateKey);
  check("vnYearMonth = {2026, 9}", vn.ym.year === 2026 && vn.ym.month === 9, JSON.stringify(vn.ym));

  console.log("\n=== 3. Slot đăng phải nằm trong khung 07:00–21:00 giờ VN ===");
  // 07:00 VN = 00:00Z ; 21:00 VN = 14:00Z
  const lo = Date.parse("2026-09-14T00:00:00.000Z");
  const hi = Date.parse("2026-09-14T14:00:00.000Z");
  check("có tạo được slot", Array.isArray(vn.slots) && vn.slots.length > 0, JSON.stringify(vn.slots));
  const allInside = vn.slots.every((s) => {
    const t = Date.parse(s);
    return t >= lo && t <= hi;
  });
  check("mọi slot nằm trong khung giờ VN", allInside, JSON.stringify(vn.slots));
  check(
    "slot đầu là 09:38 giờ VN (02:38Z)",
    vn.slots[0] === "2026-09-14T02:38:00.000Z",
    vn.slots[0]
  );
} finally {
  fs.rmSync(probePath, { force: true });
}

console.log(`\n${"=".repeat(50)}`);
console.log(`Kết quả: ${passed} đạt, ${failed} lỗi`);
if (failed > 0) {
  console.log("Lỗi:\n  - " + failures.join("\n  - "));
  process.exit(1);
}
console.log("Mọi phép quy đổi ngày/giờ đều độc lập với múi giờ máy chạy.");
