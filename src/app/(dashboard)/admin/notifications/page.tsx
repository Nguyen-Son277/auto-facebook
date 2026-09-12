import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import PageHeader from "@/components/page-header";
import NotificationsAdminClient from "@/components/notifications-admin-client";

export const metadata: Metadata = {
  title: "Quản lý Thông báo | FB Marketing Auto",
};

export const dynamic = "force-dynamic";

/** Quản trị thông báo — soạn/sửa/xoá, chỉ ADMIN. */
export default async function AdminNotificationsPage() {
  const me = await requireCurrentUser();
  if (me.role !== "ADMIN") {
    redirect("/dashboard");
  }

  const notifications = await prisma.notification.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      userId: true,
      type: true,
      title: true,
      body: true,
      link: true,
      read: true,
      createdAt: true,
      user: { select: { email: true, name: true, role: true } },
    },
  });

  // Bỏ chính admin đang thao tác — người tạo thông báo không nhận tin của mình
  const users = await prisma.user.findMany({
    where: { id: { not: me.id } },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, name: true, role: true },
  });

  return (
    <div>
      <PageHeader
        title="📣 Thông báo"
        description="Soạn thông báo gửi người dùng, sửa hoặc xoá thông báo đã gửi"
      />
      <NotificationsAdminClient
        notifications={notifications.map((n) => ({
          id: n.id,
          userId: n.userId,
          type: n.type as "ACTIVITY" | "ADMIN" | "SYSTEM",
          title: n.title,
          body: n.body,
          link: n.link,
          read: n.read,
          createdAt: n.createdAt.toISOString(),
          userEmail: n.user.email,
          userName: n.user.name,
          userRole: n.user.role,
        }))}
        users={users.map((u) => ({
          id: u.id,
          label: `${u.name || u.email} (${u.email})${u.role === "ADMIN" ? " — admin" : ""}`,
        }))}
      />
    </div>
  );
}
