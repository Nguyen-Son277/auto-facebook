// ============================================================
// Kiểm thử tính năng "Địa bàn hoạt động" của Thương hiệu.
//
// Chạy: npm run test:service-area
//
// Ba phần, đều là hàm THUẦN nên không cần dev server/database:
//   1. parseServiceAreas  — đọc danh sách người dùng nhập
//   2. pickServiceArea    — xoay vòng chọn địa bàn cho từng bài
//   3. buildBrandBlock / buildUserPrompt — prompt gửi AI có ràng buộc đúng
//
// Vì sao cần ràng buộc "không bịa địa danh": tên phường/xã ở Việt Nam thay
// đổi rất nhiều sau các đợt sáp nhập. Nếu prompt không chặn, AI sẽ tự nghĩ
// ra địa danh sai hoặc không còn tồn tại — đúng lỗi tính năng này sinh ra
// để tránh.
// ============================================================

import {
  MAX_SERVICE_AREA_CHARS,
  MAX_SERVICE_AREAS,
  parseServiceAreas,
  pickServiceArea,
} from "../src/lib/autopilot-plan.ts";
import { buildBrandBlock, buildUserPrompt } from "../src/lib/ai-prompts.ts";

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

// ============================================================
console.log("— parseServiceAreas: đọc danh sách người dùng nhập —");
// ============================================================

{
  check("chuỗi rỗng → mảng rỗng", parseServiceAreas("").length === 0);
  check("null → mảng rỗng", parseServiceAreas(null).length === 0);
  check("undefined → mảng rỗng", parseServiceAreas(undefined).length === 0);
  check("chỉ khoảng trắng/xuống dòng → mảng rỗng", parseServiceAreas("  \n \n\t ").length === 0);
}

{
  const r = parseServiceAreas("Bình Dương\nThủ Dầu Một\nDĩ An");
  check("tách theo xuống dòng", r.length === 3, JSON.stringify(r));
  check("giữ đúng thứ tự nhập", r[0] === "Bình Dương" && r[1] === "Thủ Dầu Một");
  check("giữ nguyên dấu tiếng Việt", r[0] === "Bình Dương");
}

{
  const r = parseServiceAreas("Bình Dương, Thủ Dầu Một; Dĩ An");
  check("tách được cả dấu phẩy và dấu chấm phẩy", r.length === 3, JSON.stringify(r));
}

{
  const r = parseServiceAreas("Bình Dương\n\n\nDĩ An\n   \nThuận An");
  check("bỏ dòng trống", r.length === 3, JSON.stringify(r));
}

{
  const r = parseServiceAreas("Bình Dương\nbinh duong\nBÌNH DƯƠNG\nDĩ An");
  check("khử trùng không phân biệt hoa/thường và dấu", r.length === 2, JSON.stringify(r));
  check("giữ cách viết của lần xuất hiện đầu tiên", r[0] === "Bình Dương");
}

{
  const r = parseServiceAreas("  Dĩ   An  ");
  check("gộp khoảng trắng thừa trong tên", r[0] === "Dĩ An", JSON.stringify(r));
}

{
  const many = Array.from({ length: MAX_SERVICE_AREAS + 20 }, (_, i) => `Khu ${i}`);
  const r = parseServiceAreas(many.join("\n"));
  check(`giới hạn tối đa ${MAX_SERVICE_AREAS} địa bàn`, r.length === MAX_SERVICE_AREAS, `nhận ${r.length}`);
}

{
  const r = parseServiceAreas("A".repeat(500));
  check(
    `cắt mỗi dòng tối đa ${MAX_SERVICE_AREA_CHARS} ký tự`,
    r[0].length === MAX_SERVICE_AREA_CHARS,
    `nhận ${r[0]?.length}`
  );
}

// ============================================================
console.log("\n— pickServiceArea: xoay vòng chọn địa bàn —");
// ============================================================

{
  check("danh sách rỗng → null (tắt tính năng)", pickServiceArea([], []) === null);
  check("danh sách rỗng dù có lịch sử → null", pickServiceArea([], ["Dĩ An"]) === null);
}

{
  const areas = ["Dĩ An"];
  check("một địa bàn → luôn trả địa bàn đó", pickServiceArea(areas, []) === "Dĩ An");
  check("một địa bàn → vẫn trả dù trùng bài trước", pickServiceArea(areas, ["Dĩ An"]) === "Dĩ An");
}

{
  // Mô phỏng đúng vòng lặp của AutoPilot: chọn rồi ghi vào lịch sử
  const areas = ["Thủ Dầu Một", "Dĩ An", "Thuận An"];
  const recent = [];
  const picked = [];
  for (let i = 0; i < 6; i++) {
    const a = pickServiceArea(areas, recent);
    picked.push(a);
    recent.unshift(a);
  }
  check(
    "3 bài đầu phủ đủ 3 địa bàn, không trùng",
    new Set(picked.slice(0, 3)).size === 3,
    picked.join(" → ")
  );
  check("chu kỳ quay lại sau khi hết danh sách", picked[3] === picked[0], picked.join(" → "));
  check("không bao giờ nhắm trùng bài liền trước", picked.every((a, i) => i === 0 || a !== picked[i - 1]), picked.join(" → "));
}

{
  const areas = ["A", "B"];
  const a1 = pickServiceArea(areas, []);
  const a2 = pickServiceArea(areas, [a1]);
  check("2 địa bàn → bài thứ 2 chọn địa bàn còn lại", a2 !== a1, `${a1} → ${a2}`);
}

{
  const areas = ["Dĩ An", "Thủ Dầu Một"];
  const r = pickServiceArea(areas, ["dĩ an"]);
  check("so trùng lịch sử không phân biệt hoa/thường", r === "Thủ Dầu Một", r);
}

{
  // Địa bàn chưa dùng bao giờ phải được ưu tiên hơn địa bàn đã dùng nhiều
  const areas = ["A", "B", "C"];
  const r = pickServiceArea(areas, ["A", "A", "B"]);
  check("ưu tiên địa bàn ít dùng nhất (C)", r === "C", r);
}

// ============================================================
console.log("\n— Prompt: khối ĐỊA BÀN HOẠT ĐỘNG —");
// ============================================================

{
  const block = buildBrandBlock({ brandName: "Shop Rèm", serviceAreas: "Bình Dương\nDĩ An" });
  const text = block.join("\n");
  check("hồ sơ có dòng địa bàn hoạt động", text.includes("Địa bàn hoạt động"));
  check("hồ sơ chứa tên địa bàn", text.includes("Dĩ An"));
}

{
  // Lỗi thật đã gặp: dòng thứ 2 trở đi của giá trị nhiều dòng nằm ngang hàng với
  // các dấu "-" khác, khiến AI đọc nhầm thành các mục riêng biệt.
  const block = buildBrandBlock({
    brandName: "Shop Rèm",
    serviceAreas: "Bình Dương\nThủ Dầu Một\nDĩ An",
  });
  const areaLineIdx = block.findIndex((l) => l.startsWith("- Địa bàn hoạt động"));
  check("dòng địa bàn tồn tại trong khối", areaLineIdx !== -1);
  check("dòng nối tiếp của địa bàn được THỤT LỀ", block[areaLineIdx + 1]?.startsWith("  "), JSON.stringify(block[areaLineIdx + 1]));
  check("dòng nối tiếp KHÔNG bắt đầu bằng dấu '-'", !block[areaLineIdx + 1]?.startsWith("- "));
  // "Bình Dương" ở dòng nhãn, "Thủ Dầu Một" và "Dĩ An" là 2 dòng nối tiếp
  check(
    "mọi khu vực trong danh sách đều thụt lề",
    [1, 2].every((i) => block[areaLineIdx + i]?.startsWith("  ")),
    JSON.stringify(block.slice(areaLineIdx, areaLineIdx + 3))
  );
  check(
    "danh sách địa bàn kết thúc đúng chỗ (không nuốt mục sau)",
    !block[areaLineIdx + 3]?.startsWith("  "),
    JSON.stringify(block[areaLineIdx + 3])
  );
}

{
  // Sản phẩm cũng là ô nhiều dòng — cùng một lỗi, phải được thụt lề
  const block = buildBrandBlock({ brandName: "Shop", products: "Rèm vải\nRèm cuốn" });
  const idx = block.findIndex((l) => l.startsWith("- Sản phẩm/dịch vụ chính"));
  check("dòng nối tiếp của sản phẩm được thụt lề", block[idx + 1]?.startsWith("  "), JSON.stringify(block[idx + 1]));
}

{
  const block = buildBrandBlock({ brandName: "Shop", avoidTopics: "Chính trị\nTôn giáo" });
  const idx = block.findIndex((l) => l.includes("KHÔNG nhắc tới"));
  check("dòng nối tiếp của 'không nhắc tới' được thụt lề", block[idx + 1]?.startsWith("  "), JSON.stringify(block[idx + 1]));
}

{
  const block = buildBrandBlock({ brandName: "Shop Rèm" });
  check(
    "không có địa bàn → không thêm dòng nào",
    !block.join("\n").includes("Địa bàn hoạt động")
  );
}

{
  const prompt = buildUserPrompt({
    userId: "u1",
    topic: "Giới thiệu rèm",
    tone: "friendly",
    goal: "sales",
    length: "medium",
    brand: { serviceAreas: "Bình Dương\nDĩ An", serviceArea: "Dĩ An" },
  });
  check("prompt có khối ĐỊA BÀN HOẠT ĐỘNG", prompt.includes("ĐỊA BÀN HOẠT ĐỘNG"));
  check(
    "danh sách khu vực in dạng gạch đầu dòng thụt lề",
    prompt.includes("  • Bình Dương") && prompt.includes("  • Dĩ An"),
    prompt.split("\n").filter((l) => l.includes("•")).join(" | ")
  );
  check("prompt nêu địa bàn mục tiêu của bài", prompt.includes("Bài này nhắm tới khu vực: Dĩ An"));
  check("prompt nêu phạm vi phục vụ", prompt.includes("Bình Dương"));
  check(
    "prompt CẤM bịa tên khu vực khác (chốt chặn quan trọng nhất)",
    prompt.includes("TUYỆT ĐỐI không tự bịa")
  );
  check(
    "prompt phân biệt khu vực phục vụ vs địa chỉ chi nhánh",
    prompt.includes("không phải địa chỉ chi nhánh")
  );
}

{
  // Không có serviceArea (bài soạn tay, hoặc thương hiệu để trống) → không có khối
  const prompt = buildUserPrompt({
    userId: "u1",
    topic: "Giới thiệu rèm",
    tone: "friendly",
    goal: "sales",
    length: "medium",
    brand: { serviceAreas: "Bình Dương" },
  });
  check(
    "có danh sách nhưng chưa gán địa bàn → KHÔNG có khối địa bàn",
    !prompt.includes("ĐỊA BÀN HOẠT ĐỘNG")
  );
}

{
  // Tương thích ngược: hồ sơ cũ không có địa bàn → prompt y hệt trước đây
  const prompt = buildUserPrompt({
    userId: "u1",
    topic: "Giới thiệu rèm",
    tone: "friendly",
    goal: "sales",
    length: "medium",
    brand: { brandName: "Shop Rèm", industry: "Nội thất" },
  });
  check("hồ sơ không có địa bàn → prompt không đổi", !prompt.includes("ĐỊA BÀN HOẠT ĐỘNG"));
}

// ============================================================
console.log(`\n${"=".repeat(52)}`);
console.log(`Kết quả: ${passed} đạt, ${failed} lỗi (tổng ${passed + failed})`);
console.log("=".repeat(52));
process.exit(failed === 0 ? 0 : 1);
