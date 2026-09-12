import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import AdminClient from "@/components/admin-client";
import AdminSchedulerCard from "@/components/admin-scheduler-card";

export const metadata: Metadata = {
  title: "Quản trị tài khoản | FB Marketing Auto",
};

export default async function AdminPage() {
  const me = await requireCurrentUser();
  if (me.role !== "ADMIN") {
    redirect("/dashboard");
  }

  const users = await prisma.user.findMany({
    orderBy: [{ status: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      mustChangePassword: true,
      passwordChangedAt: true,
      createdAt: true,
    },
  });

  // Workspace đang dùng của từng user (để admin nhận diện)
  const memberships = await prisma.workspaceMember.findMany({
    select: { userId: true, role: true, workspace: { select: { name: true } } },
  });
  const wsByUser = new Map<string, string[]>();
  for (const m of memberships) {
    const list = wsByUser.get(m.userId) ?? [];
    list.push(`${m.workspace.name} (${m.role})`);
    wsByUser.set(m.userId, list);
  }

  return (
    <div className="space-y-5">
      <AdminSchedulerCard userId={me.id} />
      <AdminClient
        meEmail={me.email}
        users={users.map((u) => ({
          ...u,
          createdAt: u.createdAt.toISOString(),
          passwordChangedAt: u.passwordChangedAt?.toISOString() ?? null,
          workspaces: wsByUser.get(u.id) ?? [],
        }))}
      />
    </div>
  );
}
