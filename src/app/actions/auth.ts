"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSession, destroySession } from "@/lib/session";
import { ensureWorkspaceForUser, requireCurrentUser } from "@/lib/dal";
import { validatePasswordStrength } from "@/lib/password";
import { notify, notifyAdmins } from "@/lib/notify";

export type LoginState = { error?: string } | null;

export async function login(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Vui lòng nhập email và mật khẩu." };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return { error: "Email hoặc mật khẩu không đúng." };
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return { error: "Email hoặc mật khẩu không đúng." };
  }

  // ---- Quản trị tài khoản ----
  if (user.role !== "ADMIN") {
    // User cũ tạo trước khi có hệ thống duyệt — tự nâng để không bị khoá ngoài
    if (user.status === null) {
      await prisma.user.update({ where: { id: user.id }, data: { status: "APPROVED" } });
    } else if (user.status === "PENDING") {
      return { error: "Tài khoản đang chờ quản trị viên duyệt — thử lại sau." };
    } else if (user.status === "REJECTED") {
      return { error: "Tài khoản không được cấp quyền sử dụng hệ thống." };
    }
  }

  await ensureWorkspaceForUser(user.id);
  await createSession({ userId: user.id, email: user.email, name: user.name ?? undefined });
  redirect("/dashboard");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}

export type SetupState = { error?: string } | null;

/** Tạo tài khoản admin đầu tiên — chỉ chạy khi DB chưa có user nào. */
export async function setupAdmin(
  _prev: SetupState,
  formData: FormData
): Promise<SetupState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!email || !password) {
    return { error: "Vui lòng nhập đầy đủ email và mật khẩu." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Email không hợp lệ." };
  }
  if (password.length < 6) {
    return { error: "Mật khẩu phải có ít nhất 6 ký tự." };
  }
  if (password !== confirm) {
    return { error: "Xác nhận mật khẩu không khớp." };
  }

  const existingCount = await prisma.user.count();
  if (existingCount > 0) {
    return { error: "Hệ thống đã có tài khoản. Vui lòng đăng nhập." };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      email,
      name: name || null,
      password: passwordHash,
      role: "ADMIN",
    },
  });

  await createSession({ userId: user.id, email: user.email, name: user.name ?? undefined });
  redirect("/dashboard");
}


// ============================================================
// Đăng ký tài khoản — chờ admin duyệt
// ============================================================

export type RegisterState = { ok?: boolean; error?: string; message?: string } | null;

export async function register(
  _prev: RegisterState,
  formData: FormData
): Promise<RegisterState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!email) return { error: "Vui lòng nhập email." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Email không hợp lệ." };
  }
  const pwError = validatePasswordStrength(password);
  if (pwError) return { error: pwError };
  if (password !== confirm) return { error: "Xác nhận mật khẩu không khớp." };

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "Email này đã được sử dụng." };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const created = await prisma.user.create({
    data: {
      email,
      name: name || null,
      password: passwordHash,
      role: "USER",
      status: "PENDING",
    },
  });
  // Tạo sẵn workspace của riêng họ — duyệt xong là làm việc được ngay
  await ensureWorkspaceForUser(created.id);

  // Thông báo chào mừng (user sẽ đọc ngay sau khi được duyệt)
  await notify(created.id, {
    type: "SYSTEM",
    title: "🎉 Chào mừng bạn đến với FB Marketing Auto!",
    body: "Tài khoản của bạn đang chờ quản trị viên duyệt. Được duyệt xong hãy đọc trang Hướng dẫn sử dụng để bắt đầu trong 5 phút.",
    link: "/docs",
  });
  // Báo admin có người mới chờ duyệt
  await notifyAdmins({
    type: "ADMIN",
    title: "🛡️ Có người dùng mới chờ duyệt",
    body: `${name || email} (${email}) vừa gửi đăng ký — vào Quản trị để duyệt.`,
    link: "/admin",
  });

  return {
    ok: true,
    message: "Đã gửi đăng ký — tài khoản sẽ được kích hoạt sau khi quản trị viên duyệt.",
  };
}

// ============================================================
// Đổi mật khẩu (bắt buộc lần đầu / chủ động)
// ============================================================

export type ChangePasswordState = { ok?: boolean; error?: string; message?: string } | null;

export async function changePassword(
  _prev: ChangePasswordState,
  formData: FormData
): Promise<ChangePasswordState> {
  const user = await requireCurrentUser();
  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { password: true },
  });
  if (!row) return { error: "Tài khoản không tồn tại." };

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const valid = await bcrypt.compare(currentPassword, row.password);
  if (!valid) {
    return { error: "Mật khẩu hiện tại không đúng." };
  }
  const pwError = validatePasswordStrength(newPassword);
  if (pwError) return { error: pwError };
  if (newPassword === currentPassword) {
    return { error: "Mật khẩu mới phải khác mật khẩu hiện tại." };
  }
  if (newPassword !== confirm) return { error: "Xác nhận mật khẩu không khớp." };

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      password: passwordHash,
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    },
  });

  return { ok: true, message: "Đã đổi mật khẩu thành công." };
}
