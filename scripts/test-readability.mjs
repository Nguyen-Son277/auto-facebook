// ============================================================
// Kiểm thử hàm chấm điểm dễ đọc (src/lib/posts.ts → analyzeReadability).
//
// Chạy: npm run test:readability
//
// Đây là hàm quyết định bài viết có bị "bức tường chữ" hay không — vấn đề
// người dùng gặp thật: AI viết đoạn văn dài, không nêu được ý chính.
// Không cần dev server/database nên chạy được bất cứ lúc nào.
// ============================================================

import { analyzeReadability, MAX_HOOK_CHARS } from "../src/lib/posts.ts";

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

const codesOf = (text) => analyzeReadability(text).issues.map((i) => i.code);

console.log("— Bài viết đạt chuẩn —");

const GOOD = `Rèm cửa chống nắng cho phòng khách hướng Tây.

Nắng chiều gay gắt làm phòng nóng và bạc màu nội thất.

☀️ Cản tới 90% tia nắng trực tiếp
🌡️ Giảm nhiệt độ phòng rõ rệt
🎨 Nhiều màu hợp mọi nội thất

Inbox để được tư vấn miễn phí nhé!`;

{
  const r = analyzeReadability(GOOD);
  check("bài đúng cấu trúc → không có vấn đề nào", r.ok, `còn: ${r.issues.map((i) => i.code)}`);
  check("lấy đúng dòng đầu làm ý chính", r.hook.startsWith("Rèm cửa chống nắng"));
  check("đếm đúng số đoạn", r.paragraphs === 4, `đếm được ${r.paragraphs}`);
}

console.log("\n— Bắt lỗi bức tường chữ —");

{
  // Đúng vấn đề người dùng báo: một khối văn xuôi dài, không xuống dòng
  const wall =
    "Chúng tôi là đơn vị chuyên cung cấp các loại rèm cửa cao cấp với nhiều mẫu mã đa dạng " +
    "phong phú phù hợp với mọi không gian nội thất từ phòng khách phòng ngủ cho đến văn phòng " +
    "làm việc, cam kết mang đến cho quý khách hàng những sản phẩm chất lượng nhất với mức giá " +
    "hợp lý nhất cùng dịch vụ chăm sóc khách hàng tận tâm chu đáo trong suốt quá trình sử dụng.";
  const codes = codesOf(wall);
  check("khối chữ liền → báo NO_LINE_BREAK", codes.includes("NO_LINE_BREAK"));
  check("khối chữ liền → báo luôn HOOK_TOO_LONG", codes.includes("HOOK_TOO_LONG"));
}

{
  const longHook = "A".repeat(MAX_HOOK_CHARS + 10) + "\n\nNội dung tiếp theo.\n\nInbox ngay!";
  check("câu đầu quá dài → báo HOOK_TOO_LONG", codesOf(longHook).includes("HOOK_TOO_LONG"));
}

{
  const longPara =
    "Ý chính ngắn gọn.\n\n" + "Câu dài lặp đi lặp lại nhiều lần. ".repeat(12) + "\n\nInbox nhé!";
  const codes = codesOf(longPara);
  check("có đoạn dài quá ngưỡng → báo PARAGRAPH_TOO_LONG", codes.includes("PARAGRAPH_TOO_LONG"));
  check("đoạn dài nhưng có xuống dòng → KHÔNG báo NO_LINE_BREAK", !codes.includes("NO_LINE_BREAK"));
}

{
  const noCta = "Rèm cửa đẹp.\n\nChất liệu vải cao cấp.\n\nMàu sắc đa dạng.";
  check("thiếu lời kêu gọi → báo NO_CTA", codesOf(noCta).includes("NO_CTA"));
}

console.log("\n— Nhận diện lời kêu gọi hành động —");

for (const cta of [
  "Inbox ngay để được tư vấn!",
  "Gọi ngay 0901234567",
  "Liên hệ để nhận báo giá",
  "Để lại bình luận nhé",
  "Xem thêm tại https://example.com",
]) {
  const text = `Ý chính ngắn.\n\nNội dung phụ.\n\n${cta}`;
  check(`nhận ra CTA: "${cta.slice(0, 28)}…"`, !codesOf(text).includes("NO_CTA"));
}

console.log("\n— Trường hợp biên —");

{
  const r = analyzeReadability("");
  check("chuỗi rỗng → không báo lỗi, không vỡ", r.ok && r.chars === 0);
}
{
  const r = analyzeReadability("   \n  \n  ");
  check("chỉ có khoảng trắng → không vỡ", r.chars === 0);
}
{
  const veryLong = "Ý chính.\n\n" + "Nội dung. ".repeat(400) + "\n\nInbox nhé!";
  check("bài quá 1500 ký tự → báo TOO_LONG", codesOf(veryLong).includes("TOO_LONG"));
}
{
  // Bài đúng chuẩn không được báo bừa — cảnh báo sai khiến người dùng bỏ qua hết
  check("bài tốt không bị báo TOO_LONG", !codesOf(GOOD).includes("TOO_LONG"));
  check("bài tốt không bị báo NO_CTA", !codesOf(GOOD).includes("NO_CTA"));
}

console.log(`\n${"=".repeat(52)}`);
console.log(`Kết quả: ${passed} đạt, ${failed} lỗi (tổng ${passed + failed})`);
console.log("=".repeat(52));
process.exit(failed === 0 ? 0 : 1);
