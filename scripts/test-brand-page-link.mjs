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

import { contentScopeForPage, minimalProfileProblem, readinessProblem } from "../src/lib/brand-scope.ts";

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
  hasDescription: false,
  hasProducts: false,
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
  hasDescription: true,
  hasProducts: true,
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
  "có Brand + trụ cột + hồ sơ đầy đủ → đủ điều kiện (null)",
  readinessProblem({
    brandId: "b",
    brandName: "X",
    pillars: 4,
    hasDescription: true,
    hasProducts: true,
  }) === null
);

// ============================================================
section("3b. Hồ sơ doanh nghiệp tối thiểu LÀ điều kiện chặn");
// ============================================================

// Đổi hành vi có chủ ý: trước đây thiếu hồ sơ chỉ là gợi ý. Nay thiếu mô tả
// doanh nghiệp hoặc sản phẩm thì AutoPilot không được tạo bài — AI không có gì
// để bám vào nên bài viết ra chung chung hoặc bịa.
const noDescriptionMsg = readinessProblem({
  brandId: "b",
  brandName: "X",
  pillars: 1,
  hasDescription: false,
  hasProducts: true,
});
check(
  "thiếu giới thiệu doanh nghiệp → CHẶN",
  Boolean(noDescriptionMsg && noDescriptionMsg.includes("giới thiệu doanh nghiệp")),
  `nhận: ${noDescriptionMsg}`
);

const noProductsMsg = readinessProblem({
  brandId: "b",
  brandName: "X",
  pillars: 1,
  hasDescription: true,
  hasProducts: false,
});
check(
  "thiếu sản phẩm/dịch vụ → CHẶN",
  Boolean(noProductsMsg && noProductsMsg.includes("sản phẩm/dịch vụ")),
  `nhận: ${noProductsMsg}`
);

const emptyProfileMsg = readinessProblem({
  brandId: "b",
  brandName: "X",
  pillars: 1,
  hasDescription: false,
  hasProducts: false,
});
check(
  "thiếu cả hai → nêu đủ cả hai phần",
  Boolean(
    emptyProfileMsg &&
      emptyProfileMsg.includes("giới thiệu doanh nghiệp") &&
      emptyProfileMsg.includes("sản phẩm/dịch vụ")
  ),
  `nhận: ${emptyProfileMsg}`
);
check(
  "thông điệp thiếu hồ sơ chỉ đường vào trang Thương hiệu",
  Boolean(emptyProfileMsg && emptyProfileMsg.includes("Thương hiệu"))
);

// minimalProfileProblem là hàm thuần dùng chung cho action + planner.
check(
  "minimalProfileProblem: đủ cả hai → null",
  minimalProfileProblem({ hasDescription: true, hasProducts: true }) === null
);
check(
  "minimalProfileProblem: thiếu một phần → có thông điệp",
  typeof minimalProfileProblem({ hasDescription: true, hasProducts: false }) === "string"
);

// Thứ tự ưu tiên: chưa Brand phải được báo TRƯỚC thiếu hồ sơ, nếu không người
// dùng sẽ đi bổ sung hồ sơ trong khi vấn đề thật là Page chưa gắn thương hiệu.
const priorityMsg = readinessProblem({
  brandId: null,
  brandName: null,
  pillars: 0,
  hasDescription: false,
  hasProducts: false,
});
check(
  "chưa gắn Brand được ưu tiên báo trước thiếu hồ sơ",
  Boolean(priorityMsg && priorityMsg.includes("chưa gắn thương hiệu"))
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
section("8. Guard: mọi action làm hỏng AutoPilot đều phải qua cổng chặn");
// ============================================================

// Lỗi cần chống tái phát: người dùng xoá thương hiệu / tắt trụ cột cuối / bỏ
// gắn Brand trong khi AutoPilot đang bật → AutoPilot hết dữ liệu nhưng vẫn
// `enabled = true`, mỗi nhịp lại lỗi và bị chặn 15 phút, lặp vô hạn.
//
// Guard ở mức mã nguồn vì đây là ràng buộc BẢO MẬT/AN TOÀN: một action mới
// thêm sau này quên gọi cổng chặn sẽ bị test bắt ngay.

const brandActionsSrc = stripComments(read("src/app/actions/brand.ts"));
check(
  "actions/brand.ts định nghĩa guardAutoPilot dùng chung",
  brandActionsSrc.includes("async function guardAutoPilot(")
);
check(
  "actions/brand.ts có guardLastEnabledPillar cho trụ cột cuối",
  brandActionsSrc.includes("async function guardLastEnabledPillar(")
);

// Mỗi action nguy hiểm phải tham chiếu cổng chặn tương ứng.
const BRAND_GUARDED = [
  ["deleteBrand", "guardAutoPilot("],
  ["saveBrandProfile", "guardAutoPilot("],
  ["deletePillar", "guardLastEnabledPillar("],
  ["togglePillar", "guardLastEnabledPillar("],
];
for (const [fn, guard] of BRAND_GUARDED) {
  check(
    `actions/brand.ts: ${fn} đi qua ${guard}`,
    brandActionsSrc.includes(fn) && brandActionsSrc.includes(guard)
  );
}

const pagesActionsSrc = stripComments(read("src/app/actions/pages.ts"));
check(
  "actions/pages.ts định nghĩa guardAutoPilotPage dùng chung",
  pagesActionsSrc.includes("async function guardAutoPilotPage(")
);
const PAGES_GUARDED = ["togglePageActive", "deletePage", "assignPageToBrand"];
for (const fn of PAGES_GUARDED) {
  check(
    `actions/pages.ts: ${fn} đi qua guardAutoPilotPage`,
    pagesActionsSrc.includes(`export async function ${fn}(`) &&
      pagesActionsSrc.includes("guardAutoPilotPage(")
  );
}

// MỌI giao diện gọi assignPageToBrand đều phải xử lý yêu cầu xác nhận — nếu
// không, nút bấm sẽ thất bại im lặng khi Page đang bật tự động đăng.
for (const rel of [
  "src/components/page-brand-select.tsx",
  "src/components/brand-pages-panel.tsx",
]) {
  const src = read(rel);
  check(
    `${rel} xử lý needsAutoPilotConfirmation`,
    src.includes("needsAutoPilotConfirmation") && src.includes("autoPilotConfirmPrompt")
  );
}

// Không action nào được tự ý bật lại AutoPilot mà bỏ qua điều kiện sẵn sàng.
check(
  "actions/autopilot.ts: readiness() dùng chung getPageReadiness",
  autopilotAction.includes("await getPageReadiness(pageId)")
);

// Planner phải tự kiểm tra hồ sơ tối thiểu — lưới an toàn cho dữ liệu cũ hoặc
// hàng ghi thẳng vào DB, không đi qua server action.
const plannerSrc = stripComments(read("src/lib/autopilot.ts"));
check(
  "lib/autopilot.ts: planner chặn khi thiếu hồ sơ tối thiểu",
  plannerSrc.includes("minimalProfileProblem(")
);

// Câu chữ dùng chung — không nơi nào tự viết lại thông báo.
check(
  "lib/brand-scope.ts xuất autoPilotConfirmPrompt/autoPilotBlockedError",
  read("src/lib/brand-scope.ts").includes("export function autoPilotConfirmPrompt(") &&
    read("src/lib/brand-scope.ts").includes("export function autoPilotBlockedError(")
);

// ============================================================
console.log(`\n${"=".repeat(50)}`);
console.log(`Kết quả: ${passed} đạt, ${failed} lỗi`);
if (failed > 0) {
  console.log("Lỗi:\n  - " + failures.join("\n  - "));
  process.exit(1);
}
console.log("Tất cả kiểm thử liên kết Page ↔ Brand đều đạt.");
