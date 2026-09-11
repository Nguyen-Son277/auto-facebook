"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { retryPost } from "./publish";
import { deleteUpload } from "@/lib/uploads";

// ============================================================
// Server actions cho trang Lịch sử đăng bài.
//
// Mọi action ở đây tự lấy user từ session — KHÔNG nhận userId từ client.
// ============================================================

export type RetryState = {
  ok: boolean;
  message?: string;
  error?: string;
};

/** Đăng lại một bài đã thất bại. */
export async function retryPostAction(postId: string): Promise<RetryState> {
  const user = await requireCurrentUser();

  if (typeof postId !== "string" || !postId.trim()) {
    return { ok: false, error: "Thiếu ID bài đăng." };
  }

  const outcome = await retryPost(user.id, postId);

  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidatePath("/history");
  return { ok: true, message: outcome.message };
}

/** Xóa một bài khỏi lịch sử (kèm file upload của bài đó). */
export async function deleteHistoryPost(postId: string): Promise<RetryState> {
  const user = await requireCurrentUser();

  if (typeof postId !== "string" || !postId.trim()) {
    return { ok: false, error: "Thiếu ID bài đăng." };
  }

  const post = await prisma.post.findFirst({
    where: { id: postId, userId: user.id },
    include: { media: true },
  });

  if (!post) return { ok: false, error: "Không tìm thấy bài đăng." };

  // Lấy storageKey TRƯỚC khi xóa — Media bị xóa theo Post (onDelete: Cascade)
  const uploads = post.media
    .filter((m) => m.source === "UPLOAD" && m.storageKey)
    .map((m) => m.storageKey as string);

  await prisma.post.delete({ where: { id: postId } });

  // Xóa file video trên đĩa để không chiếm dung lượng
  for (const key of uploads) {
    await deleteUpload(user.id, key);
  }

  revalidatePath("/history");
  revalidatePath("/composer");
  revalidatePath("/dashboard");
  revalidatePath("/media");

  return { ok: true, message: "Đã xóa bài đăng." };
}
