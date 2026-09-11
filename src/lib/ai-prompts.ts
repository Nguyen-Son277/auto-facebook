// ============================================================
// Prompt template cho module AI viết nội dung Facebook.
// File này chỉ chứa hằng số + hàm thuần (pure) nên dùng được
// ở cả server lẫn client component.
// ============================================================

export type Tone = "friendly" | "professional" | "exciting" | "inspiring" | "humorous";
export type Goal = "engagement" | "sales" | "awareness" | "education";
export type PostLength = "short" | "medium" | "long";

export const TONES: { value: Tone; label: string; hint: string }[] = [
  { value: "friendly", label: "Thân thiện", hint: "gần gũi, như đang trò chuyện với bạn bè" },
  { value: "professional", label: "Chuyên nghiệp", hint: "đáng tin cậy, chuẩn mực, rõ ràng" },
  { value: "exciting", label: "Sôi nổi", hint: "hào hứng, thúc đẩy hành động, phù hợp bán hàng" },
  { value: "inspiring", label: "Truyền cảm hứng", hint: "truyền động lực, khích lệ tinh thần" },
  { value: "humorous", label: "Hài hước", hint: "dí dỏm, nhẹ nhàng, dễ gây tương tác" },
];

export const GOALS: { value: Goal; label: string; hint: string }[] = [
  { value: "engagement", label: "Tăng tương tác", hint: "khuyến khích like/comment/share" },
  { value: "sales", label: "Bán hàng", hint: "giới thiệu sản phẩm, thúc đẩy mua" },
  { value: "awareness", label: "Nhận diện thương hiệu", hint: "giới thiệu thương hiệu, xây hình ảnh" },
  { value: "education", label: "Chia sẻ kiến thức", hint: "cung cấp giá trị, hướng dẫn hữu ích" },
];

// Độ dài mô tả theo CẤU TRÚC chứ không chỉ đếm ký tự.
//
// Lý do: chỉ nói "400–700 ký tự" thì AI viết một khối văn xuôi đủ số ký tự
// nhưng đọc trên điện thoại thành bức tường chữ, không nêu bật được ý chính.
// Mô tả rõ từng phần buộc AI bẻ bài thành các mảnh dễ đọc.
export const LENGTHS: { value: PostLength; label: string; hint: string }[] = [
  {
    value: "short",
    label: "Ngắn",
    hint: "1 dòng ý chính + 1–2 dòng giá trị + 1 dòng CTA (khoảng 150–250 ký tự). Không viết đoạn văn.",
  },
  {
    value: "medium",
    label: "Vừa",
    hint: "1 dòng ý chính + 3–4 gạch đầu dòng (mỗi dòng 1 ý ngắn) + 1 dòng CTA (khoảng 350–600 ký tự).",
  },
  {
    value: "long",
    label: "Dài",
    hint: "1 dòng ý chính + 2 câu dẫn + 4–5 gạch đầu dòng + 1 câu chốt + 1 dòng CTA (khoảng 700–1100 ký tự).",
  },
];

export type PostVariant = {
  /** Góc tiếp cận mà AI chọn cho phương án này. */
  angle: string;
  /**
   * Ý chính của bài, đúng một câu ngắn.
   *
   * Facebook chỉ hiện ~2 dòng đầu trước nút "Xem thêm", nên câu này quyết
   * định người ta có đọc tiếp hay không. Bắt AI trả riêng buộc nó phải nghĩ
   * ra thông điệp chính trước khi viết.
   */
  hook: string;
  /** Nội dung bài đăng (chưa gồm hashtag), đã bao gồm cả dòng ý chính. */
  content: string;
  /** Chuỗi hashtag, ví dụ "#marketing #khuyenmai". */
  hashtags: string;
};

/**
 * Hồ sơ thương hiệu đưa vào prompt.
 *
 * Đây là "tài liệu cơ bản về trang Facebook": AI chỉ được viết dựa trên
 * những gì có trong đây. Nhờ vậy bài đăng đúng ngành hàng, đúng khách hàng
 * và KHÔNG bịa giá / khuyến mãi / chứng nhận.
 */
export type BrandContext = {
  brandName?: string;
  tagline?: string;
  description?: string;
  industry?: string;
  products?: string;
  usp?: string;
  priceRange?: string;
  audience?: string;
  address?: string;
  phone?: string;
  website?: string;
  avoidTopics?: string;
  signatureCta?: string;
  baseHashtags?: string;
  samplePosts?: string;
  notes?: string;
  /** Tài liệu tham khảo đã chọn lọc (bảng giá, FAQ, chính sách...). */
  knowledge?: { title: string; kind: string; content: string }[];
  /** Trụ cột nội dung của bài này (chế độ tự động). */
  pillar?: { name: string; description?: string };
};

export type GenerateInput = {
  topic: string;
  tone: Tone;
  goal: Goal;
  length: PostLength;
  audience?: string;
  keywords?: string;
  pageName?: string;
  variantCount?: number;
  /** Hồ sơ thương hiệu — có thì AI viết đúng "chất" của Page. */
  brand?: BrandContext;
  /** Chủ đề đã đăng gần đây — AI phải tránh lặp lại (chế độ tự động). */
  recentTopics?: string[];
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const toneLabel = (t: Tone) => TONES.find((x) => x.value === t)?.label ?? t;
const toneHint = (t: Tone) => TONES.find((x) => x.value === t)?.hint ?? "";
const goalLabel = (g: Goal) => GOALS.find((x) => x.value === g)?.label ?? g;
const goalHint = (g: Goal) => GOALS.find((x) => x.value === g)?.hint ?? "";
const lengthHint = (l: PostLength) => LENGTHS.find((x) => x.value === l)?.hint ?? "";

export const SYSTEM_PROMPT = `Bạn là chuyên gia viết nội dung Facebook Marketing cho thị trường Việt Nam, có 10 năm kinh nghiệm.

QUY TẮC TRÌNH BÀY (quan trọng nhất — vi phạm là bài hỏng):
- DÒNG ĐẦU TIÊN là ý chính của cả bài, đứng riêng một dòng, TỐI ĐA 12 từ.
  Facebook chỉ hiện 1–2 dòng đầu trước nút "Xem thêm" nên dòng này quyết định tất cả.
- Sau dòng đầu phải có MỘT DÒNG TRỐNG.
- Mỗi đoạn TỐI ĐA 2 câu. Giữa các đoạn luôn có dòng trống.
- Khi nêu từ 3 ý trở lên: BẮT BUỘC mỗi ý một dòng riêng, mở đầu bằng emoji hoặc dấu "•".
  TUYỆT ĐỐI không gộp nhiều ý vào một câu dài ngăn cách bằng dấu phẩy.
- KHÔNG viết đoạn văn xuôi dài quá 280 ký tự — trên điện thoại sẽ thành bức tường chữ.
- Câu cuối là lời kêu gọi hành động, đứng riêng một dòng.

Nguyên tắc nội dung:
- Viết tiếng Việt tự nhiên, đúng chính tả, câu ngắn dễ đọc trên điện thoại.
- Mỗi câu nói MỘT ý. Ưu tiên câu dưới 20 từ.
- Tránh sáo rỗng, tránh văn phong dịch máy, tránh lặp từ.
- Dùng emoji hợp lý (1–5 emoji), không lạm dụng.
- TUYỆT ĐỐI không bịa số liệu, giá cả, chứng nhận hay cam kết cụ thể mà người dùng không cung cấp.
- Khi có HỒ SƠ THƯƠNG HIỆU hoặc TÀI LIỆU THAM KHẢO: chỉ dùng thông tin có trong đó.
  Tuyệt đối không tự nghĩ ra giá, khuyến mãi, năm thành lập, số lượng khách, giải thưởng,
  bảo hành hay địa chỉ. Nếu thiếu thông tin thì viết chung chung, KHÔNG suy diễn.
- Nếu người dùng đưa từ khóa, phải đưa các từ khóa đó vào bài một cách tự nhiên.

ĐỊNH DẠNG TRẢ VỀ: chỉ trả về DUY NHẤT một object JSON hợp lệ, không kèm giải thích, không bọc trong markdown.
Cấu trúc:
{"variants":[{"angle":"tên góc tiếp cận ngắn gọn","hook":"ý chính một câu, tối đa 12 từ","content":"nội dung bài đăng có xuống dòng bằng \\n","hashtags":"#hashtag1 #hashtag2"}]}

Lưu ý: "hook" phải TRÙNG với dòng đầu tiên của "content".`;

/** Nhãn tiếng Việt cho loại tài liệu tham khảo. */
const DOC_KIND_LABEL: Record<string, string> = {
  PRODUCT: "Sản phẩm",
  PRICE: "Bảng giá",
  FAQ: "Câu hỏi thường gặp",
  POLICY: "Chính sách",
  STORY: "Câu chuyện thương hiệu",
  OTHER: "Tài liệu",
};

export const docKindLabel = (kind: string) => DOC_KIND_LABEL[kind] ?? DOC_KIND_LABEL.OTHER;

/**
 * Dựng khối "HỒ SƠ THƯƠNG HIỆU" cho prompt.
 *
 * Chỉ liệt kê những trường người dùng thật sự đã nhập — trường trống bị bỏ qua
 * để không gợi ý cho AI rằng "chỗ này không có gì thì tự nghĩ ra".
 */
export function buildBrandBlock(brand: BrandContext): string[] {
  const lines: string[] = [];
  const add = (label: string, value?: string) => {
    if (value?.trim()) lines.push(`- ${label}: ${value.trim()}`);
  };

  add("Tên thương hiệu", brand.brandName);
  add("Câu định vị (slogan)", brand.tagline);
  add("Ngành hàng", brand.industry);
  add("Giới thiệu doanh nghiệp", brand.description);
  add("Sản phẩm/dịch vụ chính", brand.products);
  add("Khách hàng mục tiêu", brand.audience);
  add("Điểm khác biệt so với đối thủ", brand.usp);
  add("Khoảng giá (chỉ được dùng đúng khoảng này)", brand.priceRange);
  add("Địa chỉ", brand.address);
  add("Điện thoại", brand.phone);
  add("Website", brand.website);
  add("Câu kêu gọi hành động quen thuộc", brand.signatureCta);
  add("Hashtag nền tảng luôn dùng", brand.baseHashtags);
  add("Ghi chú thêm", brand.notes);

  if (brand.avoidTopics?.trim()) {
    lines.push(`- ⛔ TUYỆT ĐỐI KHÔNG nhắc tới: ${brand.avoidTopics.trim()}`);
  }

  if (lines.length === 0 && !brand.samplePosts?.trim() && !brand.knowledge?.length) {
    return [];
  }

  const out = ["=== HỒ SƠ THƯƠNG HIỆU (nguồn sự thật duy nhất) ===", ...lines];

  if (brand.samplePosts?.trim()) {
    out.push(
      "",
      "Bài viết mẫu của thương hiệu (hãy bắt chước văn phong, KHÔNG sao chép nội dung):",
      brand.samplePosts.trim()
    );
  }

  if (brand.knowledge?.length) {
    out.push("", "=== TÀI LIỆU THAM KHẢO (dùng khi cần thông tin chính xác) ===");
    for (const doc of brand.knowledge) {
      out.push(`### ${doc.title} [${docKindLabel(doc.kind)}]`, doc.content.trim(), "");
    }
  }

  out.push("=== HẾT HỒ SƠ THƯƠNG HIỆU ===");
  return out;
}

export function buildUserPrompt(input: GenerateInput): string {
  // Cho phép 1 phương án: chế độ tự động chỉ cần đúng 1 bài mỗi slot
  const count = Math.min(Math.max(input.variantCount ?? 3, 1), 3);
  const lines: string[] = [];

  if (input.brand) {
    const block = buildBrandBlock(input.brand);
    if (block.length > 0) lines.push(...block, "");
  }

  if (input.brand?.pillar) {
    lines.push(
      `=== LOẠI BÀI CẦN VIẾT: ${input.brand.pillar.name} ===`,
      input.brand.pillar.description?.trim() ||
        "Hãy viết một bài thuộc đúng loại nội dung này.",
      ""
    );
  }

  lines.push(
    `Chủ đề bài đăng: ${input.topic}`,
    `Giọng điệu: ${toneLabel(input.tone)} (${toneHint(input.tone)})`,
    `Mục tiêu: ${goalLabel(input.goal)} (${goalHint(input.goal)})`,
    `Độ dài: ${lengthHint(input.length)}`
  );

  if (input.audience?.trim()) lines.push(`Đối tượng độc giả: ${input.audience.trim()}`);
  if (input.keywords?.trim()) lines.push(`Từ khóa cần có trong bài: ${input.keywords.trim()}`);
  if (input.pageName?.trim()) lines.push(`Tên Facebook Page: ${input.pageName.trim()}`);

  if (input.recentTopics?.length) {
    lines.push(
      "",
      "Các chủ đề ĐÃ ĐĂNG GẦN ĐÂY — phải chọn góc tiếp cận KHÁC, không lặp lại:",
      ...input.recentTopics.map((t) => `- ${t}`)
    );
  }

  lines.push(
    "",
    `Hãy viết ${count} phương án KHÁC NHAU về góc tiếp cận (ví dụ: kể chuyện, liệt kê lợi ích, đặt câu hỏi gây tò mò, chia sẻ mẹo).`,
    `Mỗi phương án gồm: "angle" (tên góc tiếp cận, tối đa 6 từ), "hook" (ý chính một câu, tối đa 12 từ), "content" (nội dung bài đăng, KHÔNG chứa hashtag, dòng đầu chính là "hook"), "hashtags" (3–6 hashtag tiếng Việt không dấu hoặc tiếng Anh, cách nhau bởi dấu cách, mỗi hashtag bắt đầu bằng #).`,
    "",
    "NHẮC LẠI cách trình bày: dòng đầu là ý chính đứng riêng, sau đó một dòng trống, mỗi đoạn tối đa 2 câu, từ 3 ý trở lên thì mỗi ý một dòng có emoji hoặc dấu •, câu cuối là lời kêu gọi hành động đứng riêng một dòng.",
    "",
    "Trả về đúng JSON theo cấu trúc đã nêu."
  );

  return lines.join("\n");
}

export function buildPostMessages(input: GenerateInput): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(input) },
  ];
}

/** Dòng đầu tiên của bài — dùng làm ý chính khi model không trả "hook" riêng. */
function firstLineOf(content: string): string {
  return (content.split("\n")[0] ?? "").trim().slice(0, 160);
}

/** Bỏ rào markdown ```json ... ``` nếu model lỡ bọc JSON trong đó. */
function stripCodeFence(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : raw).trim();
}

function normalizeHashtags(value: unknown): string {
  if (typeof value !== "string") return "";
  const tags = value
    .split(/[\s,]+/)
    .map((t) => t.trim().replace(/^#*/, ""))
    .filter(Boolean)
    .map((t) => `#${t}`);
  return Array.from(new Set(tags)).join(" ");
}

/**
 * Parse phản hồi của model thành danh sách phương án.
 * Chấp nhận nhiều dạng khác nhau để không vỡ khi model trả hơi lệch:
 *  - {"variants":[...]}
 *  - {"posts":[...]} / {"options":[...]} / mảng JSON trần
 *  - một object đơn lẻ {"content":...}
 *  - văn bản thuần (không phải JSON) → coi cả bài là 1 phương án
 */
export function parseVariants(raw: string): PostVariant[] {
  const text = stripCodeFence(raw ?? "");
  if (!text) return [];

  const tryParse = (candidate: string): unknown => {
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  };

  // Lấy đoạn JSON ngoài cùng nếu model thêm chữ phía trước/sau
  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");
  const start =
    firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)
      ? firstBracket
      : firstBrace;
  const lastBrace = text.lastIndexOf("}");
  const lastBracket = text.lastIndexOf("]");
  const end = Math.max(lastBrace, lastBracket);

  const candidates: string[] = [];
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));
  candidates.push(text);

  for (const candidate of candidates) {
    const parsed = tryParse(candidate);
    if (parsed === null) continue;

    const list = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object"
        ? ((parsed as Record<string, unknown>).variants ??
          (parsed as Record<string, unknown>).posts ??
          (parsed as Record<string, unknown>).options ??
          (parsed as Record<string, unknown>).data ??
          [(parsed as Record<string, unknown>)])
        : null;

    if (!Array.isArray(list)) continue;

    const variants = list
      .map((item, i): PostVariant | null => {
        if (typeof item === "string") {
          const body = item.trim();
          return {
            angle: `Phương án ${i + 1}`,
            hook: firstLineOf(body),
            content: body,
            hashtags: "",
          };
        }
        if (!item || typeof item !== "object") return null;
        const obj = item as Record<string, unknown>;
        const content = String(
          obj.content ?? obj.text ?? obj.body ?? obj.caption ?? ""
        ).trim();
        if (!content) return null;
        // Model cũ / model yếu có thể không trả "hook" — lấy dòng đầu làm ý chính
        const hook = String(obj.hook ?? obj.headline ?? "").trim() || firstLineOf(content);
        return {
          angle: String(obj.angle ?? obj.title ?? obj.label ?? `Phương án ${i + 1}`).trim(),
          hook,
          content,
          hashtags: normalizeHashtags(obj.hashtags ?? obj.hashtag ?? obj.tags),
        };
      })
      .filter((v): v is PostVariant => v !== null);

    if (variants.length > 0) return variants;
  }

  // Không parse được JSON → dùng nguyên văn bản làm 1 phương án
  const plain = text.trim();
  return plain
    ? [{ angle: "Bản nháp AI", hook: firstLineOf(plain), content: plain, hashtags: "" }]
    : [];
}

// ============================================================
// Gợi ý từ khóa tìm ảnh/video trên Pexels
//
// Pexels tìm bằng tiếng Anh hiệu quả hơn nhiều, nên AI trả về cả
// nhãn tiếng Việt (để hiển thị) và từ khóa tiếng Anh (để tìm).
// ============================================================

export type MediaKeyword = {
  /** Nhãn tiếng Việt hiển thị cho người dùng. */
  label: string;
  /** Từ khóa tiếng Anh dùng để query Pexels. */
  query: string;
};

export const KEYWORD_SYSTEM_PROMPT = `Bạn là chuyên gia chọn ảnh/video cho bài đăng mạng xã hội.

Nhiệm vụ: đọc nội dung bài đăng tiếng Việt và đề xuất các từ khóa tìm ảnh/video trên kho Pexels.

QUY TẮC QUAN TRỌNG NHẤT — từ khóa phải tả được MỘT BỨC ẢNH CỤ THỂ:
- "query" PHẢI là tiếng Anh, 2–4 từ, gồm VẬT THỂ CHÍNH + bối cảnh hoặc chất liệu.
  Ví dụ đúng: "living room curtains", "beige linen curtain window", "office blinds sunlight".
  Ví dụ SAI: "success", "marketing", "quality service", "customer happy" — đây là khái niệm, không phải ảnh.
- Nếu bài nói về một sản phẩm cụ thể, MỌI từ khóa đều phải chứa tên sản phẩm đó bằng tiếng Anh.
  Không được trôi sang chủ đề chung chung khác.
- Khi có NGÀNH HÀNG, từ khóa phải nằm trong ngành đó. Bài về rèm cửa thì không được
  trả về "office meeting" hay "business team".
- Mỗi từ khóa phải cho ra một bức ảnh KHÁC NHAU (góc chụp, bối cảnh, cận/xa khác nhau),
  không phải 6 cách nói của cùng một thứ.
- Nhãn ("label") là tiếng Việt, giải thích ngắn gọn từ khóa đó dùng để tìm ảnh gì.
- Không đề xuất nội dung nhạy cảm, bạo lực, hoặc hình ảnh thương hiệu/người nổi tiếng cụ thể.

ĐỊNH DẠNG TRẢ VỀ: chỉ trả về DUY NHẤT một object JSON hợp lệ, không giải thích, không bọc markdown.
Cấu trúc:
{"keywords":[{"label":"nhãn tiếng Việt","query":"english search terms"}]}`;

/** Bối cảnh thương hiệu giúp AI gợi từ khóa đúng ngành thay vì chung chung. */
export type KeywordContext = {
  industry?: string;
  products?: string;
};

export function buildKeywordMessages(
  content: string,
  count = 6,
  context: KeywordContext = {}
): ChatMessage[] {
  const lines: string[] = [];

  // Đặt ngành hàng LÊN TRƯỚC nội dung: đây là ràng buộc mạnh nhất,
  // giúp AI không trôi sang chủ đề chung chung.
  if (context.industry?.trim()) {
    lines.push(`NGÀNH HÀNG (mọi từ khóa phải thuộc ngành này): ${context.industry.trim()}`, "");
  }
  if (context.products?.trim()) {
    lines.push(
      "SẢN PHẨM/DỊCH VỤ của thương hiệu:",
      context.products.trim().slice(0, 600),
      ""
    );
  }

  lines.push(
    "Nội dung bài đăng:",
    content,
    "",
    `Hãy đề xuất ${count} từ khóa tìm ảnh/video, sắp xếp theo mức độ phù hợp giảm dần.`,
    "Mỗi từ khóa phải cho ra một bức ảnh khác nhau về góc chụp hoặc bối cảnh.",
    "Trả về đúng JSON theo cấu trúc đã nêu."
  );

  return [
    { role: "system", content: KEYWORD_SYSTEM_PROMPT },
    { role: "user", content: lines.join("\n") },
  ];
}

/** Parse danh sách từ khóa, chấp nhận nhiều dạng trả về khác nhau. */
export function parseMediaKeywords(raw: string): MediaKeyword[] {
  const text = stripCodeFence(raw ?? "");
  if (!text) return [];

  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");
  const start =
    firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)
      ? firstBracket
      : firstBrace;
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));

  const candidates: string[] = [];
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));
  candidates.push(text);

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }

    const list = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" && parsed !== null
        ? ((parsed as Record<string, unknown>).keywords ??
          (parsed as Record<string, unknown>).queries ??
          (parsed as Record<string, unknown>).suggestions)
        : null;

    if (!Array.isArray(list)) continue;

    const keywords = list
      .map((item): MediaKeyword | null => {
        if (typeof item === "string") {
          const q = item.trim();
          return q ? { label: q, query: q } : null;
        }
        if (!item || typeof item !== "object") return null;
        const obj = item as Record<string, unknown>;
        const query = String(obj.query ?? obj.en ?? obj.keyword ?? obj.search ?? "").trim();
        if (!query) return null;
        return {
          label: String(obj.label ?? obj.vi ?? obj.name ?? query).trim(),
          query,
        };
      })
      .filter((k): k is MediaKeyword => k !== null);

    if (keywords.length > 0) {
      // Loại trùng theo query
      const seen = new Set<string>();
      return keywords.filter((k) => {
        const key = k.query.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
  }

  return [];
}
