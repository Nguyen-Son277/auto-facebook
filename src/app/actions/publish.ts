"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { buildMessage, deliverToFacebook } from "@/lib/deliver";
import { notify } from "@/lib/notify";
import { formatDateTime } from "@/lib/format-date";
import type { GraphContext } from "@/lib/facebook";
import {
  parseAttachments,
  validateAttachments,
  type AttachedMedia,
} from "@/lib/posts";

export type PublishState = {
  ok?: boolean;
  error?: string;
  message?: string;
  permalink?: string;
} | null;

export type PublishInput = {
  pageId: string;
  content: string;
  hashtags?: string;
  /** Media đính kèm — ảnh (tối đa 4) hoặc 1 video, không trộn lẫn. */
  attachments: AttachedMedia[];
};

export type PublishOutcome = {
  ok: boolean;
  message?: string;
  permalink?: string;
  error?: string;
  postId?: string;
};

/**
 * Lưu Post record + Media rows cho các ảnh đính kèm.
 * Dùng chung cho cả lưu nháp và đăng bài.
 */
async function createPostRecord(
  userId: string,
  input: PublishInput,
  status: string,
  page: { id: string; workspaceId: string; brandId: string | null } | null
) {
  const post = await prisma.post.create({
    data: {
      userId,
      workspaceId: page!.workspaceId,
      brandId: page!.brandId,
      pageId: page!.id,
      content: input.content,
      hashtags: input.hashtags?.trim() || null,
      status,
    },
  });

  for (const [i, m] of input.attachments.entries()) {
    await prisma.media.create({
      data: {
        postId: post.id,
        userId,
        workspaceId: page!.workspaceId,
        type: m.type,
        source: m.source,
        remoteUrl: m.remoteUrl,
        previewUrl: m.previewUrl ?? null,
        width: m.width ?? null,
        height: m.height ?? null,
        duration: m.duration ?? null,
        providerId: m.providerId ?? null,
        photographer: m.photographer ?? null,
        photographerUrl: m.photographerUrl ?? null,
        sourcePageUrl: m.sourcePageUrl ?? null,
        alt: m.alt ?? null,
        storageKey: m.storageKey ?? null,
        mimeType: m.mimeType ?? null,
        sizeBytes: m.sizeBytes ?? null,
        position: i,
      },
    });
  }

  return post;
}

/** Lấy Page thuộc user và đang hoạt động (kèm token + connection để gọi Graph API). */
async function resolvePage(userId: string, pageId: string) {
  return prisma.facebookPage.findFirst({
    where: { id: pageId, userId, isActive: true },
    include: { connection: true },
  });
}

/** Build GraphContext từ connection của Page (đã mã hóa trong DB). */
async function graphContextForPage(
  page: { connection?: { id: string } | null; connectionId?: string | null } | null
): Promise<GraphContext | null> {
  const connId = page?.connection?.id ?? page?.connectionId ?? null;
  if (!connId) return null;
  const { resolveConnection } = await import("@/lib/facebook-connection");
  const resolved = await resolveConnection(connId);
  if (!resolved) return null;
  return {
    appId: resolved.appId,
    appSecret: resolved.appSecret,
    graphVersion: resolved.graphVersion,
  };
}

/**
 * Đăng bài lên Page ngay lập tức:
 * - Tạo Post record (PUBLISHING) trước để lưu vết.
 * - Text-only → /feed ; có ảnh → /photos unpublished + /feed (nhiều ảnh).
 * - Cập nhật trạng thái PUBLISHED / FAILED kèm thông tin từ Graph API.
 */
export async function createAndPublishPost(
  userId: string,
  input: PublishInput
): Promise<PublishOutcome> {
  if (!input.pageId) return { ok: false, error: "Vui lòng chọn Page." };
  if (!input.content.trim()) return { ok: false, error: "Vui lòng nhập nội dung bài đăng." };

  const check = validateAttachments(input.attachments);
  if (!check.ok) return { ok: false, error: check.error };

  const page = await resolvePage(userId, input.pageId);
  if (!page) return { ok: false, error: "Page không tồn tại hoặc đã tắt hoạt động." };

  const fullMessage = buildMessage(input.content, input.hashtags);

  const post = await createPostRecord(userId, input, "PUBLISHING", page);

  try {
    const fbPostId = await deliverToFacebook(
      userId,
      { fbPageId: page.fbPageId, accessToken: page.accessToken },
      fullMessage,
      input.attachments,
      await graphContextForPage(page)
    );

    await prisma.post.update({
      where: { id: post.id },
      data: {
        status: "PUBLISHED",
        fbPostId,
        publishedAt: new Date(),
        errorMessage: null,
      },
    });

    await notify(userId, {
      type: "ACTIVITY",
      title: "✅ Đã đăng bài lên " + page.name,
      body: input.content.slice(0, 160),
      link: "/history",
    });

    revalidatePath("/composer");
    revalidatePath("/dashboard");

    return {
      ok: true,
      message: "Đăng bài thành công!",
      permalink: `https://www.facebook.com/${fbPostId.replace("_", "/posts/")}`,
      postId: post.id,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.post.update({
      where: { id: post.id },
      data: { status: "FAILED", errorMessage: message },
    });
    revalidatePath("/composer");
    return { ok: false, error: `Đăng thất bại: ${message}` };
  }
}

/** Số giờ tối thiểu từ lúc hẹn — tránh hẹn vào quá khứ. */
const MIN_SCHEDULE_AHEAD_MS = 60 * 1000;

/**
 * Hẹn giờ đăng bài (SCHEDULED).
 *
 * Bài chưa được gửi lên Facebook ở bước này — worker sẽ tự đăng khi tới giờ
 * (xem lib/scheduler.ts).
 */
export async function schedulePost(
  userId: string,
  input: PublishInput,
  scheduledAt: Date
): Promise<PublishOutcome> {
  if (!input.pageId) {
    return { ok: false, error: "Vui lòng chọn Page trước khi hẹn giờ đăng." };
  }
  if (!input.content.trim()) return { ok: false, error: "Vui lòng nhập nội dung bài đăng." };

  const check = validateAttachments(input.attachments);
  if (!check.ok) return { ok: false, error: check.error };

  if (Number.isNaN(scheduledAt.getTime())) {
    return { ok: false, error: "Thời gian hẹn không hợp lệ." };
  }
  if (scheduledAt.getTime() < Date.now() + MIN_SCHEDULE_AHEAD_MS) {
    return {
      ok: false,
      error: "Thời gian hẹn phải ở tương lai — chọn giờ muộn hơn hiện tại.",
    };
  }

  const page = await resolvePage(userId, input.pageId);
  if (!page) return { ok: false, error: "Page không tồn tại hoặc đã tắt hoạt động." };

  const post = await createPostRecord(userId, input, "SCHEDULED", page);

  await prisma.post.update({
    where: { id: post.id },
    data: { scheduledAt, attempts: 0, nextAttemptAt: null, lockedAt: null },
  });

  revalidatePath("/composer");
  revalidatePath("/calendar");
  revalidatePath("/history");
  revalidatePath("/dashboard");

  return {
    ok: true,
    message: `Đã hẹn đăng lúc ${formatDateTime(scheduledAt)}.`,
    postId: post.id,
  };
}

/**
 * Đăng lại một bài đã thất bại (retry) — dùng lại nội dung + media đã lưu.
 * Cũng dùng được cho nháp đã gắn Page.
 */
export async function retryPost(
  userId: string,
  postId: string
): Promise<PublishOutcome> {
  const post = await prisma.post.findFirst({
    where: { id: postId, userId },
    include: {
      media: { orderBy: { position: "asc" } },
      page: { include: { connection: true } },
    },
  });

  if (!post) return { ok: false, error: "Không tìm thấy bài đăng." };
  if (post.status === "PUBLISHED") {
    return { ok: false, error: "Bài này đã đăng thành công rồi." };
  }
  if (post.status === "PUBLISHING") {
    return { ok: false, error: "Bài đang được đăng — chờ trong giây lát." };
  }
  if (!post.page) {
    return { ok: false, error: "Bài chưa gắn Page — vào Soạn bài để chọn Page rồi đăng." };
  }
  if (!post.page.isActive) {
    return { ok: false, error: "Page đã bị tắt hoạt động — bật lại ở trang Facebook Pages." };
  }
  if (post.page.tokenExpiresAt && post.page.tokenExpiresAt.getTime() < Date.now()) {
    return {
      ok: false,
      error:
        "Token của Page đã hết hạn — vào trang Facebook Pages để đồng bộ lại token rồi đăng lại.",
    };
  }

  const media: AttachedMedia[] = post.media.map((m) => ({
    remoteUrl: m.remoteUrl,
    type: m.type === "VIDEO" ? "VIDEO" : "IMAGE",
    source:
      m.source === "PEXELS" ? "PEXELS" : m.source === "UPLOAD" ? "UPLOAD" : "URL",
    storageKey: m.storageKey ?? undefined,
    mimeType: m.mimeType ?? undefined,
  }));

  const check = validateAttachments(media);
  if (!check.ok) return { ok: false, error: check.error };

  await prisma.post.update({
    where: { id: post.id },
    data: { status: "PUBLISHING", errorMessage: null },
  });

  try {
    const fbPostId = await deliverToFacebook(
      userId,
      { fbPageId: post.page.fbPageId, accessToken: post.page.accessToken },
      buildMessage(post.content, post.hashtags),
      media,
      await graphContextForPage(post.page)
    );

    await prisma.post.update({
      where: { id: post.id },
      data: {
        status: "PUBLISHED",
        fbPostId,
        publishedAt: new Date(),
        errorMessage: null,
      },
    });

    await notify(userId, {
      type: "ACTIVITY",
      title: "✅ Đăng lại thành công",
      body: post.content.slice(0, 160),
      link: "/history",
    });

    revalidatePath("/history");
    revalidatePath("/composer");
    revalidatePath("/dashboard");

    return {
      ok: true,
      message: "Đăng lại thành công!",
      permalink: `https://www.facebook.com/${fbPostId.replace("_", "/posts/")}`,
      postId: post.id,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.post.update({
      where: { id: post.id },
      data: { status: "FAILED", errorMessage: message },
    });
    revalidatePath("/history");
    return { ok: false, error: `Đăng lại thất bại: ${message}` };
  }
}

/** Lưu bài thành nháp (DRAFT) để chỉnh sửa/đăng sau. */
export async function saveDraftPost(
  userId: string,
  input: PublishInput
): Promise<PublishOutcome> {
  if (!input.content.trim()) return { ok: false, error: "Chưa có nội dung để lưu nháp." };

  // Nháp có thể chưa cần chọn Page → chỉ kiểm tra nếu người dùng đã chọn
  let page: Awaited<ReturnType<typeof resolvePage>> = null;
  if (input.pageId) {
    page = await resolvePage(userId, input.pageId);
    if (!page) return { ok: false, error: "Page không tồn tại hoặc đã tắt hoạt động." };
  }

  const post = await createPostRecord(userId, input, "DRAFT", page);
  revalidatePath("/composer");
  return { ok: true, message: "Đã lưu nháp.", postId: post.id };
}

/** Xóa một bài (nháp hoặc bài đã đăng) của user hiện tại. */
export async function deletePost(postId: string): Promise<void> {
  const user = await requireCurrentUser();
  await prisma.post.deleteMany({ where: { id: postId, userId: user.id } });
  revalidatePath("/composer");
  revalidatePath("/history");
  revalidatePath("/dashboard");
}

/**
 * Action cho form "Đăng ngay" ở trang Soạn bài.
 * (Giữ lại để tương thích; luồng mới ở Soạn bài dùng submitPost trong composer.ts)
 */
export async function publishNow(
  _prev: PublishState,
  formData: FormData
): Promise<PublishState> {
  const user = await requireCurrentUser();

  const outcome = await createAndPublishPost(user.id, {
    pageId: String(formData.get("pageId") ?? "").trim(),
    content: String(formData.get("content") ?? "").trim(),
    hashtags: String(formData.get("hashtags") ?? "").trim(),
    attachments: parseAttachments(String(formData.get("media") ?? "")),
  });

  if (!outcome.ok) return { ok: false, error: outcome.error };
  return { ok: true, message: outcome.message, permalink: outcome.permalink };
}
