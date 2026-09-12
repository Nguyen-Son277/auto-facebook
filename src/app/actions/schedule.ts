"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { retryPost } from "./publish";
import { isSchedulerEnabled, runSchedulerTick, setSchedulerEnabled } from "@/lib/scheduler";

// ============================================================
// Server actions cho trang Lịch đăng (content calendar).
//
// Mọi action tự lấy user từ session — KHÔNG nhận userId từ client.
// ============================================================

export type ScheduleState = {
  ok: boolean;
  message?: string;
  error?: string;
};

function revalidateScheduleViews() {
  revalidatePath("/calendar");
  revalidatePath("/composer");
  revalidatePath("/history");
  revalidatePath("/dashboard");
}

/**
 * Bật/tắt tự động đăng bài theo lịch — CHỈ ADMIN.
 *
 * Đây là công tắc CẤP HỆ THỐNG (mọi user chung một vòng lặp) nên quyền điều
 * khiển thuộc quản trị viên. User thường không thấy nút nào và cũng không
 * gọi được action này — kể cả khi cố gửi thẳng từ client.
 */
export async function toggleSchedulerAction(enabled: boolean): Promise<ScheduleState> {
  const user = await requireCurrentUser();
  if (user.role !== "ADMIN") {
    return { ok: false, error: "Chỉ quản trị viên mới được bật/tắt tự động đăng." };
  }

  await setSchedulerEnabled(Boolean(enabled));

  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  revalidatePath("/settings");

  return {
    ok: true,
    message: enabled
      ? "Đã BẬT tự động đăng — bài hẹn giờ sẽ được đăng đúng giờ."
      : "Đã TẮT tự động đăng — bài hẹn giờ sẽ nằm chờ, không tự đăng.",
  };
}

/**
 * Chạy scheduler ngay một vòng (nút "Chạy ngay") — CHỈ ADMIN.
 * Hữu ích để kiểm tra cấu hình mà không phải chờ tới nhịp kế tiếp.
 */
export async function runSchedulerNowAction(): Promise<ScheduleState> {
  const user = await requireCurrentUser();
  if (user.role !== "ADMIN") {
    return { ok: false, error: "Chỉ quản trị viên mới được chạy scheduler thủ công." };
  }

  if (!(await isSchedulerEnabled())) {
    return {
      ok: false,
      error: "Tự động đăng đang TẮT — bật lên trước khi chạy.",
    };
  }

  const result = await runSchedulerTick(new Date(), "manual");

  revalidateScheduleViews();

  const parts = [
    `đã xử lý ${result.claimed} bài`,
    `thành công ${result.published}`,
  ];
  if (result.retrying) parts.push(`thử lại ${result.retrying}`);
  if (result.failed) parts.push(`lỗi ${result.failed}`);
  if (result.recovered) parts.push(`gỡ kẹt ${result.recovered}`);

  return {
    ok: true,
    message: `Chạy xong: ${parts.join(", ")}.`,
  };
}

/** Đổi thời gian hẹn của một bài đang chờ đăng. */
export async function reschedulePostAction(
  postId: string,
  /** Chuỗi từ <input type="datetime-local">, ví dụ "2026-03-15T20:00". */
  localDateTime: string
): Promise<ScheduleState> {
  const user = await requireCurrentUser();

  const post = await prisma.post.findFirst({
    where: { id: postId, userId: user.id },
    select: { id: true, status: true },
  });
  if (!post) return { ok: false, error: "Không tìm thấy bài đăng." };

  if (post.status === "PUBLISHED") {
    return { ok: false, error: "Bài đã đăng rồi — không đổi lịch được nữa." };
  }
  if (post.status === "PUBLISHING") {
    return { ok: false, error: "Bài đang được đăng — chờ trong giây lát." };
  }

  const when = new Date(localDateTime);
  if (!localDateTime || Number.isNaN(when.getTime())) {
    return { ok: false, error: "Thời gian không hợp lệ." };
  }
  if (when.getTime() < Date.now() + 60 * 1000) {
    return { ok: false, error: "Thời gian hẹn phải ở tương lai." };
  }

  await prisma.post.update({
    where: { id: post.id },
    data: {
      status: "SCHEDULED",
      scheduledAt: when,
      // Đổi lịch coi như làm lại từ đầu: xóa lỗi cũ và bộ đếm thử lại
      attempts: 0,
      nextAttemptAt: null,
      lockedAt: null,
      errorMessage: null,
    },
  });

  revalidateScheduleViews();

  const p = (n: number) => String(n).padStart(2, "0");
  return {
    ok: true,
    message: `Đã đổi lịch sang ${p(when.getHours())}:${p(when.getMinutes())} ngày ${p(
      when.getDate()
    )}/${p(when.getMonth() + 1)}/${when.getFullYear()}.`,
  };
}

/** Hủy lịch: đưa bài về Nháp để chỉnh sửa tiếp. */
export async function cancelScheduleAction(postId: string): Promise<ScheduleState> {
  const user = await requireCurrentUser();

  const post = await prisma.post.findFirst({
    where: { id: postId, userId: user.id },
    select: { id: true, status: true },
  });
  if (!post) return { ok: false, error: "Không tìm thấy bài đăng." };

  if (post.status === "PUBLISHED") {
    return { ok: false, error: "Bài đã đăng rồi — không hủy được." };
  }
  if (post.status === "PUBLISHING") {
    return { ok: false, error: "Bài đang được đăng — chờ trong giây lát." };
  }

  await prisma.post.update({
    where: { id: post.id },
    data: {
      status: "DRAFT",
      scheduledAt: null,
      nextAttemptAt: null,
      lockedAt: null,
      errorMessage: null,
      attempts: 0,
    },
  });

  revalidateScheduleViews();
  return { ok: true, message: "Đã hủy lịch — bài chuyển về Nháp." };
}

/** Đăng ngay một bài đang chờ lịch (không đợi tới giờ hẹn). */
export async function publishScheduledNowAction(postId: string): Promise<ScheduleState> {
  const user = await requireCurrentUser();

  const post = await prisma.post.findFirst({
    where: { id: postId, userId: user.id },
    select: { id: true, status: true },
  });
  if (!post) return { ok: false, error: "Không tìm thấy bài đăng." };

  if (post.status === "PUBLISHED") {
    return { ok: false, error: "Bài đã đăng rồi." };
  }

  const outcome = await retryPost(user.id, postId);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  revalidateScheduleViews();
  return { ok: true, message: "Đã đăng ngay thành công!" };
}

/** Xóa một bài đang chờ lịch. */
export async function deleteScheduledPostAction(postId: string): Promise<ScheduleState> {
  const user = await requireCurrentUser();

  const post = await prisma.post.findFirst({
    where: { id: postId, userId: user.id },
    include: { media: true },
  });
  if (!post) return { ok: false, error: "Không tìm thấy bài đăng." };

  // Lấy storageKey trước khi xóa (Media bị xóa theo Post)
  const uploads = post.media
    .filter((m) => m.source === "UPLOAD" && m.storageKey)
    .map((m) => m.storageKey as string);

  await prisma.post.delete({ where: { id: post.id } });

  const { deleteUpload } = await import("@/lib/uploads");
  for (const key of uploads) {
    await deleteUpload(user.id, key);
  }

  revalidateScheduleViews();
  return { ok: true, message: "Đã xóa bài." };
}
