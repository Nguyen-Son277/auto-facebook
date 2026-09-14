// ============================================================
// Kiểm thử liên kết Page ↔ Brand và chống tái phát lỗi AutoPilot.
//
// Chạy: npm run test:brand-page
//
// KHÔNG cần database, không cần dev server. Gồm 2 phần:
//   1. Logic THUẦN ở src/lib/brand-scope.ts — nơi chứa lỗi gốc.
//   2. Guard ở mức mã nguồn — chặn đúng 3 nguyên nhân đã gây lỗi:
//      a. assignPageToBrand bị bỏ quên, không UI nào gọi (dead code).
//      b. scheduler gửi thông báo "AutoPilot bắt đầu chạy" mỗi nhịp → spam.
//      c. đoạn fallback `brandId ? ... : { pageId }` rải rác nhiều nơi.
//
// Bối cảnh lỗi: Page chưa gắn Brand → mọi truy vấn trụ cột rơi vào nhánh pageId
// (luôn 0 kết quả) → hệ thống báo nhầm "Chưa có trụ cột nội dung" và không cho
// bật chế độ tự động, trong khi nguyên nhân thật là Page chưa gắn thương hiệu.
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { contentScopeForPage, readinessProblem } from "../src/lib/brand-scope.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

function section(title) {
  console.log(`\n=== ${title} ===`);
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

/**
 * Bỏ comment trước khi guard ở mức mã nguồn — nếu không, chính lời giải thích
 * trong code (ví dụ "// KHÔNG gửi thông báo ... nữa") sẽ bị bắt nhầm.
 * Giữ lại `://` của URL.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// ============================================================
section("1. contentScopeForPage — Page có Brand thì tra theo Brand");
// ============================================================

const withBrand = contentScopeForPage("brand-1", "page-1");
check("trả về brandId khi Page đã gắn thương hiệu", withBrand.brandId === "brand-1");
check("KHÔNG kèm pageId (tránh lẫn nội dung Page khác cùng Brand)", !("pageId" in withBrand));

// ============================================================
section("2. contentScopeForPage — Page chưa gắn Brand thì fallback pageId");
// ============================================================

const noBrand = contentScopeForPage(null, "page-1");
check("trả về pageId khi Page chưa gắn thương hiệu", noBrand.pageId === "page-1");
check("KHÔNG kèm brandId", !("brandId" in noBrand));

// ============================================================
section("3. readinessProblem — thông điệp phải nêu ĐÚNG nguyên nhân");
// ============================================================

const noBrandMsg = readinessProblem({
  brandId: null,
  brandName: null,
  pillars: 0,
  hasProfile: false,
});

check("Page chưa gắn Brand → có thông điệp chặn", typeof noBrandMsg === "string");
check(
  "thông điệp nêu rõ 'chưa gắn thương hiệu'",
  Boolean(noBrandMsg && noBrandMsg.includes("chưa gắn thương hiệu")),
  `nhận: ${noBrandMsg}`
);
// Đây chính là lỗi cũ: báo "thiếu trụ cột" khiến người dùng đi sai hướng.
check(
  "KHÔNG báo nhầm là thiếu trụ cột",
  Boolean(noBrandMsg && !noBrandMsg.includes("trụ cột nội dung nào đang bật")),
  `nhận: ${noBrandMsg}`
);
check(
  "thông điệp chỉ cho người dùng đường sửa (/pages, /brand)",
  Boolean(noBrandMsg && noBrandMsg.includes("trang Pages") && noBrandMsg.includes("Thương hiệu"))
);

const brandNoPillarMsg = readinessProblem({
  brandId: "brand-1",
  brandName: "Rèm cửa",
  pillars: 0,
  hasProfile: true,
});
check(
  "có Brand nhưng 0 trụ cột → báo thiếu trụ cột",
  Boolean(brandNoPillarMsg && brandNoPillarMsg.includes("trụ cột nội dung"))
);
check(
  "có Brand → KHÔNG báo nhầm là chưa gắn thương hiệu",
  Boolean(brandNoPillarMsg && !brandNoPillarMsg.includes("chưa gắn thương hiệu"))
);

check(
  "có Brand + có trụ cột → đủ điều kiện (null)",
  readinessProblem({ brandId: "b", brandName: "X", pillars: 4, hasProfile: false }) === null
);
check(
  "thiếu hồ sơ thương hiệu KHÔNG chặn bật tự động",
  readinessProblem({ brandId: "b", brandName: "X", pillars: 1, hasProfile: false }) === null
);

// ============================================================
section("4. Guard: assignPageToBrand phải được UI gọi (lỗi gốc)");
// ============================================================

const uiFiles = [
  "src/app/(dashboard)/pages/page.tsx",
  "src/components/page-brand-select.tsx",
  "src/components/brand-pages-panel.tsx",
];

for (const rel of uiFiles) {
  check(`${rel} tồn tại`, fs.existsSync(path.join(ROOT, rel)));
}

const pagesPage = read("src/app/(dashboard)/pages/page.tsx");
check(
  "trang /pages render ô chọn thương hiệu cho Page",
  pagesPage.includes("PageBrandSelect")
);

const selectComp = read("src/components/page-brand-select.tsx");
check(
  "component ô chọn gọi assignPageToBrand",
  selectComp.includes("assignPageToBrand")
);

const brandPanel = read("src/components/brand-pages-panel.tsx");
check(
  "panel ở trang Thương hiệu gọi assignPageToBrand",
  brandPanel.includes("assignPageToBrand")
);

// Không còn nút chết: ít nhất 1 file giao diện phải tham chiếu action này.
const uiCallers = uiFiles.filter((rel) =>
  fs.existsSync(path.join(ROOT, rel)) && read(rel).includes("assignPageToBrand")
);
check(
  "có ít nhất 1 giao diện gọi assignPageToBrand (trước đây là dead code)",
  uiCallers.length > 0,
  `tìm thấy: ${uiCallers.join(", ") || "không có"}`
);

// ============================================================
section("5. Guard: scheduler không còn spam 'AutoPilot bắt đầu chạy'");
// ============================================================

const schedulerCode = stripComments(read("src/lib/scheduler.ts"));
check(
  "không còn tiêu đề 'AutoPilot bắt đầu chạy'",
  !schedulerCode.includes("AutoPilot bắt đầu chạy")
);
check(
  "không còn gửi thông báo bằng 'void notify(' (bắn rồi quên)",
  !schedulerCode.includes("void notify(")
);
check("dùng notifyMany cho chủ Page", schedulerCode.includes("notifyMany("));
check("dùng notifyAdminsOncePer cho tổng kết lỗi", schedulerCode.includes("notifyAdminsOncePer("));

// ============================================================
section("6. Guard: không còn đoạn fallback brandId rải rác");
// ============================================================

// Nhánh fallback cũ, nguyên văn. Dùng chuỗi literal thay vì regex để không bắt
// nhầm code hợp lệ kiểu `select: { pageId: true, enabled: true }`.
const LEGACY_FALLBACKS = [
  ": { pageId, enabled: true }",
  ": { pageId: config.pageId, enabled: true }",
];

for (const rel of ["src/lib/autopilot.ts", "src/app/actions/autopilot.ts"]) {
  const src = stripComments(read(rel));
  check(
    `${rel} không còn tự viết lại fallback brandId→pageId`,
    LEGACY_FALLBACKS.every((frag) => !src.includes(frag))
  );
}

check(
  "src/lib/autopilot.ts dùng helper contentScopeForPage",
  read("src/lib/autopilot.ts").includes("contentScopeForPage")
);

const autopilotAction = read("src/app/actions/autopilot.ts");
check(
  "readiness() dùng getPageReadiness/readinessProblem",
  autopilotAction.includes("getPageReadiness") && autopilotAction.includes("readinessProblem")
);

// ============================================================
section("7. Guard: có công cụ dọn thông báo cũ");
// ============================================================

check(
  "script dọn thông báo tồn tại",
  fs.existsSync(path.join(ROOT, "scripts/cleanup-notifications.mjs"))
);
const pkg = JSON.parse(read("package.json"));
check(
  "npm run db:cleanup-notifications đã được khai báo",
  typeof pkg.scripts?.["db:cleanup-notifications"] === "string"
);

// ============================================================
console.log(`\n${"=".repeat(50)}`);
console.log(`Kết quả: ${passed} đạt, ${failed} lỗi`);
if (failed > 0) {
  console.log("Lỗi:\n  - " + failures.join("\n  - "));
  process.exit(1);
}
console.log("Tất cả kiểm thử liên kết Page ↔ Brand đều đạt.");
