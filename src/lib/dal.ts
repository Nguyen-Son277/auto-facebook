import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { getSession } from "./session";
import { prisma } from "./prisma";

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
};

/**
 * Lấy user hiện tại (đã xác thực trong DB).
 * Dùng React cache để chỉ query 1 lần mỗi request.
 */
export const getCurrentUser = cache(
  async (): Promise<CurrentUser | null> => {
    const session = await getSession();
    if (!session) return null;

    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, email: true, name: true, role: true },
    });
    return user;
  }
);

/**
 * Bắt buộc đã đăng nhập — dùng ở đầu các trang private / route handlers.
 * Chưa đăng nhập thì redirect về /login.
 */
export async function requireCurrentUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}
