"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import {
  mediaColumnsFromAttachment,
  parseAttachments,
  validateAttachments,
} from "@/lib/posts";
import { pickMediaForContent } from "@/lib/autopilot";
import { countDriveFilesForBrand } from "./drive";
import { loadBrandContext } from "@/lib/brand";
import { generatePostVariants } from "@/lib/ai";
import { GOALS, LENGTHS, TONES, type Goal, type PostLength, type Tone } from "@/lib/ai-prompts";

// ============================================================
// Server action cho trang chi tiết bài viết (/posts/[id]).
//
// Nguyên tắc an toàn chạy suốt file này:
//   1. Mọi action đều kiểm tra bài THUỘC VỀ user đang đăng nhập.
//   2. KHÔNG cho sửa bài đang PUBLISHING (worker đang giữ) hoặc đã PUBLISHED
//      (sửa ở đây không đổi được nội dung đã lên Facebook — sửa chỉ gây hiểu lầm).
//   3. Media luôn đi qua validateAttachments để không vi phạm luật Facebook.
// ============================================================

export type PostEditState = {
  ok?: boolean;
  error?: string;
  message?: string;
} | null;

/** Trạng thái còn sửa được. Bài đang đăng hoặc đã đăng thì khóa lại. */
const EDITABLE = ["DRAFT", "PENDING_REVIEW", "SCHEDULED", "FAILED"];

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

/**
 * Chuẩn hóa xuống dòng.
 *
 * Theo chuẩn HTML, <textarea> gửi lên server với xuống dòng CRLF ("\r\n")
 * dù người dùng gõ LF. Nếu lưu nguyên, ký tự "\r" thừa sẽ đi thẳng lên
 * Facebook và làm lệch việc đếm đoạn khi chấm điểm dễ đọc.
 */
const normalizeNewlines = (s: string) => s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

/**
 * Lấy bài và kiểm tra quyền sửa.
 * Trả về lỗi cụ thể thay vì null chung chung để người dùng hiểu vì sao bị chặn.
 */
async function loadEditablePost(postId: string, userId: string) {
  const post = await prisma.post.findFirst({
    where: { id: postId, userId },
    select: {
      id: true,
      status: true,
      pageId: true,
      // brandId để nút "tìm lại ảnh" biết thư mục Drive của thương hiệu
      brandId: true,
      content: true,
      scheduledAt: true,
      pillarName: true,
      page: { select: { name: true } },
    },
  });

  if (!post) {
    return { error: "Không tìm thấy bài viết này." as const };
  }
  if (post.status === "PUBLISHING") {
    return { error: "Bài đang được đăng lên Facebook — vui lòng đợi xong rồi thử lại." as const };
  }
  if (post.status === "PUBLISHED") {
    return {
      error:
        "Bài đã đăng lên Facebook rồi nên không sửa được ở đây. Muốn đổi nội dung, hãy sửa trực tiếp trên Facebook." as const,
    };
  }
  if (!EDITABLE.includes(post.status)) {
    return { error: `Không sửa được bài ở trạng thái ${post.status}.` as const };
  }

  return { post };
}

function refresh(postId: string) {
  revalidatePath(`/posts/${postId}`);
  revalidatePath("/autopilot");
  revalidatePath("/calendar");
  revalidatePath("/history");
}

// ============================================================
// Sửa nội dung + hashtag + giờ đăng
// ============================================================

export async function updatePostContent(
  _prev: PostEditState,
  formData: FormData
): Promise<PostEditState> {
  const user = await requireCurrentUser();
  const postId = str(formData, "postId");

  const loaded = await loadEditablePost(postId, user.id);
  if ("error" in loaded) return { ok: false, error: loaded.error };

  const content = normalizeNewlines(str(formData, "content"));
  if (!content) {
    return { ok: false, error: "Nội dung bài viết không được để trống." };
  }
  if (content.length > 60_000) {
    return { ok: false, error: "Nội dung quá dài (giới hạn 60.000 ký tự)." };
  }

  // Hashtag: chuẩn hóa, chỉ giữ token bắt đầu bằng #
  const hashtags = str(formData, "hashtags")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.startsWith("#"))
    .join(" ");

  // Giờ đăng: chỉ áp dụng cho bài chưa đăng
  const rawWhen = str(formData, "scheduledAt");
  let scheduledAt = loaded.post.scheduledAt;
  if (rawWhen) {
    const parsed = new Date(rawWhen);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: "Thời gian đăng không hợp lệ." };
    }
    scheduledAt = parsed;
  }

  await prisma.post.update({
    where: { id: postId },
    data: {
      content,
      hashtags: hashtags || null,
      scheduledAt,
      // Sửa xong thì xóa lỗi cũ để người dùng không thấy cảnh báo lạc hậu
      errorMessage: null,
    },
  });

  refresh(postId);
  return { ok: true, message: "Đã lưu bài viết." };
}

// ============================================================
// Sửa danh sách media
// ============================================================

export async function updatePostMedia(
  _prev: PostEditState,
  formData: FormData
): Promise<PostEditState> {
  const user = await requireCurrentUser();
  const postId = str(formData, "postId");

  const loaded = await loadEditablePost(postId, user.id);
  if ("error" in loaded) return { ok: false, error: loaded.error };

  const media = parseAttachments(String(formData.get("media") ?? ""));

  // Luật Facebook: không trộn ảnh/video, tối đa 4 ảnh hoặc 1 video
  const check = validateAttachments(media);
  if (!check.ok) return { ok: false, error: check.error };

  // Thay toàn bộ danh sách: xóa cũ rồi ghi mới theo đúng thứ tự người dùng sắp
  await prisma.media.deleteMany({ where: { postId } });
  for (const [i, m] of media.entries()) {
    await prisma.media.create({
      data: {
        postId,
        userId: user.id,
        type: m.type,
        position: i,
        ...mediaColumnsFromAttachment(m),
      },
    });
  }

  refresh(postId);
  return {
    ok: true,
    message: media.length === 0 ? "Đã bỏ hết ảnh — bài sẽ đăng dạng chỉ có chữ." : `Đã lưu ${media.length} ảnh/video.`,
  };
}

// ============================================================
// Nhờ AI tìm lại ảnh
// ============================================================

export async function regeneratePostMedia(postId: string): Promise<PostEditState> {
  const user = await requireCurrentUser();

  const loaded = await loadEditablePost(postId, user.id);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { post } = loaded;

  if (!post.pageId) {
    return { ok: false, error: "Bài chưa gắn với Page nào nên không biết tìm ảnh theo ngành gì." };
  }

  // Dùng đúng cấu hình tự động của Page để ảnh mới nhất quán với các bài khác
  const config = await prisma.autoPilot.findUnique({ where: { pageId: post.pageId } });

  // Trạng thái Drive của Brand để nút "tìm lại ảnh" cũng tôn trọng nguồn đã chọn.
  // `driveFileCount` PHẢI cùng phạm vi với lúc chọn ảnh (theo thư mục nếu Brand
  // có gắn) — dùng chung hàm countDriveFilesForBrand để không lệch.
  const brandFolder = post.brandId
    ? await prisma.brandDriveFolder.findUnique({
        where: { brandId: post.brandId },
        select: { folderId: true, allowVideo: true },
      })
    : null;

  const driveFileCount = await countDriveFilesForBrand(user.id, post.brandId);

  const driveConn = await prisma.driveConnection.findUnique({
    where: { userId: user.id },
    select: { status: true },
  });

  const picked = await pickMediaForContent(user.id, post.content, {
    mediaKind: config?.mediaKind ?? "IMAGE",
    photosPerPost: config?.photosPerPost ?? 2,
    pageId: post.pageId,
    autoMedia: config?.autoMedia ?? true,
    mediaPrimary: config?.mediaPrimary ?? "PEXELS",
    mediaFallback: config?.mediaFallback ?? true,
    drive: driveConn
      ? { folderId: brandFolder?.folderId ?? null, connectionStatus: driveConn.status }
      : null,
    driveFileCount,
    driveAllowVideo: brandFolder?.allowVideo ?? true,
  });

  if (picked.media.length === 0) {
    return {
      ok: false,
      error: picked.error ?? "Không tìm được ảnh phù hợp — thử sửa nội dung bài rồi tìm lại.",
    };
  }

  await prisma.media.deleteMany({ where: { postId } });
  for (const [i, m] of picked.media.entries()) {
    await prisma.media.create({
      data: {
        postId,
        userId: user.id,
        type: m.type,
        position: i,
        ...mediaColumnsFromAttachment(m),
      },
    });
  }

  refresh(postId);
  return { ok: true, message: `Đã tìm ${picked.media.length} ảnh mới.` };
}

// ============================================================
// Nhờ AI viết lại nội dung
// ============================================================

export async function regeneratePostContent(postId: string): Promise<PostEditState> {
  const user = await requireCurrentUser();

  const loaded = await loadEditablePost(postId, user.id);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { post } = loaded;

  if (!post.pageId) {
    return { ok: false, error: "Bài chưa gắn với Page nào nên AI không biết viết cho thương hiệu nào." };
  }

  const pageName = post.page?.name ?? "";
  const config = await prisma.autoPilot.findUnique({ where: { pageId: post.pageId } });

  // Giữ nguyên trụ cột cũ để bài viết lại vẫn đúng loại nội dung
  const pillar = post.pillarName
    ? await prisma.contentPillar.findFirst({
        where: { pageId: post.pageId, name: post.pillarName },
        select: { name: true, description: true, goal: true },
      })
    : null;

  const brand = await loadBrandContext(post.pageId, {
    focus: pillar?.name ?? post.content.slice(0, 200),
    pageName,
  });

  const tone = (config?.toneOverride ?? "") as Tone;

  const res = await generatePostVariants({
    userId: user.id,
    topic: pillar
      ? `Bài thuộc loại "${pillar.name}". Viết lại theo một góc tiếp cận KHÁC hẳn bài cũ.`
      : "Viết lại bài đăng này theo một góc tiếp cận khác, hấp dẫn hơn.",
    tone: TONES.some((t) => t.value === tone) ? tone : "friendly",
    goal: (GOALS.some((g) => g.value === pillar?.goal) ? pillar!.goal : "engagement") as Goal,
    length: (LENGTHS.some((l) => l.value === config?.length)
      ? config!.length
      : "medium") as PostLength,
    pageName,
    variantCount: 1,
    brand: {
      ...(brand ?? {}),
      ...(pillar
        ? { pillar: { name: pillar.name, description: pillar.description ?? undefined } }
        : {}),
    },
    // Chính nội dung cũ là thứ cần tránh lặp lại
    recentTopics: [post.content.slice(0, 160)],
  });

  if (!res.ok || res.variants.length === 0) {
    return { ok: false, error: res.error ?? "AI không trả về nội dung." };
  }

  const variant = res.variants[0];

  await prisma.post.update({
    where: { id: postId },
    data: {
      content: variant.content,
      hook: variant.hook || null,
      hashtags: config?.useHashtags === false ? null : variant.hashtags || null,
      topic: variant.angle || post.pillarName,
      errorMessage: null,
    },
  });

  refresh(postId);
  return { ok: true, message: "AI đã viết lại bài — xem lại rồi lưu nếu ưng ý." };
}

// ============================================================
// Xóa bài
// ============================================================

export async function deletePostFromDetail(postId: string): Promise<PostEditState> {
  const user = await requireCurrentUser();

  const deleted = await prisma.post.deleteMany({
    where: {
      id: postId,
      userId: user.id,
      // Không bao giờ xóa bài đã lên Facebook hoặc đang đăng dở
      status: { in: ["DRAFT", "PENDING_REVIEW", "SCHEDULED", "FAILED"] },
    },
  });

  if (deleted.count === 0) {
    return { ok: false, error: "Không xóa được — bài đã đăng hoặc đang được đăng." };
  }

  revalidatePath("/autopilot");
  revalidatePath("/calendar");
  revalidatePath("/history");
  return { ok: true, message: "Đã xóa bài." };
}
