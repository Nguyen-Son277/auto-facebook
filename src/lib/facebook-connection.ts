import "server-only";

import { decryptValue } from "./settings";
import { prisma } from "./prisma";
import type { FacebookConnection } from "@/generated/prisma/client";

// ============================================================
// FACEBOOK CONNECTION SERVICE
//
// Quản lý nhiều Facebook Graph API App trong MỘT workspace.
// Mỗi Page nhớ connectionId đã đồng bộ — đăng bài bằng đúng App đó.
//
// An toàn: mọi hàm nhận workspaceId và kiểm tra membership Ở LAYER
// DAL (caller truyền ctx đã xác thực). Secret/token giải mã chỉ
// trong server, không bao giờ trả về client.
// ============================================================

export type ConnectionInput = {
  name: string;
  appId: string;
  appSecret?: string; // trống = giữ giá trị đã lưu
  userAccessToken?: string; // trống = giữ giá trị đã lưu
  graphVersion?: string;
};

export type ConnectionView = {
  id: string;
  workspaceId: string;
  name: string;
  appId: string;
  graphVersion: string;
  status: string;
  tokenExpiresAt: string | null;
  lastValidatedAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  pageCount: number;
  hasSecret: boolean;
  hasToken: boolean;
};

/** Entity FacebookConnection giải mã sẵn (chỉ dùng server-side). */
export type ResolvedConnection = {
  id: string;
  workspaceId: string;
  name: string;
  appId: string;
  appSecret: string | null;
  userAccessToken: string | null;
  graphVersion: string;
  status: string;
};

/** Chuyển entity FacebookConnection (giá trị mã hóa) → view an toàn cho UI. */
function toView(
  conn: FacebookConnection & { _count?: { pages: number } },
  hasSecret: boolean,
  hasToken: boolean
): ConnectionView {
  return {
    id: conn.id,
    workspaceId: conn.workspaceId,
    name: conn.name,
    appId: conn.appId,
    graphVersion: conn.graphVersion,
    status: conn.status,
    tokenExpiresAt: conn.tokenExpiresAt?.toISOString() ?? null,
    lastValidatedAt: conn.lastValidatedAt?.toISOString() ?? null,
    lastSyncedAt: conn.lastSyncedAt?.toISOString() ?? null,
    lastError: conn.lastError ?? null,
    // appId lưu PLAIN (không phải secret) — hiển thị trực tiếp; giá trị
    // trong DB có thể đang là "enc:v1:..." nếu backfill từ AppSetting.
    pageCount: conn._count?.pages ?? 0,
    hasSecret,
    hasToken,
  };
}

/**
 * Lấy danh sách connection của workspace kèm số Page đang dùng.
 * Caller phải đã qua assertWorkspaceRole (Giai đoạn UI/Action).
 */
export async function listConnections(workspaceId: string): Promise<ConnectionView[]> {
  const conns = await prisma.facebookConnection.findMany({
    where: { workspaceId },
    include: { _count: { select: { pages: true } } },
    orderBy: { createdAt: "asc" },
  });
  return conns.map((c) => {
    const raw = c as unknown as { appSecret: string; userAccessToken: string };
    return toView(
      c,
      Boolean(raw.appSecret && decryptValue(raw.appSecret)),
      Boolean(raw.userAccessToken && decryptValue(raw.userAccessToken))
    );
  });
}

/**
 * Tạo connection mới trong workspace. App ID phải duy nhất trong workspace.
 */
export async function createConnection(
  workspaceId: string,
  createdById: string,
  input: ConnectionInput
): Promise<ConnectionView> {
  if (!input.name.trim()) throw new Error("Tên connection không được để trống.");
  if (!input.appId.trim()) throw new Error("App ID không được để trống.");
  if (!input.appSecret?.trim()) throw new Error("App Secret không được để trống khi tạo mới.");

  const { encryptValue } = await import("./settings");

  const exists = await prisma.facebookConnection.findUnique({
    where: { workspaceId_appId: { workspaceId, appId: input.appId.trim() } },
  });
  if (exists) {
    throw new Error(`App ID ${input.appId} đã được thêm trong workspace này.`);
  }

  const conn = await prisma.facebookConnection.create({
    data: {
      workspaceId,
      name: input.name.trim(),
      appId: input.appId.trim(),
      appSecret: encryptValue(input.appSecret.trim()),
      userAccessToken: encryptValue(input.userAccessToken?.trim() ?? ""),
      graphVersion: input.graphVersion?.trim() || "v21.0",
      createdById,
      status: "ACTIVE",
    },
  });
  return toView(conn, true, Boolean(input.userAccessToken?.trim()));
}

/**
 * Cập nhật connection. Trường để trống = giữ giá trị cũ (không ghi đè secret).
 */
export async function updateConnection(
  workspaceId: string,
  connectionId: string,
  input: ConnectionInput
): Promise<ConnectionView> {
  const conn = await prisma.facebookConnection.findUnique({ where: { id: connectionId } });
  if (!conn || conn.workspaceId !== workspaceId) {
    throw new Error("Connection không tồn tại trong workspace này.");
  }

  const { encryptValue } = await import("./settings");

  const appId = input.appId?.trim() || conn.appId;
  if (appId !== conn.appId) {
    const dup = await prisma.facebookConnection.findUnique({
      where: { workspaceId_appId: { workspaceId, appId } },
    });
    if (dup && dup.id !== connectionId) {
      throw new Error(`App ID ${appId} đã được dùng bởi connection "${dup.name}".`);
    }
  }

  const updated = await prisma.facebookConnection.update({
    where: { id: connectionId },
    data: {
      name: input.name?.trim() || conn.name,
      appId,
      ...(input.appSecret?.trim() ? { appSecret: encryptValue(input.appSecret.trim()) } : {}),
      ...(input.userAccessToken?.trim()
        ? { userAccessToken: encryptValue(input.userAccessToken.trim()) }
        : {}),
      ...(input.graphVersion?.trim() ? { graphVersion: input.graphVersion.trim() } : {}),
      updatedAt: new Date(),
    },
  });
  return toView(
    updated,
    Boolean(updated.appSecret && decryptValue(updated.appSecret)),
    Boolean(updated.userAccessToken && decryptValue(updated.userAccessToken))
  );
}

/** Xóa connection — chỉ cho phép khi không còn Page nào phụ thuộc. */
export async function deleteConnection(workspaceId: string, connectionId: string): Promise<void> {
  const conn = await prisma.facebookConnection.findUnique({
    where: { id: connectionId },
    include: { _count: { select: { pages: true } } },
  });
  if (!conn || conn.workspaceId !== workspaceId) {
    throw new Error("Connection không tồn tại trong workspace này.");
  }
  const count = (conn as unknown as { _count: { pages: number } })._count.pages;
  if (count > 0) {
    throw new Error(
      `Connection đang cấp quyền cho ${count} Page. Hãy xóa hoặc chuyển các Page sang connection khác trước.`
    );
  }
  await prisma.facebookConnection.delete({ where: { id: connectionId } });
}

/**
 * Giải mã connection để gọi Graph API. Trả về null nếu thiếu cấu hình.
 */
export async function resolveConnection(connectionId: string): Promise<ResolvedConnection | null> {
  const conn = await prisma.facebookConnection.findUnique({ where: { id: connectionId } });
  if (!conn) return null;

  const raw = conn as unknown as { appSecret: string; userAccessToken: string };
  const appSecret = raw.appSecret ? decryptValue(raw.appSecret) : "";
  const userAccessToken = raw.userAccessToken ? decryptValue(raw.userAccessToken) : "";

  // appId/graphVersion có thể bị mã hóa từ bản backfill AppSetting (mọi giá
  // trị setting đều mã hóa AES). decryptValue trả nguyên giá trị nếu không
  // có prefix "enc:v1:" nên gọi luôn là an toàn.
  return {
    id: conn.id,
    workspaceId: conn.workspaceId,
    name: conn.name,
    appId: decryptValue(conn.appId),
    appSecret: appSecret || null,
    userAccessToken: userAccessToken || null,
    graphVersion: decryptValue(conn.graphVersion) || "v21.0",
    status: conn.status,
  };
}

/** Connection mặc định của workspace (đầu tiên, ACTIVE đầu tiên nếu có). */
export async function getDefaultConnection(workspaceId: string): Promise<string | null> {
  const first = await prisma.facebookConnection.findFirst({
    where: { workspaceId },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  return first?.id ?? null;
}

/** Ghi nhận trạng thái validation/sync lên connection. */
export async function markConnectionSynced(connectionId: string, error?: string): Promise<void> {
  await prisma.facebookConnection.update({
    where: { id: connectionId },
    data: {
      lastSyncedAt: new Date(),
      lastValidatedAt: new Date(),
      lastError: error ?? null,
      status: error ? "ERROR" : "ACTIVE",
    },
  });
}
