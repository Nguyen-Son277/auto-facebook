"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentUser, resolveWorkspace } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PILLARS } from "@/lib/brand";

// ============================================================
// Server action cho trang Thương hiệu (đa brand).
//
// Hồ sơ + trụ cột + kho tài liệu thuộc về BRAND — dùng chung cho
// mọi Page của thương hiệu. Mọi action kiểm tra brand thuộc
// workspace của user đang đăng nhập, không tin ID từ client.
// ============================================================

export type BrandState = {
  ok?: boolean;
  error?: string;
  message?: string;
} | null;

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const nullable = (fd: FormData, key: string) => str(fd, key) || null;

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
 */
export async function deleteBrand(brandId: string): Promise<void> {
  const user = await requireCurrentUser();
  const brand = await ownedBrand(user.id, brandId);
  if (!brand) return;

  await prisma.brand.delete({ where: { id: brandId } });
  revalidatePath("/brand");
  revalidatePath("/autopilot");
  revalidatePath("/pages");
}

// ============================================================
// Hồ sơ thương hiệu (1-1 với Brand)
// ============================================================

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

  await prisma.brandProfile.upsert({
    where: { brandId },
    create: { userId: user.id, brandId, ...data },
    update: data,
  });

  revalidatePath("/brand");
  revalidatePath("/autopilot");
  return { ok: true, message: `Đã lưu hồ sơ thương hiệu "${brand.name}".` };
}

// ============================================================
// Trụ cột nội dung (thuộc Brand — dùng chung mọi Page của brand)
// ============================================================

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

export async function deletePillar(id: string): Promise<void> {
  const user = await requireCurrentUser();
  await prisma.contentPillar.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/brand");
  revalidatePath("/autopilot");
}

export async function togglePillar(id: string, enabled: boolean): Promise<void> {
  const user = await requireCurrentUser();
  await prisma.contentPillar.updateMany({ where: { id, userId: user.id }, data: { enabled } });
  revalidatePath("/brand");
  revalidatePath("/autopilot");
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
