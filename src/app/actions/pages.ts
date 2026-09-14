"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentUser, resolveWorkspace } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { encryptValue } from "@/lib/settings";
import {
  exchangeForLongLivedToken,
  syncPagesToDb,
} from "@/lib/facebook";
import { resolveConnection, markConnectionSynced } from "@/lib/facebook-connection";

export type PageActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  details?: string[];
} | null;

/**
 * Page + kiểm tra user là THÀNH VIÊN workspace sở hữu Page.
 *
 * Vì sao không so `page.userId`: Page được đồng bộ bởi một thành viên, nhưng
 * dữ liệu cách ly theo workspace (xem schema.prisma, khối WORKSPACE). Nếu chỉ
 * chủ Page thao tác được thì các thành viên khác vẫn THẤY Page ở trang
 * Thương hiệu nhưng bấm nút lại thất bại im lặng.
 */
async function accessiblePage(pageId: string, userId: string) {
  const page = await prisma.facebookPage.findUnique({ where: { id: pageId } });
  if (!page) return null;
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: page.workspaceId, userId } },
    select: { role: true },
  });
  if (!member) return null;
  return page;
}

/**
 * Đồng bộ danh sách Pages THEO CONNECTION của workspace:
 * nhận User Access Token của Facebook App đó, đổi long-lived,
 * fetch /me/accounts rồi upsert theo (workspaceId, fbPageId).
 *
 * formData: connectionId (bắt buộc), userToken (bắt buộc).
 */
export async function syncFacebookPages(
  _prev: PageActionState,
  formData: FormData
): Promise<PageActionState> {
  const user = await requireCurrentUser();

  const connectionId = String(formData.get("connectionId") ?? "").trim();
  const inputToken = String(formData.get("userToken") ?? "").trim();
  if (!connectionId) {
    return { error: "Vui lòng chọn Facebook App (connection) trước khi đồng bộ." };
  }
  if (!inputToken) {
    return { error: "Vui lòng dán User Access Token." };
  }

  try {
    // Connection phải tồn tại; workspace lấy từ membership của user
    const connRow = await prisma.facebookConnection.findUnique({
      where: { id: connectionId },
    });
    if (!connRow) {
      return { error: "Facebook App (connection) không tồn tại." };
    }

    // Kiểm tra user là thành viên workspace của connection
    const ctx = await resolveWorkspace(connRow.workspaceId);
    if (ctx.workspace.id !== connRow.workspaceId) {
      return { error: "Bạn không có quyền đồng bộ Page cho Facebook App này." };
    }

    // Giải mã cấu hình connection (appId/secret có thể mã hóa từ backfill)
    const conn = await resolveConnection(connectionId);
    if (!conn || !conn.appSecret) {
      return { error: "Connection thiếu App Secret — cập nhật trong trang Facebook Apps." };
    }

    // 1) Đổi token long-lived bằng appId/secret CỦA CONNECTION
    let accessToken = inputToken;
    let expiresInSeconds = 0;
    try {
      const exchanged = await exchangeForLongLivedToken(inputToken, {
        appId: conn.appId,
        appSecret: conn.appSecret,
        graphVersion: conn.graphVersion,
      });
      accessToken = exchanged.accessToken;
      expiresInSeconds = exchanged.expiresInSeconds;
    } catch {
      accessToken = inputToken; // token có thể đã long-lived → dùng trực tiếp
    }

    // 2) Lưu token vào connection (mã hóa)
    const tokenExpiresAt = expiresInSeconds
      ? new Date(Date.now() + expiresInSeconds * 1000)
      : null;
    await prisma.facebookConnection.update({
      where: { id: connectionId },
      data: {
        userAccessToken: encryptValue(accessToken),
        tokenExpiresAt,
        lastValidatedAt: new Date(),
        status: "ACTIVE",
        lastError: null,
      },
    });

    // 3) Fetch pages + upsert DB theo (workspaceId, fbPageId)
    const count = await syncPagesToDb(
      user.id,
      connRow.workspaceId,
      connectionId,
      accessToken,
      expiresInSeconds
    );
    await markConnectionSynced(connectionId);

    revalidatePath("/pages");
    revalidatePath("/dashboard");

    return {
      ok: true,
      message: `Đồng bộ thành công ${count} Page qua "${connRow.name}".`,
      details: [
        "Page Access Token (long-lived) đã được lưu vào DB.",
        "Giờ bạn có thể đăng bài ở trang Soạn bài.",
      ],
    };
  } catch (err) {
    return {
      ok: false,
      error: `Đồng bộ thất bại: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * LƯU Ý TƯƠNG THÍCH: đồng bộ kiểu CŨ (không có connectionId).
 * Dùng connection mặc định của workspace đầu tiên của user. Giữ lại để
 * form cũ/test không vỡ; luồng mới luôn truyền connectionId.
 */
export async function syncFacebookPagesLegacy(
  _prev: PageActionState,
  formData: FormData
): Promise<PageActionState> {
  await requireCurrentUser();
  const ctx = await resolveWorkspace(null);
  const { getDefaultConnection } = await import("@/lib/facebook-connection");
  const connectionId = await getDefaultConnection(ctx.workspace.id);
  if (!connectionId) {
    return { error: "Workspace chưa có Facebook App nào — thêm ở trang Facebook Apps." };
  }
  const fd = new FormData();
  fd.set("connectionId", connectionId);
  fd.set("userToken", String(formData.get("userToken") ?? ""));
  return syncFacebookPages(null, fd);
}

export async function togglePageActive(pageId: string): Promise<void> {
  const user = await requireCurrentUser();
  const page = await accessiblePage(pageId, user.id);
  if (!page) return;

  await prisma.facebookPage.update({
    where: { id: pageId },
    data: { isActive: !page.isActive },
  });
  revalidatePath("/pages");
  revalidatePath("/dashboard");
  revalidatePath("/autopilot");
}

export async function deletePage(pageId: string): Promise<void> {
  const user = await requireCurrentUser();
  const page = await accessiblePage(pageId, user.id);
  if (!page) return;

  await prisma.facebookPage.delete({ where: { id: pageId } });
  revalidatePath("/pages");
  revalidatePath("/dashboard");
}

/**
 * Gán / bỏ gán Page vào Brand (trong cùng workspace).
 *
 * Vì sao trả về kết quả thay vì `void`: bản cũ `return` im lặng khi user
 * không phải chủ Page hoặc Brand khác workspace, nên giao diện không có cách
 * nào báo lỗi — người dùng chỉ thấy "gắn mãi không được". Trả state để nút
 * gắn hiển thị đúng nguyên nhân.
 *
 * Phân quyền theo THÀNH VIÊN workspace (không phải `page.userId`): dữ liệu đã
 * cách ly theo workspace, nên mọi thành viên đều gắn được cho Page của
 * workspace mình.
 */
export async function assignPageToBrand(
  pageId: string,
  brandId: string | null
): Promise<PageActionState> {
  const user = await requireCurrentUser();

  const page = await prisma.facebookPage.findUnique({
    where: { id: pageId },
    select: { id: true, name: true, workspaceId: true },
  });
  if (!page) return { ok: false, error: "Page không tồn tại." };

  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: page.workspaceId, userId: user.id } },
    select: { role: true },
  });
  if (!member) {
    return { ok: false, error: "Bạn không có quyền thao tác trên Page này." };
  }

  let brandName: string | null = null;
  const details: string[] = [];

  if (brandId) {
    const brand = await prisma.brand.findUnique({
      where: { id: brandId },
      select: { id: true, name: true, workspaceId: true },
    });
    if (!brand) return { ok: false, error: "Thương hiệu không tồn tại." };
    if (brand.workspaceId !== page.workspaceId) {
      return { ok: false, error: "Thương hiệu thuộc workspace khác — không gắn được." };
    }
    brandName = brand.name;

    // Cảnh báo sớm: Brand chưa có trụ cột thì bật tự động vẫn bị chặn.
    const pillars = await prisma.contentPillar.count({
      where: { brandId, enabled: true },
    });
    if (pillars === 0) {
      details.push(
        "Thương hiệu này chưa có trụ cột nội dung nào đang bật — vào trang Thương hiệu để thêm trước khi bật chế độ tự động."
      );
    }
  }

  await prisma.facebookPage.update({
    where: { id: pageId },
    data: { brandId },
  });

  revalidatePath("/pages");
  revalidatePath("/brand");
  revalidatePath("/autopilot");
  revalidatePath("/facebook-apps");
  revalidatePath("/composer");

  return {
    ok: true,
    message: brandId
      ? `Đã gắn "${page.name}" vào thương hiệu "${brandName}".`
      : `Đã bỏ gắn thương hiệu khỏi "${page.name}".`,
    details: details.length > 0 ? details : undefined,
  };
}

/**
 * Chuyển Page sang connection khác (cùng workspace).
 * Connection đích phải thuộc workspace của Page.
 */
export async function switchPageConnection(pageId: string, connectionId: string): Promise<void> {
  const user = await requireCurrentUser();
  const page = await accessiblePage(pageId, user.id);
  if (!page) return;

  const conn = await prisma.facebookConnection.findUnique({ where: { id: connectionId } });
  if (!conn || conn.workspaceId !== page.workspaceId) return;

  await prisma.facebookPage.update({
    where: { id: pageId },
    data: { connectionId },
  });
  revalidatePath("/pages");
}

/**
 * CRUD Facebook Connection trong workspace.
 */
export async function saveFacebookConnection(
  _prev: PageActionState,
  formData: FormData
): Promise<PageActionState> {
  const user = await requireCurrentUser();
  const workspaceId = String(formData.get("workspaceId") ?? "").trim();

  let ctx;
  try {
    ctx = await resolveWorkspace(workspaceId || null);
  } catch {
    return { error: "Workspace không hợp lệ." };
  }

  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const appId = String(formData.get("appId") ?? "").trim();
  const appSecret = String(formData.get("appSecret") ?? "").trim();
  const userToken = String(formData.get("userToken") ?? "").trim();
  const graphVersion = String(formData.get("graphVersion") ?? "").trim() || "v21.0";

  try {
    const { createConnection, updateConnection } = await import("@/lib/facebook-connection");
    if (id) {
      await updateConnection(ctx.workspace.id, id, {
        name, appId, appSecret: appSecret || undefined,
        userAccessToken: userToken || undefined, graphVersion,
      });
      revalidatePath("/facebook-apps");
      revalidatePath("/pages");
      return { ok: true, message: `Đã cập nhật "${name}".` };
    }
    const created = await createConnection(ctx.workspace.id, user.id, {
      name, appId, appSecret, userAccessToken: userToken, graphVersion,
    });
    revalidatePath("/facebook-apps");
    revalidatePath("/pages");
    return {
      ok: true,
      message: `Đã thêm Facebook App "${created.name}".`,
      details: ["Giờ hãy dán User Access Token của App này rồi bấm Đồng bộ Pages."],
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteFacebookConnection(connectionId: string): Promise<void> {
  const user = await requireCurrentUser();
  const conn = await prisma.facebookConnection.findUnique({ where: { id: connectionId } });
  if (!conn) return;

  // Chỉ xóa nếu user là thành viên workspace
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: conn.workspaceId, userId: user.id } },
  });
  if (!member) return;

  const { deleteConnection } = await import("@/lib/facebook-connection");
  try {
    await deleteConnection(conn.workspaceId, connectionId);
  } catch {
    // còn Page phụ thuộc — UI hiển thị lỗi qua trang, ở đây im lặng bỏ qua
  }
  revalidatePath("/facebook-apps");
}
