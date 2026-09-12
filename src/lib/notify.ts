import "server-only";

import { prisma } from "./prisma";

// ============================================================
// THÔNG BÁO — một hộp thư nội bộ cho từng người dùng.
//
// Ba loại:
//   ACTIVITY — sự kiện về bài của CHÍNH user (đăng thành công,
//              thất bại, AutoPilot tạo bài chờ duyệt)
//   ADMIN    — tin từ quản trị viên (duyệt tài khoản, reset mật
//              khẩu, broadcast, tài liệu mới)
//   SYSTEM   — cảnh báo hệ thống (chưa nhập key AI/Pexels...)
//
// Nguyên tắc: mọi hàm đều nhận userId — không có đường nào đọc
// thông báo của người khác.
// ============================================================

export const NOTIFICATION_TYPES = ["ACTIVITY", "ADMIN", "SYSTEM"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationInput = {
  type: NotificationType;
  title: string;
  body?: string | null;
  /** URL nội bộ để bấm tới, ví dụ "/history". */
  link?: string | null;
};

export type NotificationRow = {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: Date;
};

/** Gửi một thông báo cho đúng MỘT user. Lỗi notify không được làm hỏng luồng chính. */
export async function notify(
  userId: string,
  input: NotificationInput
): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        userId,
        type: input.type,
        title: input.title.slice(0, 200),
        body: input.body ? String(input.body).slice(0, 2000) : null,
        link: input.link ? String(input.link).slice(0, 500) : null,
      },
    });
  } catch (err) {
    console.error("[notify] không ghi được thông báo:", err);
  }
}

/** Gửi cùng một nội dung cho nhiều user (broadcast có chọn lọc). */
export async function notifyMany(
  userIds: string[],
  input: NotificationInput
): Promise<number> {
  if (userIds.length === 0) return 0;
  try {
    const res = await prisma.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type: input.type,
        title: input.title.slice(0, 200),
        body: input.body ? String(input.body).slice(0, 2000) : null,
        link: input.link ? String(input.link).slice(0, 500) : null,
      })),
    });
    return res.count;
  } catch (err) {
    console.error("[notify] broadcast thất bại:", err);
    return 0;
  }
}

/**
 * Gửi cho toàn bộ user THƯỜNG đang hoạt động (APPROVED).
 * Mặc định bỏ qua ADMIN — admin tự tạo tin cho chính họ khi cần.
 *
 * excludeUserId: bỏ qua người GỬI (admin đang thao tác) — người tạo
 * thông báo không cần nhận lại tin của chính mình.
 */
export async function notifyAllUsers(
  input: NotificationInput,
  opts: { includeAdmins?: boolean; excludeUserId?: string } = {}
): Promise<number> {
  const users = await prisma.user.findMany({
    where: opts.includeAdmins
      ? // ADMIN có status NULL (kế thừa) — phải bắt bằng role, không lọc status
        { OR: [{ status: "APPROVED" }, { role: "ADMIN" }] }
      : { status: "APPROVED", role: { not: "ADMIN" } },
    select: { id: true },
  });
  return notifyMany(
    users.map((u) => u.id).filter((id) => id !== opts.excludeUserId),
    input
  );
}

/**
 * Gửi cho mọi user có role ADMIN — kênh báo sự kiện hệ thống:
 * user mới chờ duyệt, autopilot lỗi, bài đăng thất bại...
 * Lỗi notify không làm hỏng luồng chính.
 *
 * excludeUserId: bỏ qua admin đang thao tác (xem notifyAllUsers).
 */
export async function notifyAdmins(
  input: NotificationInput,
  opts: { excludeUserId?: string } = {}
): Promise<number> {
  try {
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN" },
      select: { id: true },
    });
    return notifyMany(
      admins.map((a) => a.id).filter((id) => id !== opts.excludeUserId),
      input
    );
  } catch (err) {
    console.error("[notify] không gửi được cho admin:", err);
    return 0;
  }
}

/**
 * Như notify() nhưng chống spam: nếu user đã nhận thông báo CÙNG TITLE trong
 * khoảng thời gian windowMs thì bỏ qua. Dùng cho cảnh báo lặp lại mỗi nhịp
 * scheduler (thiếu key AI/Pexels...).
 */
export async function notifyOncePer(
  userId: string,
  input: NotificationInput & { dedupeWindowMs?: number }
): Promise<boolean> {
  const windowMs = input.dedupeWindowMs ?? 6 * 60 * 60 * 1000;
  try {
    const since = new Date(Date.now() - windowMs);
    const existing = await prisma.notification.findFirst({
      where: { userId, title: input.title.slice(0, 200), createdAt: { gte: since } },
      select: { id: true },
    });
    if (existing) return false;
    await notify(userId, input);
    return true;
  } catch (err) {
    console.error("[notify] dedupe check thất bại:", err);
    return false;
  }
}

// ---------- Đọc ----------

export async function countUnread(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, read: false } });
}

export async function listNotifications(
  userId: string,
  opts: { limit?: number; unreadOnly?: boolean } = {}
): Promise<NotificationRow[]> {
  const rows = await prisma.notification.findMany({
    where: { userId, ...(opts.unreadOnly ? { read: false } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(opts.limit ?? 30, 1), 100),
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      link: true,
      read: true,
      createdAt: true,
    },
  });
  return rows as NotificationRow[];
}

/** Đánh dấu đã đọc — chỉ tác động được lên đúng tin CỦA MÌNH. */
export async function markNotificationsRead(
  userId: string,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return;
  await prisma.notification.updateMany({
    where: { id: { in: ids }, userId },
    data: { read: true },
  });
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const res = await prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });
  return res.count;
}

// ---------- Mẫu nội dung dùng chung ----------

export const NOTIF_ICONS: Record<NotificationType, string> = {
  ACTIVITY: "📝",
  ADMIN: "🛡️",
  SYSTEM: "⚙️",
};
