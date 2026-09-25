"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentUser, resolveWorkspace } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PILLARS } from "@/lib/brand";
import {
  autoPilotBlockedError,
  disableAutoPilotForPages,
  autoPilotPagesForBrand,
  minimalProfileProblem,
  type AutoPilotImpact,
} from "@/lib/brand";

// ============================================================
// Server action cho trang Thương hiệu (đa brand).
//
// Hồ sơ + trụ cột + kho tài liệu thuộc về BRAND — dùng chung cho
// mọi Page của thương hiệu. Mọi action kiểm tra brand thuộc
// workspace của user đang đăng nhập, không tin ID từ client.
//
// BẢO VỆ LỊCH ĐĂNG TỰ ĐỘNG: các action có thể làm Page mất thông tin doanh
// nghiệp (xoá Brand, xoá/tắt trụ cột cuối, làm trống hồ sơ) đều đi qua
// `guardAutoPilot()` — xem khối giải thích ở src/lib/brand-scope.ts.
// ============================================================

export type BrandState = {
  ok?: boolean;
  error?: string;
  message?: string;
  /**
   * true = thao tác bị hoãn vì sẽ làm Page đang tự động đăng mất thông tin
   * doanh nghiệp. Giao diện phải hỏi xác nhận rồi gọi lại kèm
   * `confirmAutoPilotOff = true`.
   */
  needsAutoPilotConfirmation?: boolean;
  /** Tên các Page bị ảnh hưởng — để hiện trong hộp thoại xác nhận. */
  affectedPages?: string[];
} | null;

/**
 * Cổng chặn dùng chung cho mọi action có thể làm hỏng AutoPilot.
 *
 * Trả `null` = được phép đi tiếp. Trả `BrandState` = phải dừng và báo cho
 * giao diện (kèm danh sách Page bị ảnh hưởng để hỏi xác nhận).
 *
 * @param action                mô tả thao tác, dùng trong câu lỗi
 * @param pages                 các Page đang bật tự động đăng và bị ảnh hưởng
 * @param confirmAutoPilotOff   người dùng đã đồng ý tắt tự động đăng chưa
 * @param reason                lý do tắt — ghi vào thông báo cho chủ Page
 */
async function guardAutoPilot(
  action: string,
  pages: AutoPilotImpact[],
  confirmAutoPilotOff: boolean,
  reason: string
): Promise<BrandState> {
  if (pages.length === 0) return null;

  const names = pages.map((p) => p.pageName);

  if (!confirmAutoPilotOff) {
    // Chưa xác nhận: KHÔNG thực hiện gì cả, chỉ báo để giao diện hỏi lại.
    return {
      ok: false,
      error: autoPilotBlockedError(action, names),
      needsAutoPilotConfirmation: true,
      affectedPages: names,
    };
  }

  await disableAutoPilotForPages(pages, reason);
  return null;
}

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const nullable = (fd: FormData, key: string) => str(fd, key) || null;

/**
 * Chuẩn hoá kiểu xuống dòng về "\n".
 *
 * Trình duyệt luôn gửi giá trị <textarea> dạng CRLF ("\r\n") theo chuẩn HTML,
 * nên nếu lưu nguyên thì DB chứa ký tự "\r" thừa. Hàm đọc danh sách vẫn xử lý
 * được, nhưng chuẩn hoá tại đây giữ dữ liệu sạch và nhất quán.
 */
const multiline = (fd: FormData, key: string) => {
  const value = nullable(fd, key);
  return value ? value.replace(/\r\n?/g, "\n") : null;
};

/** Giới hạn độ dài để một ô nhập không thể làm phình prompt vô hạn. */
const MAX_FIELD = 4000;
const MAX_DOC = 20000;

function tooLong(value: string | null, limit: number): boolean {
  return value !== null && value.length > limit;
}

/** Brand + kiểm tra user là thành viên workspace sở hữu brand. */
async function ownedBrand(userId: string, brandId: string) {
  const brand = await prisma.brand.findUnique({
    where: { id: brandId },
    select: { id: true, name: true, workspaceId: true, slug: true },
  });
  if (!brand) return null;
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: brand.workspaceId, userId } },
  });
  if (!member) return null;
  return brand;
}

/** Sinh slug bỏ dấu tiếng Việt; thêm hậu tố nếu trùng trong workspace. */
async function uniqueBrandSlug(workspaceId: string, name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "brand";
  let slug = base;
  for (let i = 2; ; i++) {
    const exists = await prisma.brand.findUnique({
      where: { workspaceId_slug: { workspaceId, slug } },
    });
    if (!exists) return slug;
    slug = `${base}-${i}`;
  }
}

// ============================================================
// CRUD THƯƠNG HIỆU
// ============================================================

/** Tạo thương hiệu mới trong workspace. */
export async function createBrand(
  _prev: BrandState,
  formData: FormData
): Promise<BrandState> {
  await requireCurrentUser();
  const workspaceId = str(formData, "workspaceId");
  const name = str(formData, "name");
  const description = nullable(formData, "description");

  if (!name) return { ok: false, error: "Tên thương hiệu không được để trống." };
  if (name.length > 100) return { ok: false, error: "Tên tối đa 100 ký tự." };

  try {
    const ctx = await resolveWorkspace(workspaceId || null);
    const slug = await uniqueBrandSlug(ctx.workspace.id, name);
    await prisma.brand.create({
      data: { workspaceId: ctx.workspace.id, name, slug, description },
    });
    revalidatePath("/brand");
    revalidatePath("/autopilot");
    return { ok: true, message: `Đã tạo thương hiệu "${name}".` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Sửa tên/mô tả thương hiệu. */
export async function updateBrand(
  _prev: BrandState,
  formData: FormData
): Promise<BrandState> {
  const user = await requireCurrentUser();
  const brandId = str(formData, "brandId");
  const name = str(formData, "name");
  const description = nullable(formData, "description");

  if (!brandId) return { ok: false, error: "Thiếu thương hiệu." };
  if (!name) return { ok: false, error: "Tên thương hiệu không được để trống." };

  const brand = await ownedBrand(user.id, brandId);
  if (!brand) return { ok: false, error: "Thương hiệu không tồn tại." };

  await prisma.brand.update({
    where: { id: brandId },
    data: { name, description },
  });
  revalidatePath("/brand");
  return { ok: true, message: `Đã cập nhật "${name}".` };
}

/**
 * Xóa thương hiệu.
 * - Page: bỏ gán (brandId -> null, Page giữ nguyên).
 * - Post: giữ nguyên bài, mất nhãn brand (SetNull theo schema).
 * - Hồ sơ / trụ cột / tài liệu: cascade theo Brand.
 *
 * BẢO VỆ AUTOPILOT: xoá Brand làm mọi Page của nó mất Brand → mất trụ cột và
 * hồ sơ → AutoPilot hết dữ liệu để viết bài. Vì vậy phải xác nhận trước, và
 * khi đồng ý thì tắt tự động đăng cho đúng những Page đó (bài đã lên lịch vẫn
 * giữ nguyên). Trả `BrandState` thay vì `void` để giao diện hiện được lỗi —
 * bản cũ nuốt lỗi im lặng.
 *
 * @param confirmAutoPilotOff người dùng đã đồng ý tắt tự động đăng chưa.
 */
export async function deleteBrand(
  brandId: string,
  confirmAutoPilotOff = false
): Promise<BrandState> {
  const user = await requireCurrentUser();
  const brand = await ownedBrand(user.id, brandId);
  if (!brand) return { ok: false, error: "Thương hiệu không tồn tại." };

  const pages = await autoPilotPagesForBrand(brandId);
  const blocked = await guardAutoPilot(
    `Xoá thương hiệu "${brand.name}"`,
    pages,
    confirmAutoPilotOff,
    `Thương hiệu "${brand.name}" đã bị xoá.`
  );
  if (blocked) return blocked;

  await prisma.brand.delete({ where: { id: brandId } });
  revalidatePath("/brand");
  revalidatePath("/autopilot");
  revalidatePath("/pages");

  return {
    ok: true,
    message:
      pages.length > 0
        ? `Đã xoá thương hiệu "${brand.name}" và tắt tự động đăng cho ${pages.length} Page.`
        : `Đã xoá thương hiệu "${brand.name}".`,
  };
}

// ============================================================
// Hồ sơ thương hiệu (1-1 với Brand)
// ============================================================

/**
 * Lưu hồ sơ thương hiệu.
 *
 * BẢO VỆ AUTOPILOT: nếu lần lưu này làm TRỐNG phần giới thiệu doanh nghiệp hoặc
 * sản phẩm/dịch vụ thì AI không còn đủ dữ liệu để viết bài. Khi đó phải xác
 * nhận và tắt tự động đăng cho các Page đang bật.
 *
 * Vì đây là action gắn với `useActionState` (chữ ký cố định prev/formData), cờ
 * xác nhận đọc từ formData qua ô hidden `confirmAutoPilotOff` — giao diện hỏi
 * xác nhận rồi gửi lại form kèm cờ này.
 */
export async function saveBrandProfile(
  _prev: BrandState,
  formData: FormData
): Promise<BrandState> {
  const user = await requireCurrentUser();
  const brandId = str(formData, "brandId");

  const brand = await ownedBrand(user.id, brandId);
  if (!brand) return { ok: false, error: "Thương hiệu không tồn tại." };

  const data = {
    brandName: nullable(formData, "brandName"),
    tagline: nullable(formData, "tagline"),
    description: nullable(formData, "description"),
    industry: nullable(formData, "industry"),
    products: nullable(formData, "products"),
    usp: nullable(formData, "usp"),
    priceRange: nullable(formData, "priceRange"),
    audience: nullable(formData, "audience"),
    serviceAreas: multiline(formData, "serviceAreas"),
    address: nullable(formData, "address"),
    phone: nullable(formData, "phone"),
    website: nullable(formData, "website"),
    tone: str(formData, "tone") || "friendly",
    avoidTopics: nullable(formData, "avoidTopics"),
    signatureCta: nullable(formData, "signatureCta"),
    baseHashtags: nullable(formData, "baseHashtags"),
    samplePosts: nullable(formData, "samplePosts"),
    notes: nullable(formData, "notes"),
  };

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string" && tooLong(value, MAX_FIELD)) {
      return {
        ok: false,
        error: `Trường "${key}" quá dài (tối đa ${MAX_FIELD} ký tự) — rút gọn lại giúp AI tập trung hơn.`,
      };
    }
  }

  // Chỉ chặn khi lần lưu NÀY thật sự LÀM MẤT thông tin tối thiểu — tức trước đó
  // đã có mà nay bị xoá trắng. Nếu hồ sơ vốn đã thiếu sẵn (dữ liệu cũ) thì người
  // dùng đang bổ sung dở dang, chặn họ là phản tác dụng: AutoPilot vốn đã không
  // chạy được, và việc họ đang làm chính là cách sửa nó.
  const nextIsIncomplete = minimalProfileProblem({
    hasDescription: Boolean(data.description?.trim()),
    hasProducts: Boolean(data.products?.trim()),
  });

  const existingProfile = await prisma.brandProfile.findUnique({
    where: { brandId },
    select: { description: true, products: true },
  });

  const losesDescription =
    Boolean(existingProfile?.description?.trim()) && !data.description?.trim();
  const losesProducts = Boolean(existingProfile?.products?.trim()) && !data.products?.trim();

  if (losesDescription || losesProducts) {
    const pages = await autoPilotPagesForBrand(brandId);
    const blocked = await guardAutoPilot(
      `Lưu hồ sơ "${brand.name}" khi xoá mất thông tin doanh nghiệp`,
      pages,
      str(formData, "confirmAutoPilotOff") === "1",
      `Hồ sơ thương hiệu "${brand.name}" đã bị xoá mất phần thông tin doanh nghiệp.`
    );
    if (blocked) return blocked;
  }

  await prisma.brandProfile.upsert({
    where: { brandId },
    create: { userId: user.id, brandId, ...data },
    update: data,
  });

  revalidatePath("/brand");
  revalidatePath("/autopilot");

  const warning = nextIsIncomplete
    ? " Lưu ý: hồ sơ đang thiếu thông tin doanh nghiệp nên chế độ tự động chưa chạy được."
    : "";
  return { ok: true, message: `Đã lưu hồ sơ thương hiệu "${brand.name}".${warning}` };
}

// ============================================================
// Trụ cột nội dung (thuộc Brand — dùng chung mọi Page của brand)
// ============================================================

/**
 * Cổng chặn cho các thao tác XOÁ hoặc TẮT một trụ cột.
 *
 * Chỉ có ý nghĩa khi thao tác đó làm Brand còn **0 trụ cột đang bật** — lúc đó
 * AutoPilot không biết viết loại bài gì. Xoá/tắt một trụ cột trong khi vẫn còn
 * trụ cột khác là chuyện bình thường, KHÔNG hỏi gì.
 *
 * `userId` là BẮT BUỘC: hàm này đọc `brandId` từ chính trụ cột rồi tắt AutoPilot
 * cho mọi Page của Brand đó. Nếu không scope theo user, kẻ tấn công chỉ cần gửi
 * lên id trụ cột của workspace khác là tắt được lịch đăng của họ.
 *
 * @param pillarId trụ cột đang bị xoá/tắt
 * @returns `null` = cho phép đi tiếp, hoặc BrandState để dừng và hỏi xác nhận.
 */
async function guardLastEnabledPillar(
  userId: string,
  pillarId: string,
  confirmAutoPilotOff: boolean
): Promise<BrandState> {
  const pillar = await prisma.contentPillar.findFirst({
    where: { id: pillarId, userId },
    select: { brandId: true, name: true, enabled: true },
  });
  // Trụ cột không tồn tại, không thuộc user này, hoặc đang TẮT sẵn → thao tác
  // không thể làm giảm số trụ cột đang bật, nên không cần chặn.
  if (!pillar || !pillar.enabled) return null;

  const stillEnabled = await prisma.contentPillar.count({
    where: { brandId: pillar.brandId, enabled: true, id: { not: pillarId } },
  });
  if (stillEnabled > 0) return null;

  const pages = await autoPilotPagesForBrand(pillar.brandId);
  return guardAutoPilot(
    `Xoá/tắt trụ cột "${pillar.name}" (trụ cột đang bật cuối cùng)`,
    pages,
    confirmAutoPilotOff,
    `Thương hiệu không còn trụ cột nội dung nào đang bật (trụ cột "${pillar.name}" đã bị xoá hoặc tắt).`
  );
}

export async function createDefaultPillars(brandId: string): Promise<BrandState> {
  const user = await requireCurrentUser();
  const brand = await ownedBrand(user.id, brandId);
  if (!brand) return { ok: false, error: "Thương hiệu không tồn tại." };

  const existing = await prisma.contentPillar.count({ where: { brandId } });
  if (existing > 0) {
    return { ok: false, error: "Thương hiệu đã có trụ cột nội dung — xóa bớt trước khi tạo bộ mặc định." };
  }

  await prisma.contentPillar.createMany({
    data: DEFAULT_PILLARS.map((p, i) => ({
      userId: user.id,
      brandId,
      name: p.name,
      description: p.description,
      goal: p.goal,
      weight: p.weight,
      enabled: true,
      position: i,
    })),
  });

  revalidatePath("/brand");
  revalidatePath("/autopilot");
  return { ok: true, message: `Đã tạo ${DEFAULT_PILLARS.length} trụ cột mặc định — sửa lại cho hợp với bạn.` };
}

export async function savePillar(
  _prev: BrandState,
  formData: FormData
): Promise<BrandState> {
  const user = await requireCurrentUser();
  const brandId = str(formData, "brandId");
  const id = str(formData, "id");
  const name = str(formData, "name");

  const brand = await ownedBrand(user.id, brandId);
  if (!brand) return { ok: false, error: "Thương hiệu không tồn tại." };
  if (!name) return { ok: false, error: "Trụ cột phải có tên." };
  if (name.length > 100) return { ok: false, error: "Tên trụ cột tối đa 100 ký tự." };

  const weight = Math.min(Math.max(Number(str(formData, "weight")) || 25, 1), 100);
  const data = {
    name,
    description: nullable(formData, "description"),
    goal: str(formData, "goal") || "engagement",
    weight,
    enabled: str(formData, "enabled") !== "0",
  };

  if (id) {
    // Sửa trụ cột đang bật thành TẮT mà đó là trụ cột bật cuối cùng → AutoPilot
    // hết trụ cột. Form hiện không gửi được giá trị này (ô `enabled` là hidden,
    // giữ nguyên trạng thái), nhưng vẫn chặn ở đây để không có đường lách.
    if (data.enabled === false) {
      const blocked = await guardLastEnabledPillar(
        user.id,
        id,
        str(formData, "confirmAutoPilotOff") === "1"
      );
      if (blocked) return blocked;
    }

    // Chỉ sửa trụ cột của chính Brand này — chặn sửa chéo workspace
    const updated = await prisma.contentPillar.updateMany({
      where: { id, brandId, userId: user.id },
      data,
    });
    if (updated.count === 0) return { ok: false, error: "Không tìm thấy trụ cột cần sửa." };
  } else {
    const count = await prisma.contentPillar.count({ where: { brandId } });
    if (count >= 12) {
      return { ok: false, error: "Tối đa 12 trụ cột mỗi thương hiệu — nhiều hơn sẽ khó xoay vòng đều." };
    }
    await prisma.contentPillar.create({
      data: { userId: user.id, brandId, position: count, ...data },
    });
  }

  revalidatePath("/brand");
  revalidatePath("/autopilot");
  return { ok: true, message: id ? "Đã cập nhật trụ cột." : `Đã thêm trụ cột "${name}".` };
}

/**
 * Xoá một trụ cột.
 *
 * BẢO VỆ AUTOPILOT: nếu đây là trụ cột ĐANG BẬT cuối cùng của Brand thì xoá nó
 * làm AutoPilot hết dữ liệu để viết bài → phải xác nhận và tắt tự động đăng.
 * Trả `BrandState` thay vì `void` để giao diện hiện được yêu cầu xác nhận.
 */
export async function deletePillar(
  id: string,
  confirmAutoPilotOff = false
): Promise<BrandState> {
  const user = await requireCurrentUser();

  // Xác minh quyền sở hữu TRƯỚC khi xét ảnh hưởng — không để lộ thông tin
  // của trụ cột thuộc user khác qua thông báo chặn.
  const owned = await prisma.contentPillar.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!owned) return { ok: false, error: "Không tìm thấy trụ cột cần xoá." };

  const blocked = await guardLastEnabledPillar(user.id, id, confirmAutoPilotOff);
  if (blocked) return blocked;

  await prisma.contentPillar.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/brand");
  revalidatePath("/autopilot");
  return { ok: true, message: "Đã xoá trụ cột." };
}

/**
 * Bật/tắt một trụ cột.
 *
 * BẢO VỆ AUTOPILOT: tắt trụ cột ĐANG BẬT cuối cùng cũng làm AutoPilot hết dữ
 * liệu — xử lý giống `deletePillar`. Bật lên thì không bao giờ chặn.
 */
export async function togglePillar(
  id: string,
  enabled: boolean,
  confirmAutoPilotOff = false
): Promise<BrandState> {
  const user = await requireCurrentUser();

  const owned = await prisma.contentPillar.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!owned) return { ok: false, error: "Không tìm thấy trụ cột." };

  if (!enabled) {
    const blocked = await guardLastEnabledPillar(user.id, id, confirmAutoPilotOff);
    if (blocked) return blocked;
  }

  await prisma.contentPillar.updateMany({ where: { id, userId: user.id }, data: { enabled } });
  revalidatePath("/brand");
  revalidatePath("/autopilot");
  return { ok: true, message: enabled ? "Đã bật trụ cột." : "Đã tắt trụ cột." };
}

// ============================================================
// Kho tài liệu (thuộc Brand)
// ============================================================

export async function saveKnowledgeDoc(
  _prev: BrandState,
  formData: FormData
): Promise<BrandState> {
  const user = await requireCurrentUser();
  const brandId = str(formData, "brandId");
  const id = str(formData, "id");
  const title = str(formData, "title");
  const content = str(formData, "content");

  const brand = await ownedBrand(user.id, brandId);
  if (!brand) return { ok: false, error: "Thương hiệu không tồn tại." };
  if (!title) return { ok: false, error: "Tài liệu phải có tiêu đề." };
  if (!content) return { ok: false, error: "Tài liệu không được để trống." };
  if (content.length > MAX_DOC) {
    return {
      ok: false,
      error: `Tài liệu quá dài (${content.length}/${MAX_DOC} ký tự) — hãy tách thành nhiều tài liệu nhỏ theo chủ đề.`,
    };
  }

  const data = {
    title: title.slice(0, 200),
    kind: str(formData, "kind") || "OTHER",
    content,
    enabled: str(formData, "enabled") !== "0",
  };

  if (id) {
    const updated = await prisma.knowledgeDoc.updateMany({
      where: { id, brandId, userId: user.id },
      data,
    });
    if (updated.count === 0) return { ok: false, error: "Không tìm thấy tài liệu cần sửa." };
  } else {
    const count = await prisma.knowledgeDoc.count({ where: { brandId } });
    if (count >= 50) {
      return { ok: false, error: "Tối đa 50 tài liệu mỗi thương hiệu." };
    }
    await prisma.knowledgeDoc.create({ data: { userId: user.id, brandId, ...data } });
  }

  revalidatePath("/brand");
  return { ok: true, message: id ? "Đã cập nhật tài liệu." : `Đã thêm tài liệu "${data.title}".` };
}

export async function deleteKnowledgeDoc(id: string): Promise<void> {
  const user = await requireCurrentUser();
  await prisma.knowledgeDoc.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/brand");
}

export async function toggleKnowledgeDoc(id: string, enabled: boolean): Promise<void> {
  const user = await requireCurrentUser();
  await prisma.knowledgeDoc.updateMany({ where: { id, userId: user.id }, data: { enabled } });
  revalidatePath("/brand");
}
