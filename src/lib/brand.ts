import "server-only";

import { prisma } from "./prisma";
import type { BrandContext } from "./ai-prompts";
import {
  AUTO_PILOT_GUARD_TITLE,
  autoPilotGuardNotice,
  contentScopeForPage,
  type PageReadiness,
} from "./brand-scope";
import { notify } from "./notify";

// ============================================================
// Hồ sơ thương hiệu — tầng dữ liệu.
//
// Nhiệm vụ: gom mọi thứ AI cần biết về một Page (thông tin doanh nghiệp,
// giọng điệu, trụ cột nội dung, tài liệu tham khảo) thành một BrandContext
// để nhét vào prompt.
//
// Điểm quan trọng: KHÔNG nhét hết tài liệu vào prompt. Một Page có thể có
// hàng chục tài liệu, nhét hết sẽ vượt context và làm AI loãng thông tin.
// Thay vào đó chọn ra vài tài liệu LIÊN QUAN NHẤT tới loại bài sắp viết.
// ============================================================

/** Số tài liệu tối đa đưa vào một prompt. */
export const MAX_DOCS_IN_PROMPT = 4;
/** Cắt bớt tài liệu quá dài để không làm nghẽn prompt. */
export const MAX_DOC_CHARS = 2000;

/** Từ dừng tiếng Việt — bỏ khi tính độ liên quan. */
const STOPWORDS = new Set([
  "va", "la", "cua", "cho", "voi", "cac", "nhung", "mot", "nhieu", "khi", "thi",
  "de", "trong", "ngoai", "tren", "duoi", "ve", "theo", "tu", "den", "hay",
  "hoac", "nen", "se", "da", "dang", "bi", "duoc", "co", "khong", "gi", "sao",
]);

/** Bỏ dấu tiếng Việt để so khớp không phân biệt dấu. */
export function normalizeVi(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

function tokens(text: string): string[] {
  return normalizeVi(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/** Ưu tiên loại tài liệu hữu ích hơn khi điểm liên quan bằng nhau. */
const KIND_PRIORITY: Record<string, number> = {
  PRICE: 5,
  PRODUCT: 4,
  FAQ: 3,
  POLICY: 2,
  STORY: 1,
  OTHER: 0,
};

export type KnowledgeDocRow = {
  id: string;
  title: string;
  kind: string;
  content: string;
  enabled: boolean;
};

/**
 * Chọn những tài liệu liên quan nhất tới `focus` (thường là tên + mô tả
 * trụ cột nội dung). Nếu Page ít tài liệu thì lấy hết.
 */
export function pickRelevantDocs(
  docs: KnowledgeDocRow[],
  focus: string,
  limit = MAX_DOCS_IN_PROMPT
): KnowledgeDocRow[] {
  const enabled = docs.filter((d) => d.enabled);
  if (enabled.length <= limit) return enabled;

  const focusTokens = new Set(tokens(focus));

  const scored = enabled.map((doc, index) => {
    const docTokens = new Set(tokens(`${doc.title} ${doc.content}`));
    let overlap = 0;
    for (const t of focusTokens) if (docTokens.has(t)) overlap++;

    // Điểm = mức liên quan, rồi tới loại tài liệu, rồi thứ tự gốc (ổn định)
    return {
      doc,
      score: overlap * 10 + (KIND_PRIORITY[doc.kind] ?? 0),
      index,
    };
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, limit).map((s) => s.doc);
}

/** Cắt tài liệu dài, ghi rõ là đã cắt để AI không tưởng là hết nội dung. */
function truncateDoc(content: string): string {
  const text = content.trim();
  if (text.length <= MAX_DOC_CHARS) return text;
  return `${text.slice(0, MAX_DOC_CHARS)}\n…(tài liệu còn nữa nhưng đã lược bớt)`;
}

export type BrandSource = {
  brandName: string | null;
  tagline: string | null;
  description: string | null;
  industry: string | null;
  products: string | null;
  usp: string | null;
  priceRange: string | null;
  audience: string | null;
  /** Danh sách địa bàn hoạt động, mỗi dòng một mục (không bắt buộc). */
  serviceAreas: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  tone: string;
  avoidTopics: string | null;
  signatureCta: string | null;
  baseHashtags: string | null;
  samplePosts: string | null;
  notes: string | null;
};

// ============================================================
// TRA CỨU THEO BRAND — nguồn sự thật duy nhất.
//
// Phần logic THUẦN (contentScopeForPage, readinessProblem, type PageReadiness)
// nằm ở ./brand-scope để kiểm thử được mà không cần database. File này bọc
// thêm phần truy vấn Prisma rồi re-export lại, để nơi khác chỉ cần import từ
// "@/lib/brand".
// ============================================================

export {
  contentScopeForPage,
  minimalProfileProblem,
  readinessProblem,
  AUTO_PILOT_GUARD_TITLE,
  autoPilotConfirmPrompt,
  autoPilotBlockedError,
  autoPilotGuardNotice,
  formatPageNames,
} from "./brand-scope";
export type { PageReadiness };

/** Brand của một Page. `null` = Page chưa gắn thương hiệu. */
export async function resolvePageBrand(pageId: string): Promise<{
  brandId: string | null;
  brandName: string | null;
} | null> {
  const page = await prisma.facebookPage.findUnique({
    where: { id: pageId },
    select: { brandId: true, brand: { select: { name: true } } },
  });
  if (!page) return null;
  return { brandId: page.brandId, brandName: page.brand?.name ?? null };
}

/** Tình trạng sẵn sàng chạy tự động của một Page. */
export async function getPageReadiness(pageId: string): Promise<PageReadiness | null> {
  const scope = await resolvePageBrand(pageId);
  if (!scope) return null;

  const [pillars, profile] = await Promise.all([
    prisma.contentPillar.count({
      where: { ...contentScopeForPage(scope.brandId, pageId), enabled: true },
    }),
    scope.brandId
      ? prisma.brandProfile.findUnique({
          where: { brandId: scope.brandId },
          select: { description: true, products: true },
        })
      : Promise.resolve(null),
  ]);

  return {
    brandId: scope.brandId,
    brandName: scope.brandName,
    pillars,
    // Tách riêng hai trường thay vì gộp thành `hasProfile`: giao diện cần chỉ
    // đúng ô còn thiếu, và điều kiện bật tự động đòi CẢ HAI (xem
    // minimalProfileProblem trong brand-scope.ts).
    hasDescription: Boolean(profile?.description?.trim()),
    hasProducts: Boolean(profile?.products?.trim()),
  };
}

// ============================================================
// BẢO VỆ LỊCH ĐĂNG TỰ ĐỘNG — tầng dữ liệu.
//
// Xem khối giải thích ở ./brand-scope.ts. Tóm tắt: trước khi cho phép một thao
// tác làm Page mất thông tin doanh nghiệp, phải biết CHÍNH XÁC Page nào đang
// bật tự động đăng để (a) hỏi xác nhận và (b) tắt đúng những Page đó.
//
// Vì sao tra qua Brand chứ không qua Page: xoá Brand ảnh hưởng tới MỌI Page
// gắn với nó, không chỉ một Page.
// ============================================================

/** Một Page đang bật tự động đăng và sẽ bị ảnh hưởng bởi thao tác. */
export type AutoPilotImpact = {
  pageId: string;
  pageName: string;
  /** Chủ Page — để gửi thông báo sau khi tự tắt. */
  userId: string;
};

/** Mọi Page đang BẬT tự động đăng thuộc một Brand. */
export async function autoPilotPagesForBrand(brandId: string): Promise<AutoPilotImpact[]> {
  const rows = await prisma.facebookPage.findMany({
    where: { brandId, autopilot: { enabled: true } },
    select: { id: true, name: true, userId: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ pageId: r.id, pageName: r.name, userId: r.userId }));
}

/** Page này có đang bật tự động đăng không (dùng cho thao tác chỉ đụng 1 Page). */
export async function autoPilotPagesForPage(pageId: string): Promise<AutoPilotImpact[]> {
  const page = await prisma.facebookPage.findFirst({
    where: { id: pageId, autopilot: { enabled: true } },
    select: { id: true, name: true, userId: true },
  });
  if (!page) return [];
  return [{ pageId: page.id, pageName: page.name, userId: page.userId }];
}

/**
 * Tắt tự động đăng cho các Page đã cho và báo cho chủ Page.
 *
 * CỐ Ý không xoá bài đã lên lịch: người dùng chỉ mất việc tạo bài MỚI, còn lịch
 * đã có vẫn đăng bình thường. Cũng không ghi `lastPlanError` — lần bật lại phải
 * sạch, nếu không lớp nghỉ-sau-lỗi 15 phút sẽ chặn ngay lượt đầu.
 *
 * @returns số Page thực sự được tắt.
 */
export async function disableAutoPilotForPages(
  pages: AutoPilotImpact[],
  reason: string
): Promise<number> {
  if (pages.length === 0) return 0;

  const result = await prisma.autoPilot.updateMany({
    where: { pageId: { in: pages.map((p) => p.pageId) }, enabled: true },
    data: { enabled: false, lastPlanError: null },
  });

  // Báo cho từng chủ Page — họ phải biết vì sao lịch đăng đột nhiên dừng.
  // Lỗi gửi thông báo không được làm hỏng thao tác chính.
  const body = autoPilotGuardNotice(
    reason,
    pages.map((p) => p.pageName)
  );
  for (const userId of [...new Set(pages.map((p) => p.userId))]) {
    await notify(userId, {
      type: "SYSTEM",
      title: AUTO_PILOT_GUARD_TITLE,
      body,
      link: "/autopilot",
    }).catch(() => {
      // Không chặn luồng nếu không gửi được
    });
  }

  return result.count;
}

/**
 * Gom hồ sơ + tài liệu liên quan thành BrandContext cho prompt.
 *
 * `pageName` dùng làm tên thương hiệu dự phòng khi người dùng chưa nhập.
 */
export async function loadBrandContext(
  pageId: string,
  opts: { focus?: string; pageName?: string } = {}
): Promise<BrandContext | undefined> {
  // Nội dung thương hiệu thuộc Brand — tra brandId của Page rồi query theo brand.
  // Page chưa gắn brand (dữ liệu cũ) → fallback theo pageId.
  const scope = await resolvePageBrand(pageId);
  const brandId = scope?.brandId ?? null;

  const [profile, docs] = await Promise.all([
    brandId ? prisma.brandProfile.findUnique({ where: { brandId } }) : Promise.resolve(null),
    prisma.knowledgeDoc.findMany({
      where: { ...contentScopeForPage(brandId, pageId), enabled: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, kind: true, content: true, enabled: true },
    }),
  ]);

  const selected = pickRelevantDocs(docs, opts.focus ?? "", MAX_DOCS_IN_PROMPT);

  const hasAnything =
    profile !== null ||
    selected.length > 0 ||
    Boolean(opts.pageName?.trim());

  if (!hasAnything) return undefined;

  return {
    brandName: profile?.brandName?.trim() || opts.pageName?.trim() || undefined,
    tagline: profile?.tagline ?? undefined,
    description: profile?.description ?? undefined,
    industry: profile?.industry ?? undefined,
    products: profile?.products ?? undefined,
    usp: profile?.usp ?? undefined,
    priceRange: profile?.priceRange ?? undefined,
    audience: profile?.audience ?? undefined,
    serviceAreas: profile?.serviceAreas ?? undefined,
    address: profile?.address ?? undefined,
    phone: profile?.phone ?? undefined,
    website: profile?.website ?? undefined,
    avoidTopics: profile?.avoidTopics ?? undefined,
    signatureCta: profile?.signatureCta ?? undefined,
    baseHashtags: profile?.baseHashtags ?? undefined,
    samplePosts: profile?.samplePosts ?? undefined,
    notes: profile?.notes ?? undefined,
    knowledge: selected.map((d) => ({
      title: d.title,
      kind: d.kind,
      content: truncateDoc(d.content),
    })),
  };
}

/**
 * Trụ cột nội dung mặc định cho một Page mới.
 *
 * Người dùng không nên phải bắt đầu từ trang giấy trắng — đây là bộ khung
 * chuẩn của một Page bán hàng, họ chỉ cần sửa lại cho hợp.
 */
export const DEFAULT_PILLARS: {
  name: string;
  description: string;
  goal: string;
  weight: number;
}[] = [
  {
    name: "Giới thiệu sản phẩm",
    description:
      "Giới thiệu một sản phẩm/dịch vụ cụ thể: đặc điểm nổi bật, phù hợp với ai, giải quyết vấn đề gì. Kết thúc bằng lời mời liên hệ tư vấn.",
    goal: "sales",
    weight: 40,
  },
  {
    name: "Chia sẻ kiến thức",
    description:
      "Mẹo hữu ích, hướng dẫn chọn/ dùng/ bảo quản sản phẩm, giải đáp thắc mắc thường gặp. Mục tiêu là cho đi giá trị, không bán.",
    goal: "education",
    weight: 25,
  },
  {
    name: "Khách hàng & công trình thực tế",
    description:
      "Kể lại một trường hợp khách hàng hoặc công trình đã làm: khách cần gì, đã xử lý thế nào, kết quả ra sao. Chân thật, không phóng đại.",
    goal: "awareness",
    weight: 20,
  },
  {
    name: "Tương tác cộng đồng",
    description:
      "Đặt câu hỏi, minigame nhỏ, bình chọn, hoặc nội dung đời thường khiến người xem muốn bình luận.",
    goal: "engagement",
    weight: 15,
  },
];

// ============================================================
// Load BrandContext theo brandId (composer — "viết theo thương hiệu")
// ============================================================

/**
 * Nạp hồ sơ + tài liệu của một Brand cụ thể để đưa vào prompt AI.
 *
 * Khác `loadBrandContext` (tra qua Page), hàm này nhận thẳng brandId —
 * dùng cho form soạn bài cho phép chọn thương hiệu muốn viết.
 * Kiểm tra user là thành viên workspace sở hữu brand trước khi trả dữ liệu.
 */
export async function loadBrandContextByBrand(
  userId: string,
  brandId: string,
  opts: { focus?: string } = {}
): Promise<BrandContext | undefined> {
  const brand = await prisma.brand.findUnique({
    where: { id: brandId },
    select: {
      id: true,
      name: true,
      workspaceId: true,
      profile: true,
      docs: {
        where: { enabled: true },
        orderBy: { createdAt: "asc" },
        select: { id: true, title: true, kind: true, content: true, enabled: true },
      },
    },
  });
  if (!brand) return undefined;

  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: brand.workspaceId, userId } },
  });
  if (!member) return undefined;

  const selected = pickRelevantDocs(brand.docs, opts.focus ?? "", MAX_DOCS_IN_PROMPT);
  const profile = brand.profile;
  if (!profile && selected.length === 0) return undefined;

  return {
    brandName: profile?.brandName?.trim() || brand.name,
    tagline: profile?.tagline ?? undefined,
    description: profile?.description ?? undefined,
    industry: profile?.industry ?? undefined,
    products: profile?.products ?? undefined,
    usp: profile?.usp ?? undefined,
    priceRange: profile?.priceRange ?? undefined,
    audience: profile?.audience ?? undefined,
    serviceAreas: profile?.serviceAreas ?? undefined,
    address: profile?.address ?? undefined,
    phone: profile?.phone ?? undefined,
    website: profile?.website ?? undefined,
    avoidTopics: profile?.avoidTopics ?? undefined,
    signatureCta: profile?.signatureCta ?? undefined,
    baseHashtags: profile?.baseHashtags ?? undefined,
    samplePosts: profile?.samplePosts ?? undefined,
    notes: profile?.notes ?? undefined,
    knowledge: selected.map((d) => ({
      title: d.title,
      kind: d.kind,
      content: truncateDoc(d.content),
    })),
  };
}
