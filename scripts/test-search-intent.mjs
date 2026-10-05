// ============================================================
// Kiểm thử hướng viết "theo người dùng TÌM KIẾM".
//
// Chạy: npm run test:search-intent
//
// Bối cảnh: người mua không đọc quảng cáo — họ gõ vào ô tìm kiếm những câu như
// "mua rèm cửa Dĩ An" hay "chỗ nào bán rèm cuốn Bình Dương". Bài đăng chỉ được
// tìm thấy khi câu chữ trùng với cách người ta gõ.
//
// Bộ test này bảo vệ HAI thứ cùng lúc:
//   1. Prompt CÓ dạy AI ghép cụm từ khóa tìm kiếm (nếu không, tính năng biến mất
//      âm thầm khi ai đó sửa lại prompt).
//   2. Prompt KHÔNG mở đường cho AI bịa — chỉ được ghép cụm từ từ vựng có trong
//      hồ sơ thương hiệu. Đây là rủi ro thật của tính năng: muốn có từ khóa đẹp
//      thì model rất dễ tự nghĩ ra sản phẩm/khu vực mới.
//
// Toàn bộ là hàm THUẦN nên không cần dev server, không cần database.
// ============================================================

import {
  MAX_PRODUCT_LINE_CHARS,
  MAX_PRODUCTS_IN_PROMPT,
  SEARCH_INTENT_CLAUSE,
  SYSTEM_PROMPT,
  buildSearchIntentBlock,
  buildUserPrompt,
} from "../src/lib/ai-prompts.ts";

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

const blockText = (brand, goal) => buildSearchIntentBlock(brand, goal).join("\n");

/** Hồ sơ mẫu có đầy đủ sản phẩm + khu vực + giá. */
const FULL_BRAND = {
  brandName: "Shop Rèm",
  industry: "Nội thất - rèm cửa",
  products: "Rèm vải một màu\nRèm cầu vồng\nRèm cuốn chống nắng",
  serviceAreas: "Bình Dương\nThủ Dầu Một\nDĩ An",
  serviceArea: "Dĩ An",
  priceRange: "150.000 – 450.000đ/m²",
};

// ============================================================
section("SYSTEM_PROMPT dạy ghép cụm từ khóa tìm kiếm");
// ============================================================

{
  check("system prompt có mục HƯỚNG NGƯỜI DÙNG TÌM KIẾM", SYSTEM_PROMPT.includes("HƯỚNG NGƯỜI DÙNG TÌM KIẾM"));
  check("có hằng số SEARCH_INTENT_CLAUSE riêng để test được", SEARCH_INTENT_CLAUSE.length > 0);
  check(
    "clause nằm trong system prompt",
    SYSTEM_PROMPT.includes(SEARCH_INTENT_CLAUSE)
  );
}

{
  // Bốn khuôn truy vấn người dùng nêu ra trong yêu cầu
  check('có khuôn "mua <sản phẩm>"', SEARCH_INTENT_CLAUSE.includes("mua <sản phẩm>"));
  check('có khuôn "bán <sản phẩm>"', SEARCH_INTENT_CLAUSE.includes("bán <sản phẩm>"));
  check(
    'có khuôn "chỗ nào bán" / "ở đâu bán"',
    SEARCH_INTENT_CLAUSE.includes("chỗ nào bán") && SEARCH_INTENT_CLAUSE.includes("ở đâu bán")
  );
  check("có khuôn hỏi giá", SEARCH_INTENT_CLAUSE.includes("giá <sản phẩm>"));
  check(
    "có khuôn loại nào tốt / có nên dùng",
    SEARCH_INTENT_CLAUSE.includes("loại nào tốt") && SEARCH_INTENT_CLAUSE.includes("có nên dùng")
  );
}

{
  check("quy định 2–4 cụm mỗi bài", SEARCH_INTENT_CLAUSE.includes("2–4 CỤM"));
  check(
    "cụm đầu tiên phải nằm ở dòng đầu",
    SEARCH_INTENT_CLAUSE.includes("CỤM ĐẦU TIÊN") && SEARCH_INTENT_CLAUSE.includes("DÒNG ĐẦU TIÊN")
  );
  check("có luật chống nhồi từ khóa", SEARCH_INTENT_CLAUSE.includes("CHỐNG NHỒI TỪ KHÓA"));
}

{
  check(
    "CHỐT CHẶN: chỉ dùng từ vựng có trong hồ sơ",
    SEARCH_INTENT_CLAUSE.includes("CHỈ được dùng tên sản phẩm, ngành hàng và khu vực CÓ TRONG HỒ SƠ")
  );
  check(
    "CHỐT CHẶN: cấm tự nghĩ ra sản phẩm/khu vực mới",
    SEARCH_INTENT_CLAUSE.includes("không tự nghĩ ra sản phẩm, khu vực hay địa danh mới")
  );
  check(
    "thiếu khu vực thì bỏ phần khu vực",
    SEARCH_INTENT_CLAUSE.includes("KHÔNG có khu vực nào thì BỎ phần khu vực")
  );
  check(
    "thiếu giá thì không dùng khuôn giá",
    SEARCH_INTENT_CLAUSE.includes("không nêu khoảng giá thì KHÔNG dùng khuôn có chữ")
  );
}

{
  // Không được ép khuôn bán hàng vào bài kiến thức
  check(
    "bài bán hàng ưu tiên khuôn mua/bán",
    SEARCH_INTENT_CLAUSE.includes("Bài BÁN HÀNG") && SEARCH_INTENT_CLAUSE.includes("ưu tiên các khuôn mua/bán")
  );
  check(
    "bài kiến thức KHÔNG nhét chữ mua/bán",
    SEARCH_INTENT_CLAUSE.includes("KHÔNG nhét chữ")
  );
}

// ============================================================
section("Khối CỤM TỪ KHÓA: đúng từ vựng của thương hiệu");
// ============================================================

{
  const text = blockText(FULL_BRAND, "sales");
  check("có tiêu đề khối", text.includes("=== CỤM TỪ KHÓA NGƯỜI DÙNG HAY TÌM ==="));
  check("liệt kê đủ 3 sản phẩm", ["Rèm vải một màu", "Rèm cầu vồng", "Rèm cuốn chống nắng"].every((p) => text.includes(p)));
  check("nêu khu vực bài này nhắm tới", text.includes("Dĩ An"));
  check("nêu các khu vực còn lại trong danh sách", text.includes("Bình Dương") && text.includes("Thủ Dầu Một"));
  check(
    "khu vực mục tiêu được đánh dấu rõ",
    text.includes("Dĩ An  ← khu vực bài NÀY nhắm tới")
  );
  check("có mẫu câu đã điền tên thật của thương hiệu", text.includes("mua Rèm vải một màu Dĩ An"));
  check("có mẫu khuôn giá vì hồ sơ có khoảng giá", text.includes("giá Rèm vải một màu Dĩ An"));
  check("nhắc lại giới hạn 2–4 cụm", text.includes("2–4 cụm"));
}

{
  // Chốt chặn quan trọng nhất: khối chỉ được chứa từ vựng CÓ THẬT trong hồ sơ.
  const text = blockText(FULL_BRAND, "sales");
  const foreign = ["Hà Nội", "Đồng Nai", "Sài Gòn", "Rèm nhựa", "Sofa", "Quận 7"];
  for (const word of foreign) {
    check(`KHÔNG chứa từ ngoài hồ sơ: "${word}"`, !text.includes(word));
  }
}

{
  // Khuôn mẫu phải lấy sản phẩm ĐẦU TIÊN, không trộn nhiều sản phẩm vào một câu
  const text = blockText({ products: "Rèm vải\nRèm cuốn" }, "sales");
  check("mẫu câu dùng sản phẩm đầu tiên", text.includes("mua Rèm vải"));
  check("không ghép 2 sản phẩm vào cùng một mẫu", !text.includes("mua Rèm vải Rèm cuốn"));
}

// ============================================================
section("Khối CỤM TỪ KHÓA: sản phẩm TRỌNG TÂM (chống trùng chủ thể)");
// ============================================================
// Bối cảnh: nếu mẫu câu luôn dựng từ sản phẩm đầu danh sách thì mọi bài đều nói
// về đúng sản phẩm đó, chỉ đổi khu vực — Facebook coi là nội dung trùng và giảm
// phân phối. Bộ lập kế hoạch xoay vòng sản phẩm và truyền vào `focusProduct`.

{
  const brand = {
    products: "Rèm vải buông\nRèm cầu vồng\nRèm cuốn",
    serviceAreas: "Dĩ An\nQuận 7",
    serviceArea: "Dĩ An",
    focusProduct: "Rèm cuốn",
  };
  const text = blockText(brand, "sales");
  check("mẫu câu dựng theo sản phẩm trọng tâm", text.includes("mua Rèm cuốn Dĩ An"));
  check("KHÔNG còn lấy sản phẩm đầu làm mẫu", !text.includes("mua Rèm vải buông Dĩ An"));
  check("đánh dấu sản phẩm trọng tâm trong danh sách", text.includes("Rèm cuốn  ← SẢN PHẨM TRỌNG TÂM"));
  check("nói rõ sản phẩm trọng tâm của bài", text.includes("Sản phẩm TRỌNG TÂM của bài này: Rèm cuốn"));
  check("yêu cầu không chọn lại sản phẩm gần đây", text.includes("KHÔNG chọn lại sản phẩm đã lên bài gần đây"));
}

{
  // Sản phẩm trọng tâm không có trong hồ sơ (hồ sơ vừa đổi) → lùi về sản phẩm đầu
  const text = blockText({ products: "Rèm vải\nRèm cuốn", focusProduct: "Rèm tổ ong" }, "sales");
  check("trọng tâm lạ → lùi về sản phẩm đầu", text.includes("mua Rèm vải"));
  check("không nhắc sản phẩm ngoài hồ sơ", !text.includes("Rèm tổ ong"));
}

{
  // Một sản phẩm → không có gì để xoay, không thêm chỉ thị thừa
  const text = blockText({ products: "Rèm vải", focusProduct: "Rèm vải" }, "sales");
  check("một sản phẩm → không có chỉ thị trọng tâm", !text.includes("Sản phẩm TRỌNG TÂM của bài này:"));
}

// ============================================================
section("Prompt người dùng: chống lặp SẢN PHẨM");
// ============================================================
// Chống lặp góc tiếp cận (recentTopics) là chưa đủ: hai bài cùng sản phẩm, khác
// khu vực vẫn là nội dung trùng.

{
  const prompt = buildUserPrompt({
    userId: "u1",
    topic: "T",
    tone: "friendly",
    goal: "sales",
    length: "medium",
    recentProducts: ["Rèm vải buông", "Rèm cuốn"],
  });
  check("có khối sản phẩm đã lên bài", prompt.includes("Các SẢN PHẨM ĐÃ LÊN BÀI GẦN ĐÂY"));
  check("liệt kê sản phẩm gần đây", prompt.includes("- Rèm vải buông") && prompt.includes("- Rèm cuốn"));
  check("yêu cầu chọn sản phẩm khác", prompt.includes("PHẢI chọn sản phẩm KHÁC"));

  const noProducts = buildUserPrompt({
    userId: "u1",
    topic: "T",
    tone: "friendly",
    goal: "sales",
    length: "medium",
  });
  check("không có recentProducts → không có khối", !noProducts.includes("SẢN PHẨM ĐÃ LÊN BÀI"));
}


// ============================================================
section("Khối CỤM TỪ KHÓA: theo mục tiêu bài");
// ============================================================

{
  const selling = blockText(FULL_BRAND, "sales");
  check("mục tiêu bán hàng → có khuôn mua", selling.includes("mua Rèm vải một màu"));
  check("mục tiêu bán hàng → có khuôn chỗ nào bán", selling.includes("chỗ nào bán Rèm vải một màu"));
  check("mục tiêu bán hàng → 2–4 cụm", selling.includes("2–4 cụm"));
  check("mục tiêu bán hàng → KHÔNG có câu cấm mua/bán", !selling.includes("KHÔNG nhét chữ"));
}

{
  const edu = blockText(FULL_BRAND, "education");
  check("mục tiêu kiến thức → dùng khuôn câu hỏi", edu.includes("cách chọn Rèm vải một màu"));
  check("mục tiêu kiến thức → vẫn có loại nào tốt", edu.includes("loại nào tốt"));
  check("mục tiêu kiến thức → 1–2 cụm", edu.includes("1–2 cụm"));
  check("mục tiêu kiến thức → CẤM nhét mua/bán", edu.includes('KHÔNG nhét chữ "mua/bán/chỗ nào"'));
  check(
    "mục tiêu kiến thức → KHÔNG sinh mẫu mua/bán",
    !edu.includes("mua Rèm vải một màu") && !edu.includes("chỗ nào bán")
  );
}

{
  const aware = blockText(FULL_BRAND, "awareness");
  check("mục tiêu nhận diện → cũng không nhét mua/bán", aware.includes("KHÔNG nhét chữ"));
  check("mục tiêu nhận diện → không sinh mẫu mua", !aware.includes("mua Rèm vải một màu"));
}

{
  // goal không truyền (composer cũ / lời gọi khác) → mặc định coi là bài bán
  const noGoal = blockText(FULL_BRAND);
  check("không truyền goal → mặc định dùng khuôn mua/bán", noGoal.includes("mua Rèm vải một màu"));
}

// ============================================================
section("Khối CỤM TỪ KHÓA: trường hợp biên");
// ============================================================

{
  check("hồ sơ rỗng → không có khối", buildSearchIntentBlock({}).length === 0);
  check("chỉ có tên thương hiệu → không có khối", buildSearchIntentBlock({ brandName: "X" }).length === 0);
  check("sản phẩm rỗng + ngành rỗng → không có khối", buildSearchIntentBlock({ products: "   " }).length === 0);
}

{
  const text = blockText({ products: "Rèm vải" });
  check("không có khu vực → KHÔNG sinh mẫu câu kèm địa danh", !/mua Rèm vải \S/.test(text));
  check("không có khu vực → nói rõ thương hiệu không có khu vực nào", text.includes("Thương hiệu không có khu vực nào"));
  check("không có khu vực → cấm bịa địa danh", text.includes("KHÔNG được nhắc bất kỳ địa danh nào"));
  check("không có giá → KHÔNG sinh khuôn giá", !text.includes("giá Rèm vải"));
}

{
  // Có danh sách khu vực nhưng bài chưa gán khu vực (bài soạn tay ở /composer):
  // không được nhắm khu vực, nhưng cũng KHÔNG được nói "cấm nhắc địa danh" —
  // vì khối HỒ SƠ THƯƠNG HIỆU ở trên đã cho phép dùng đúng danh sách đó.
  const text = blockText({ products: "Rèm vải", serviceAreas: "Bình Dương\nDĩ An" });
  check("chưa gán khu vực → nói rõ không nhắm khu vực cụ thể", text.includes("KHÔNG nhắm khu vực cụ thể"));
  check(
    "chưa gán khu vực → trỏ về danh sách địa bàn của hồ sơ",
    text.includes("Địa bàn hoạt động")
  );
  check(
    "chưa gán khu vực → KHÔNG khẳng định cấm mọi địa danh (tránh mâu thuẫn hồ sơ)",
    !text.includes("KHÔNG được nhắc bất kỳ địa danh nào")
  );
  check("chưa gán khu vực → không sinh mẫu câu kèm địa danh", !text.includes("mua Rèm vải Dĩ An"));
}

{
  // Chỉ có ngành hàng, không có sản phẩm: ghép khuôn với tên ngành cho ra câu vô
  // nghĩa ("mua Nội thất") nên cố ý KHÔNG sinh mẫu.
  const block = buildSearchIntentBlock({ industry: "Nội thất - rèm cửa" });
  const text = block.join("\n");
  check("chỉ có ngành hàng → vẫn có khối", block.length > 0);
  check("chỉ có ngành hàng → nêu ngành", text.includes("Nội thất - rèm cửa"));
  check("chỉ có ngành hàng → KHÔNG sinh mẫu câu vô nghĩa", !text.includes("mua Nội thất"));
}

{
  const many = Array.from({ length: MAX_PRODUCTS_IN_PROMPT + 10 }, (_, i) => `Sản phẩm ${i}`);
  const text = blockText({ products: many.join("\n") });
  check(
    `cắt danh sách sản phẩm còn ${MAX_PRODUCTS_IN_PROMPT} mục`,
    text.includes(`Sản phẩm ${MAX_PRODUCTS_IN_PROMPT - 1}`) && !text.includes(`Sản phẩm ${MAX_PRODUCTS_IN_PROMPT}`)
  );
}

{
  const longName = "A".repeat(400);
  const text = blockText({ products: longName });
  check(
    `cắt mỗi dòng sản phẩm ở ${MAX_PRODUCT_LINE_CHARS} ký tự`,
    text.includes(`• ${"A".repeat(MAX_PRODUCT_LINE_CHARS)}`) && !text.includes(`• ${"A".repeat(MAX_PRODUCT_LINE_CHARS + 1)}`)
  );
}

{
  const text = blockText({ products: "Rèm vải\nrem vai\nRÈM VẢI\nRèm cuốn" });
  check(
    "khử trùng sản phẩm không phân biệt hoa/thường và dấu",
    text.includes("Rèm vải") && !text.includes("rem vai") && !text.includes("RÈM VẢI")
  );
  check("vẫn giữ sản phẩm khác", text.includes("Rèm cuốn"));
}

{
  // Chấp nhận cả dấu phẩy làm dấu phân cách (người dùng dán từ nguồn khác)
  const text = blockText({ products: "Rèm vải, Rèm cuốn; Rèm cầu vồng" });
  check(
    "tách được cả dấu phẩy và chấm phẩy",
    ["Rèm vải", "Rèm cuốn", "Rèm cầu vồng"].every((p) => text.includes(p))
  );
}

// ============================================================
section("Prompt người dùng: khối được ghép đúng chỗ");
// ============================================================

{
  const prompt = buildUserPrompt({
    userId: "u1",
    topic: "Giới thiệu rèm",
    tone: "friendly",
    goal: "sales",
    length: "medium",
    brand: FULL_BRAND,
  });
  check("prompt có khối cụm từ khóa", prompt.includes("=== CỤM TỪ KHÓA NGƯỜI DÙNG HAY TÌM ==="));
  check(
    "khối đặt SAU khối địa bàn (ràng buộc khu vực còn nóng)",
    prompt.indexOf("=== ĐỊA BÀN HOẠT ĐỘNG ===") <
      prompt.indexOf("=== CỤM TỪ KHÓA NGƯỜI DÙNG HAY TÌM ===")
  );
  check(
    "khối đặt TRƯỚC phần chủ đề",
    prompt.indexOf("=== CỤM TỪ KHÓA NGƯỜI DÙNG HAY TÌM ===") < prompt.indexOf("Chủ đề bài đăng:")
  );
}

{
  const prompt = buildUserPrompt({
    userId: "u1",
    topic: "Giới thiệu rèm",
    tone: "friendly",
    goal: "sales",
    length: "medium",
    keywords: "trà sữa, khai trương",
  });
  check(
    "có từ khóa người dùng → vẫn giữ nhãn cũ (mock/E2E đang bám)",
    prompt.includes("Từ khóa cần có trong bài: trà sữa, khai trương")
  );
  check(
    "có từ khóa người dùng → yêu cầu triển khai thành cụm, không dán nguyên xi",
    prompt.includes("TRIỂN KHAI các từ khóa này thành cụm truy vấn")
  );
}

{
  const prompt = buildUserPrompt({
    userId: "u1",
    topic: "Giới thiệu rèm",
    tone: "friendly",
    goal: "sales",
    length: "medium",
    brand: { brandName: "Shop Rèm", industry: "Nội thất" },
    recentTopics: ["Giới thiệu sản phẩm — mua rèm Dĩ An"],
  });
  check(
    "có chủ đề gần đây → yêu cầu đổi cách diễn đạt cụm từ khóa",
    prompt.includes("ĐỔI CÁCH DIỄN ĐẠT cụm từ khóa")
  );
  check("vẫn giữ nhãn cũ của danh sách chủ đề", prompt.includes("Các chủ đề ĐÃ ĐĂNG GẦN ĐÂY"));
}

{
  // Tương thích ngược: hồ sơ tối thiểu → prompt không có khối mới
  const prompt = buildUserPrompt({
    userId: "u1",
    topic: "Giới thiệu",
    tone: "friendly",
    goal: "engagement",
    length: "short",
    brand: { brandName: "Shop Rèm" },
  });
  check("hồ sơ không có sản phẩm/ngành → KHÔNG có khối cụm từ khóa", !prompt.includes("CỤM TỪ KHÓA NGƯỜI DÙNG HAY TÌM"));
}

{
  // Không có brand (bài generic) → cũng không có khối
  const prompt = buildUserPrompt({
    userId: "u1",
    topic: "Giới thiệu",
    tone: "friendly",
    goal: "engagement",
    length: "short",
  });
  check("không có thương hiệu → KHÔNG có khối cụm từ khóa", !prompt.includes("CỤM TỪ KHÓA"));
}

// ============================================================
section("Không phá vỡ các chốt an toàn cũ");
// ============================================================

{
  const prompt = buildUserPrompt({
    userId: "u1",
    topic: "Giới thiệu rèm",
    tone: "friendly",
    goal: "sales",
    length: "medium",
    brand: FULL_BRAND,
  });
  check(
    "vẫn cấm bịa tên khu vực khác (chốt cũ)",
    prompt.includes("TUYỆT ĐỐI không tự bịa")
  );
  check(
    "vẫn phân biệt khu vực phục vụ vs địa chỉ chi nhánh (chốt cũ)",
    prompt.includes("không phải địa chỉ chi nhánh")
  );
  check(
    "vẫn cấm bịa giá/chứng nhận (chốt cũ)",
    SYSTEM_PROMPT.includes("TUYỆT ĐỐI không bịa số liệu, giá cả, chứng nhận")
  );
  check(
    "vẫn giữ quy tắc dòng đầu tối đa 12 từ (chốt cũ)",
    SYSTEM_PROMPT.includes("TỐI ĐA 12 từ")
  );
  check(
    "vẫn giữ quy tắc câu cuối là CTA (chốt cũ)",
    SYSTEM_PROMPT.includes("Câu cuối là lời kêu gọi hành động")
  );
}

{
  // Số liệu hiệu quả vẫn phải đi kèm câu chặn cứng — tính năng mới không được
  // làm mất ràng buộc "chỉ đổi cách trình bày".
  const prompt = buildUserPrompt({
    userId: "u1",
    topic: "Giới thiệu rèm",
    tone: "friendly",
    goal: "sales",
    length: "medium",
    brand: { ...FULL_BRAND, performance: ["- Trụ cột A hiệu quả tốt."] },
  });
  check("có số liệu → vẫn kèm câu chặn cứng", prompt.includes("CHỈ được dùng để chọn GÓC TIẾP CẬN"));
  check("có số liệu → vẫn nêu hồ sơ là nguồn sự thật duy nhất", prompt.includes("nguồn sự thật duy nhất"));
}

console.log(`\n${"=".repeat(52)}`);
console.log(`Kết quả: ${passed} đạt, ${failed} lỗi (tổng ${passed + failed})`);
console.log("=".repeat(52));
process.exit(failed === 0 ? 0 : 1);
