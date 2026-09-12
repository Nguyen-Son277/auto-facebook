"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser, type CurrentUser } from "@/lib/dal";
import { notifyAdmins, notifyAllUsers, type NotificationInput, type NotificationType } from "@/lib/notify";

// ============================================================
// Quản trị thông báo — admin soạn/sửa/xoá thông báo cho mọi user.
// Mọi action tự kiểm tra role ADMIN từ session.
// ============================================================

export type AdminNotifyState = {
  ok?: boolean;
  error?: string;
  message?: string;
} | null;

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

async function requireAdmin(): Promise<CurrentUser | AdminNotifyState> {
  const me = await getCurrentUser();
  if (!me || me.role !== "ADMIN") {
    return { ok: false, error: "Bạn không có quyền quản trị." };
  }
  return me;
}

function isUser(v: CurrentUser | AdminNotifyState): v is CurrentUser {
  return v !== null && "id" in v && typeof v.id === "string";
}

function revalidate() {
  revalidatePath("/admin/notifications");
  revalidatePath("/notifications");
}

function validateInput(title: string, type: string): string | null {
  if (!title) return "Vui lòng nhập tiêu đề thông báo.";
  if (!["ACTIVITY", "ADMIN", "SYSTEM"].includes(type)) return "Loại thông báo không hợp lệ.";
  return null;
}

/**
 * Soạn thông báo mới.
 *
 * formData:
 *   target  — "all" (mọi user thường + admin khác) | "admins" | "user:<userId>"
 *   type    — ACTIVITY | ADMIN | SYSTEM
 *   title   — bắt buộc
 *   body    — tùy chọn
 *   link    — URL nội bộ, tùy chọn
 *
 * Admin đang thao tác LUÔN được loại khỏi danh sách nhận — người tạo
 * thông báo không nhận lại tin của chính mình.
 */
export async function adminCreateNotification(
  _prev: AdminNotifyState,
  formData: FormData
): Promise<AdminNotifyState> {
  const me = await requireAdmin();
  if (!isUser(me)) return me;

  const target = str(formData, "target") || "all";
  const type = str(formData, "type") || "ADMIN";
  const title = str(formData, "title");
  const body = String(formData.get("body") ?? "").trim();
  const link = str(formData, "link");

  const invalid = validateInput(title, type);
  if (invalid) return { ok: false, error: invalid };

  const input: NotificationInput = {
    type: type as NotificationType,
    title: title.slice(0, 200),
    body: body ? body.slice(0, 2000) : null,
    link: link && link.startsWith("/") ? link.slice(0, 500) : null,
  };

  if (target === "all") {
    await notifyAllUsers(input, { includeAdmins: true, excludeUserId: me.id });
  } else if (target === "admins") {
    await notifyAdmins(input, { excludeUserId: me.id });
  } else if (target.startsWith("user:")) {
    const userId = target.slice(5);
    if (userId === me.id) {
      return {
        ok: false,
        error: "Bạn là người tạo thông báo nên không cần tự nhận tin của mình.",
      };
    }
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) return { ok: false, error: "Không tìm thấy người dùng đích." };
    await prisma.notification.createMany({
      data: [{ userId, ...input }],
    });
  } else {
    return { ok: false, error: "Đích gửi không hợp lệ." };
  }

  revalidate();
  return { ok: true, message: `Đã gửi thông báo "${title}".` };
}

/** Sửa nội dung một thông báo đã gửi (theo id). */
export async function adminUpdateNotification(
  _prev: AdminNotifyState,
  formData: FormData
): Promise<AdminNotifyState> {
  const me = await requireAdmin();
  if (!isUser(me)) return me;

  const id = str(formData, "id");
  const type = str(formData, "type") || "ADMIN";
  const title = str(formData, "title");
  const body = String(formData.get("body") ?? "").trim();
  const link = str(formData, "link");

  const invalid = validateInput(title, type);
  if (invalid) return { ok: false, error: invalid };

  const existing = await prisma.notification.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Không tìm thấy thông báo." };

  await prisma.notification.update({
    where: { id },
    data: {
      type: type as NotificationType,
      title: title.slice(0, 200),
      body: body ? body.slice(0, 2000) : null,
      link: link && link.startsWith("/") ? link.slice(0, 500) : null,
    },
  });

  revalidate();
  return { ok: true, message: "Đã cập nhật thông báo." };
}

/** Xoá hẳn một thông báo (mọi người không thấy nữa). */
export async function adminDeleteNotification(id: string): Promise<AdminNotifyState> {
  const me = await requireAdmin();
  if (!isUser(me)) return me;

  const existing = await prisma.notification.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Không tìm thấy thông báo." };

  await prisma.notification.delete({ where: { id } });
  revalidate();
  return { ok: true, message: "Đã xoá thông báo." };
}

/** Danh sách user để chọn đích gửi (dropdown) — bỏ chính admin đang thao tác. */
export async function listUsersForTarget(): Promise<
  { id: string; label: string }[]
> {
  const me = await requireAdmin();
  if (!isUser(me)) return [];
  const users = await prisma.user.findMany({
    where: { id: { not: me.id } },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, name: true, role: true },
  });
  return users.map((u) => ({
    id: u.id,
    label: `${u.name || u.email} (${u.email})${u.role === "ADMIN" ? " — admin" : ""}`,
  }));
}
