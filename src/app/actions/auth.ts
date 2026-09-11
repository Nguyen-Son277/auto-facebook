"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSession, destroySession } from "@/lib/session";

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
