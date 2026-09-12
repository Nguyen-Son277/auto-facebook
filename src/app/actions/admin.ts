"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { ensureWorkspaceForUser, getCurrentUser, type CurrentUser } from "@/lib/dal";
import { validatePasswordStrength } from "@/lib/password";

// ============================================================
// Server action quản trị tài khoản — CHỈ role ADMIN.
//
// Mọi action đều tự kiểm tra quyền từ session (không tin UI):
// requireAdmin() đọc user hiện tại và ném lỗi nếu không phải ADMIN.
// ============================================================

export type AdminState = {
  ok?: boolean;
  error?: string;
  message?: string;
} | null;

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

async function requireAdmin(): Promise<CurrentUser | AdminState> {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") {
    return { error: "Bạn không có quyền quản trị." };
  }
  return user;
}

function isUser(v: CurrentUser | AdminState): v is CurrentUser {
  return v !== null && "id" in v && typeof v.id === "string";
}

function revalidateAdmin() {
  revalidatePath("/admin");
}

// ============================================================
// Duyệt đăng ký — đặt mật khẩu tạm, buộc đổi lần đầu
// ============================================================

export async function approveUser(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const me = await requireAdmin();
  if (!isUser(me)) return me;

  const userId = str(formData, "userId");
  const tempPassword = str(formData, "tempPassword");

  const pwError = validatePasswordStrength(tempPassword);
  if (pwError) return { ok: false, error: pwError };

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, status: true },
  });
  if (!target) return { ok: false, error: "Không tìm thấy tài khoản." };
  if (target.role === "ADMIN") {
    return { ok: false, error: "Không áp dụng mật khẩu tạm cho tài khoản ADMIN." };
  }

  const passwordHash = await bcrypt.hash(tempPassword, 12);
  await prisma.user.update({
    where: { id: target.id },
    data: {
      status: "APPROVED",
      password: passwordHash,
      mustChangePassword: true,
    },
  });
  await ensureWorkspaceForUser(target.id);

  revalidateAdmin();
  return {
    ok: true,
    message: `Đã duyệt ${target.email}. Gửi mật khẩu tạm cho người dùng — họ buộc đổi khi đăng nhập lần đầu.`,
  };
}

// ============================================================
// Từ chối / khoá / mở lại
// ============================================================

async function setTargetStatus(
  userId: string,
  status: "APPROVED" | "REJECTED",
  okMessage: (email: string) => string
): Promise<AdminState> {
  const me = await requireAdmin();
  if (!isUser(me)) return me;

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true },
  });
  if (!target) return { ok: false, error: "Không tìm thấy tài khoản." };
  if (target.role === "ADMIN") {
    return { ok: false, error: "Không khoá/từ chối tài khoản ADMIN." };
  }

  await prisma.user.update({ where: { id: target.id }, data: { status } });
  revalidateAdmin();
  return { ok: true, message: okMessage(target.email) };
}

export async function rejectUser(userId: string): Promise<AdminState> {
  return setTargetStatus(
    userId,
    "REJECTED",
    (email) => `Đã từ chối/khoá ${email}. Người dùng không đăng nhập được.`
  );
}

export async function reinstateUser(userId: string): Promise<AdminState> {
  return setTargetStatus(
    userId,
    "APPROVED",
    (email) => `Đã mở lại quyền sử dụng cho ${email} (giữ nguyên mật khẩu hiện tại).`
  );
}

// ============================================================
// Reset mật khẩu (cấp mật khẩu tạm mới)
// ============================================================

export async function resetUserPassword(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const me = await requireAdmin();
  if (!isUser(me)) return me;

  const userId = str(formData, "userId");
  const tempPassword = str(formData, "tempPassword");

  const pwError = validatePasswordStrength(tempPassword);
  if (pwError) return { ok: false, error: pwError };

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!target) return { ok: false, error: "Không tìm thấy tài khoản." };
  if (target.email === me.email) {
    return { ok: false, error: "Hãy dùng trang 'Đổi mật khẩu' để đổi mật khẩu của chính bạn." };
  }

  const passwordHash = await bcrypt.hash(tempPassword, 12);
  await prisma.user.update({
    where: { id: target.id },
    data: { password: passwordHash, mustChangePassword: true },
  });

  revalidateAdmin();
  return {
    ok: true,
    message: `Đã đặt lại mật khẩu cho ${target.email}. Người dùng sẽ buộc đổi khi đăng nhập.`,
  };
}

// ============================================================
// Đổi role
// ============================================================

export async function changeUserRole(
  userId: string,
  role: "ADMIN" | "USER"
): Promise<AdminState> {
  const me = await requireAdmin();
  if (!isUser(me)) return me;

  if (userId === me.id && role !== "ADMIN") {
    return { ok: false, error: "Không thể hạ quyền chính mình." };
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!target) return { ok: false, error: "Không tìm thấy tài khoản." };

  await prisma.user.update({
    where: { id: target.id },
    data: {
      role,
      // ADMIN bỏ ràng buộc status; hạ xuống USER → giữ APPROVED nếu đang null
      status: role === "ADMIN" ? null : (target ? "APPROVED" : null),
    },
  });

  revalidateAdmin();
  return { ok: true, message: `Đã chuyển ${target.email} sang quyền ${role}.` };
}

// ============================================================
// Tạo tài khoản trực tiếp (admin cấp cho người khác)
// ============================================================

export async function createManagedUser(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const me = await requireAdmin();
  if (!isUser(me)) return me;

  const email = str(formData, "email").toLowerCase();
  const name = str(formData, "name");
  const tempPassword = str(formData, "tempPassword");
  const role = str(formData, "role") === "ADMIN" ? "ADMIN" : "USER";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Email không hợp lệ." };
  }
  const pwError = validatePasswordStrength(tempPassword);
  if (pwError) return { ok: false, error: pwError };

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { ok: false, error: "Email này đã tồn tại." };

  const passwordHash = await bcrypt.hash(tempPassword, 12);
  const created = await prisma.user.create({
    data: {
      email,
      name: name || null,
      password: passwordHash,
      role,
      status: role === "ADMIN" ? null : "APPROVED",
      mustChangePassword: true,
    },
  });
  await ensureWorkspaceForUser(created.id);

  revalidateAdmin();
  return { ok: true, message: `Đã tạo tài khoản ${email} — gửi mật khẩu tạm cho họ.` };
}

// ============================================================
// Xoá hẳn tài khoản (phá hủy — cân nhắc dùng Từ chối)
// ============================================================

export async function deleteUser(
  _prev: AdminState,
  formData: FormData
): Promise<AdminState> {
  const me = await requireAdmin();
  if (!isUser(me)) return me;

  const userId = str(formData, "userId");
  const confirmEmail = str(formData, "confirmEmail");

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true },
  });
  if (!target) return { ok: false, error: "Không tìm thấy tài khoản." };
  if (target.id === me.id) return { ok: false, error: "Không thể xoá chính mình." };
  if (target.role === "ADMIN") {
    return { ok: false, error: "Không thể xoá tài khoản ADMIN. Chuyển role xuống USER trước." };
  }
  if (confirmEmail !== target.email) {
    return { ok: false, error: "Xác nhận email không khớp — nhập đúng email để xoá." };
  }

  await prisma.user.delete({ where: { id: target.id } });
  revalidateAdmin();
  return { ok: true, message: `Đã xoá hoàn toàn ${target.email} và toàn bộ dữ liệu liên quan.` };
}
