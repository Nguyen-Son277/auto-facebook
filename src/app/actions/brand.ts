"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { DEFAULT_PILLARS } from "@/lib/brand";

// ============================================================
// Server action cho trang Hồ sơ thương hiệu.
//
// Đây là "nơi chứa tài liệu cơ bản về trang Facebook": người dùng nhập một
// lần, mọi bài AI viết (thủ công lẫn tự động) đều dựa trên đó.
//
// Mọi action đều kiểm tra Page thuộc về user đang đăng nhập trước khi ghi —
// không tin tưởng pageId gửi lên từ trình duyệt.
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

/** Xác nhận Page thuộc về user. Trả về null nếu không hợp lệ. */
async function assertOwnedPage(userId: string, pageId: string) {
  if (!pageId) return null;
  return prisma.facebookPage.findFirst({
    where: { id: pageId, userId },
    select: { id: true, name: true },
  });
}

// ============================================================
// Hồ sơ thương hiệu
// ============================================================

export async function saveBrandProfile(
  _prev: BrandState,
  formData: FormData
): Promise<BrandState> {
  const user = await requireCurrentUser();
  const pageId = str(formData, "pageId");

  const page = await assertOwnedPage(user.id, pageId);
  if (!page) return { ok: false, error: "Page không tồn tại hoặc không thuộc về bạn." };

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
    where: { pageId },
    create: { userId: user.id, pageId, ...data },
    update: data,
  });

  revalidatePath("/brand");
  revalidatePath("/autopilot");
  return { ok: true, message: `Đã lưu hồ sơ thương hiệu cho "${page.name}".` };
}

// ============================================================
// Trụ cột nội dung
// ============================================================

export async function createDefaultPillars(pageId: string): Promise<BrandState> {
  const user = await requireCurrentUser();
  const page = await assertOwnedPage(user.id, pageId);
  if (!page) return { ok: false, error: "Page không tồn tại hoặc không thuộc về bạn." };

  const existing = await prisma.contentPillar.count({ where: { pageId } });
  if (existing > 0) {
    return { ok: false, error: "Page này đã có trụ cột nội dung — xóa bớt trước khi tạo bộ mặc định." };
  }

  await prisma.contentPillar.createMany({
    data: DEFAULT_PILLARS.map((p, i) => ({
      userId: user.id,
      pageId,
      name: p.name,
      description: p.description,
      goal: p.goal,
      weight: p.weight,
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
  const pageId = str(formData, "pageId");
  const id = str(formData, "id");
  const name = str(formData, "name");

  const page = await assertOwnedPage(user.id, pageId);
  if (!page) return { ok: false, error: "Page không tồn tại hoặc không thuộc về bạn." };
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
    // Chỉ sửa được trụ cột của chính Page này — chặn sửa chéo
    const updated = await prisma.contentPillar.updateMany({
      where: { id, pageId, userId: user.id },
      data,
    });
    if (updated.count === 0) return { ok: false, error: "Không tìm thấy trụ cột cần sửa." };
  } else {
    const count = await prisma.contentPillar.count({ where: { pageId } });
    if (count >= 12) {
      return { ok: false, error: "Tối đa 12 trụ cột mỗi Page — nhiều hơn sẽ khó xoay vòng đều." };
    }
    await prisma.contentPillar.create({
      data: { userId: user.id, pageId, position: count, ...data },
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
// Kho tài liệu
// ============================================================

export async function saveKnowledgeDoc(
  _prev: BrandState,
  formData: FormData
): Promise<BrandState> {
  const user = await requireCurrentUser();
  const pageId = str(formData, "pageId");
  const id = str(formData, "id");
  const title = str(formData, "title");
  const content = str(formData, "content");

  const page = await assertOwnedPage(user.id, pageId);
  if (!page) return { ok: false, error: "Page không tồn tại hoặc không thuộc về bạn." };
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
      where: { id, pageId, userId: user.id },
      data,
    });
    if (updated.count === 0) return { ok: false, error: "Không tìm thấy tài liệu cần sửa." };
  } else {
    const count = await prisma.knowledgeDoc.count({ where: { pageId } });
    if (count >= 50) {
      return { ok: false, error: "Tối đa 50 tài liệu mỗi Page." };
    }
    await prisma.knowledgeDoc.create({ data: { userId: user.id, pageId, ...data } });
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
