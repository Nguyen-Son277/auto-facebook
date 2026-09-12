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
  status: string | null;
  mustChangePassword: boolean;
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
      select: {
        id: true, email: true, name: true, role: true,
        status: true, mustChangePassword: true,
      },
    });
    if (!user) return null;
    // Quản trị tài khoản: ADMIN bỏ qua; user thường phải đã được duyệt.
    // PENDING / REJECTED → coi như chưa đăng nhập (login sẽ báo lý do cụ thể).
    if (user.role !== "ADMIN" && user.status !== "APPROVED") return null;
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

/**
 * Trang private phải gọi ngay sau requireCurrentUser: nếu admin vừa cấp
 * mật khẩu tạm (mustChangePassword) → ép sang trang đổi mật khẩu trước.
 * ADMIN cũng không miễn trừ — mật khẩu tạm ai cũng phải đổi.
 */
export async function requireNoPendingPasswordChange(): Promise<void> {
  const user = await getCurrentUser();
  if (user?.mustChangePassword) {
    redirect("/change-password");
  }
}

// ============================================================
// WORKSPACE — các helper đa tenant.
//
// Mọi truy vấn nghiệp vụ PHẢI đi qua các hàm này để đảm bảo:
// - User chỉ thấy workspace mình là thành viên.
// - Mọi tài nguyên con (Page/Brand/Post...) lọc theo workspaceId.
// ============================================================

export type WorkspaceRole = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";

export type WorkspaceContext = {
  /** User hiện tại */
  user: CurrentUser;
  /** Workspace đang thao tác */
  workspace: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
    status: string;
    ownerId: string;
  };
  /** Vai trò của user trong workspace này */
  role: WorkspaceRole;
};

const ROLE_RANK: Record<WorkspaceRole, number> = {
  VIEWER: 1,
  EDITOR: 2,
  ADMIN: 3,
  OWNER: 4,
};

export function roleAtLeast(role: WorkspaceRole, required: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

/** Danh sách workspace user là thành viên (mới nhất trước). */
export const listUserWorkspaces = cache(async (userId: string) => {
  return prisma.workspaceMember.findMany({
    where: { userId },
    select: {
      role: true,
      workspace: {
        select: {
          id: true,
          name: true,
          slug: true,
          timezone: true,
          status: true,
          ownerId: true,
          createdAt: true,
        },
      },
    },
    orderBy: { workspace: { createdAt: "asc" } },
  });
});

/**
 * Lấy workspace "mặc định" cho user — workspace đầu tiên họ tham gia.
 * Dùng khi code cũ (chưa có selection) cần một workspace để đổ dữ liệu.
 */
export async function getDefaultWorkspaceId(userId: string): Promise<string | null> {
  const first = await prisma.workspaceMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { workspaceId: true },
  });
  return first?.workspaceId ?? null;
}

/**
 * Tạo workspace mới cho user (tự làm OWNER).
 * Slug sinh từ tên, thêm hậu tố nếu trùng.
 */
export async function createWorkspaceForUser(
  userId: string,
  name: string,
  timezone = "Asia/Ho_Chi_Minh"
): Promise<{ id: string; slug: string }> {
  const baseSlug =
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // bỏ dấu tiếng Việt
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workspace";

  // Tìm slug chưa trùng
  let slug = baseSlug;
  for (let i = 2; ; i++) {
    const exists = await prisma.workspace.findUnique({ where: { slug } });
    if (!exists) break;
    slug = `${baseSlug}-${i}`;
  }

  const workspace = await prisma.$transaction(async (tx) => {
    const ws = await tx.workspace.create({
      data: { name, slug, timezone, ownerId: userId },
    });
    await tx.workspaceMember.create({
      data: { workspaceId: ws.id, userId, role: "OWNER" },
    });
    return ws;
  });

  return { id: workspace.id, slug: workspace.slug };
}

/**
 * Xác thực user có quyền truy cập workspace và trả về context đầy đủ.
 * Ném WorkspaceAccessError nếu user không phải thành viên.
 */
export class WorkspaceAccessError extends Error {
  constructor(message = "Bạn không có quyền truy cập workspace này.") {
    super(message);
    this.name = "WorkspaceAccessError";
  }
}

export async function requireWorkspaceContext(
  workspaceId: string
): Promise<WorkspaceContext> {
  const user = await requireCurrentUser();

  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: user.id } },
    select: {
      role: true,
      workspace: {
        select: {
          id: true,
          name: true,
          slug: true,
          timezone: true,
          status: true,
          ownerId: true,
        },
      },
    },
  });

  if (!member) {
    // Không phải thành viên — có thể workspace không tồn tại; chung một thông điệp
    // để không lộ workspace nào tồn tại.
    throw new WorkspaceAccessError();
  }

  return {
    user,
    workspace: member.workspace,
    role: member.role as WorkspaceRole,
  };
}

/**
 * Version "redirect" của requireWorkspaceContext — dùng trong trang:
 * user không có quyền thì chuyển về workspace đầu tiên của họ thay vì crash.
 */
export async function requireWorkspaceOrRedirect(workspaceId: string): Promise<WorkspaceContext> {
  try {
    return await requireWorkspaceContext(workspaceId);
  } catch {
    const user = await requireCurrentUser();
    const fallback = await getDefaultWorkspaceId(user.id);
    if (fallback && fallback !== workspaceId) {
      redirect(`/w/${fallback}/dashboard` as never);
    }
    redirect("/dashboard" as never);
  }
}

/**
 * Kiểm tra quyền tối thiểu trong workspace — dùng ở đầu Server Action.
 */
export async function assertWorkspaceRole(
  workspaceId: string,
  required: WorkspaceRole
): Promise<WorkspaceContext> {
  const ctx = await requireWorkspaceContext(workspaceId);
  if (!roleAtLeast(ctx.role, required)) {
    throw new WorkspaceAccessError(
      `Cần vai trò ${required} trở lên trong workspace này.`
    );
  }
  return ctx;
}

/**
 * Lấy workspace context kèm khả năng redirect nếu ID truyền vào không hợp lệ.
 * Ưu tiên workspace trong DB; nếu null → dùng workspace mặc định của user.
 * Trả về cả workspaceId hiệu dụng để dùng cho mọi truy vấn con.
 */
export async function resolveWorkspace(
  requestedId: string | null | undefined
): Promise<WorkspaceContext> {
  if (requestedId) {
    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: requestedId, userId: (await requireCurrentUser()).id } },
      select: {
        role: true,
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
            timezone: true,
            status: true,
            ownerId: true,
          },
        },
      },
    });
    if (member) {
      return {
        user: await requireCurrentUser(),
        workspace: member.workspace,
        role: member.role as WorkspaceRole,
      };
    }
  }

  // Fallback: workspace đầu tiên của user
  const user = await requireCurrentUser();
  const fallbackId = await getDefaultWorkspaceId(user.id);
  if (!fallbackId) {
    throw new WorkspaceAccessError("Bạn chưa thuộc workspace nào.");
  }
  return requireWorkspaceContext(fallbackId);
}
