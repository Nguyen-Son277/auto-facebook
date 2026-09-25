// ============================================================
// Kiểm thử CỔNG CHẶN BẢO VỆ LỊCH ĐĂNG TỰ ĐỘNG — logic thuần.
//
// Chạy: npm run test:autopilot-guard
//
// KHÔNG cần database, không cần dev server. Chỉ kiểm tra các hàm thuần ở
// src/lib/brand-scope.ts — nơi chứa toàn bộ câu chữ và quy tắc quyết định
// "thao tác này có làm hỏng AutoPilot không".
//
// Bối cảnh: người dùng đang bật tự động đăng rồi xoá thương hiệu / tắt trụ cột
// cuối / bỏ gắn Brand. AutoPilot vẫn `enabled = true` nhưng hết dữ liệu để viết
// bài → mỗi nhịp lập kế hoạch lại lỗi, bị lớp nghỉ 15 phút chặn lặp vô hạn, và
// người dùng chỉ thấy "tự động đăng không chạy" mà không hiểu vì sao.
//
// Các hàm ở đây quyết định khi nào phải hỏi xác nhận và nói gì với người dùng.
// ============================================================

import {
  AUTO_PILOT_GUARD_TITLE,
  autoPilotBlockedError,
  autoPilotConfirmPrompt,
  autoPilotGuardNotice,
  formatPageNames,
  minimalProfileProblem,
  readinessProblem,
} from "../src/lib/brand-scope.ts";

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

// ============================================================
section("1. minimalProfileProblem — 4 tổ hợp mô tả × sản phẩm");
// ============================================================

check(
  "có cả hai → đủ điều kiện (null)",
  minimalProfileProblem({ hasDescription: true, hasProducts: true }) === null
);

const onlyDescription = minimalProfileProblem({ hasDescription: true, hasProducts: false });
check(
  "thiếu sản phẩm → chặn và nêu đúng 'sản phẩm/dịch vụ'",
  typeof onlyDescription === "string" && onlyDescription.includes("sản phẩm/dịch vụ"),
  `nhận: ${onlyDescription}`
);
check(
  "thiếu sản phẩm → KHÔNG nhắc nhầm tới giới thiệu doanh nghiệp",
  Boolean(onlyDescription && !onlyDescription.includes("giới thiệu doanh nghiệp"))
);

const onlyProducts = minimalProfileProblem({ hasDescription: false, hasProducts: true });
check(
  "thiếu mô tả → chặn và nêu đúng 'giới thiệu doanh nghiệp'",
  typeof onlyProducts === "string" && onlyProducts.includes("giới thiệu doanh nghiệp"),
  `nhận: ${onlyProducts}`
);
check(
  "thiếu mô tả → KHÔNG nhắc nhầm tới sản phẩm",
  Boolean(onlyProducts && !onlyProducts.includes("sản phẩm/dịch vụ"))
);

const neither = minimalProfileProblem({ hasDescription: false, hasProducts: false });
check(
  "thiếu cả hai → nêu đủ cả hai phần",
  Boolean(
    neither &&
      neither.includes("giới thiệu doanh nghiệp") &&
      neither.includes("sản phẩm/dịch vụ")
  ),
  `nhận: ${neither}`
);
check(
  "mọi thông điệp đều chỉ đường vào trang Thương hiệu",
  [onlyDescription, onlyProducts, neither].every((m) => m && m.includes("Thương hiệu"))
);

// ============================================================
section("2. readinessProblem — thứ tự ưu tiên 3 tầng");
// ============================================================

// Thứ tự là CỐ Ý: mỗi tầng chỉ có nghĩa khi tầng trước đã đạt. Báo sai tầng sẽ
// khiến người dùng đi sửa nhầm chỗ.
const noBrand = readinessProblem({
  brandId: null,
  brandName: null,
  pillars: 0,
  hasDescription: false,
  hasProducts: false,
});
check(
  "chưa gắn Brand → báo chưa gắn thương hiệu (KHÔNG báo thiếu hồ sơ)",
  Boolean(
    noBrand &&
      noBrand.includes("chưa gắn thương hiệu") &&
      !noBrand.includes("giới thiệu doanh nghiệp")
  ),
  `nhận: ${noBrand}`
);

const noPillar = readinessProblem({
  brandId: "b",
  brandName: "X",
  pillars: 0,
  hasDescription: false,
  hasProducts: false,
});
check(
  "có Brand nhưng 0 trụ cột → báo thiếu trụ cột (KHÔNG báo thiếu hồ sơ)",
  Boolean(
    noPillar && noPillar.includes("trụ cột nội dung") && !noPillar.includes("giới thiệu doanh nghiệp")
  ),
  `nhận: ${noPillar}`
);

const noProfile = readinessProblem({
  brandId: "b",
  brandName: "X",
  pillars: 2,
  hasDescription: false,
  hasProducts: true,
});
check(
  "có Brand + trụ cột nhưng thiếu hồ sơ → báo thiếu hồ sơ",
  Boolean(noProfile && noProfile.includes("giới thiệu doanh nghiệp")),
  `nhận: ${noProfile}`
);

check(
  "đủ cả ba tầng → null",
  readinessProblem({
    brandId: "b",
    brandName: "X",
    pillars: 2,
    hasDescription: true,
    hasProducts: true,
  }) === null
);

// ============================================================
section("3. formatPageNames — liệt kê tên Page cho hộp thoại");
// ============================================================

check("rỗng → câu mặc định", formatPageNames([]) === "không có Page nào");
check("một Page → tên trần", formatPageNames(["Page A"]) === "Page A");
check("hai Page → nối bằng dấu phẩy", formatPageNames(["A", "B"]) === "A, B");
check(
  "bỏ qua tên rỗng/khoảng trắng",
  formatPageNames(["A", "  ", ""]) === "A",
  formatPageNames(["A", "  ", ""])
);

const many = formatPageNames(["P1", "P2", "P3", "P4", "P5", "P6", "P7"]);
check(
  "quá 5 Page → rút gọn kèm số còn lại",
  many.includes("P1") && many.includes("và 2 Page khác"),
  many
);

// ============================================================
section("4. autoPilotConfirmPrompt — hộp thoại xác nhận");
// ============================================================

const prompt = autoPilotConfirmPrompt('Xoá thương hiệu "Rèm Cửa"', ["Page A", "Page B"]);
check("nêu thao tác người dùng sắp làm", prompt.includes('Xoá thương hiệu "Rèm Cửa"'));
check("liệt kê tên các Page bị ảnh hưởng", prompt.includes("Page A") && prompt.includes("Page B"));
check("nói rõ sẽ TẮT tự động đăng", prompt.includes("TẮT tự động đăng"));
// Đây là cam kết quan trọng nhất với người dùng: họ không mất lịch đã đặt.
check("cam kết KHÔNG xoá bài đã lên lịch", prompt.includes("KHÔNG bị xoá"));
check("nói rõ bật lại được", prompt.includes("bật lại"));
check("là câu hỏi (kết thúc bằng dấu ?)", prompt.trim().endsWith("?"));

const onePagePrompt = autoPilotConfirmPrompt("Xoá Page", ["Chỉ Một Page"]);
check(
  "một Page → dùng 'Page này' (số ít)",
  onePagePrompt.includes("Page này") && !onePagePrompt.includes("các Page này")
);

// ============================================================
section("5. autoPilotBlockedError — lỗi khi client bỏ qua xác nhận");
// ============================================================

const blocked = autoPilotBlockedError("Xoá thương hiệu", ["Page A"]);
check("nói rõ CHƯA xác nhận", blocked.includes("Chưa xác nhận"));
check("nêu thao tác bị chặn", blocked.includes("Xoá thương hiệu"));
check("liệt kê Page bị ảnh hưởng", blocked.includes("Page A"));
check("hướng dẫn xác nhận rồi thử lại", blocked.includes("thử lại"));

// ============================================================
section("6. autoPilotGuardNotice — thông báo cho chủ Page");
// ============================================================

const notice = autoPilotGuardNotice('Thương hiệu "X" đã bị xoá.', ["Page A", "Page B"]);
check("nói rõ đã tắt tự động đăng cho Page nào", notice.includes("Page A") && notice.includes("Page B"));
check("nêu lý do tắt", notice.includes('Thương hiệu "X" đã bị xoá.'));
check("cam kết bài đã lên lịch vẫn giữ nguyên", notice.includes("vẫn giữ nguyên"));
check("hướng dẫn bật lại", notice.includes("bật lại"));

check(
  "tiêu đề thông báo là hằng dùng chung",
  typeof AUTO_PILOT_GUARD_TITLE === "string" && AUTO_PILOT_GUARD_TITLE.includes("tắt tự động đăng")
);

// ============================================================
console.log(`\n${"=".repeat(50)}`);
console.log(`Kết quả: ${passed} đạt, ${failed} lỗi`);
if (failed > 0) {
  console.log("Lỗi:\n  - " + failures.join("\n  - "));
  process.exit(1);
}
console.log("Tất cả kiểm thử cổng chặn AutoPilot đều đạt.");
