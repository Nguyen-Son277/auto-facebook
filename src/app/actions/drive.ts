"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import {
  diagnoseFolder,
  driveErrorMessage,
  ensureFolderAccess,
  getAccessToken,
  getFile,
  isDriveConfigured,
  isImageMime,
  isPickerConfigured,
  isVideoMime,
  listFolderMedia,
  needsReauth,
} from "@/lib/drive";
import { parseDriveFileLink, parseDriveFolderLink } from "@/lib/drive-links";

// ============================================================
// Server actions cho Google Drive (giao diện Cài đặt + Thương hiệu).
//
// Nguyên tắc bảo mật:
//  - Mọi action tự kiểm tra người dùng bằng requireCurrentUser(); không tin
//    brandId/folderId từ client mà LUÔN tra lại quyền sở hữu trong DB.
//  - Refresh token không bao giờ rời khỏi server. Chỉ access token NGẮN HẠN
//    được trả cho trình duyệt, và chỉ để Google Picker hoạt động.
// ============================================================

export type DriveState = {
  ok?: boolean;
  error?: string;
  message?: string;
} | null;

/** Một tệp Drive đã chuẩn hóa để hiển thị/chọn trong UI. */
export type DriveBrowseItem = {
  id: string;
  name: string;
  type: "IMAGE" | "VIDEO";
  mimeType: string;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  /** Route nội bộ có kiểm quyền — dùng làm remoteUrl khi đăng bài. */
  previewUrl: string;
  /** Ảnh nhỏ do Google phục vụ (nhẹ hơn, tải nhanh hơn route nội bộ). */
  thumbnailUrl: string | null;
};

export type DriveBrowseResult = {
  ok: boolean;
  items: DriveBrowseItem[];
  nextPageToken: string | null;
  /** Tên thư mục đang duyệt — để UI nói rõ đang xem đâu. */
  folderName: string | null;
  /** Đang duyệt thư mục của thương hiệu nào (null = duyệt thư mục gốc). */
  brandId: string | null;
  error?: string;
};

/**
 * Duyệt ảnh/video trong thư mục Drive của một thương hiệu.
 *
 * Chỉ đọc tệp trực tiếp trong thư mục (không đệ quy) — giữ đơn giản và tránh
 * quét cả cây Drive. Người dùng muốn chia nhóm thì lọc bằng cách bấm Đổi thư mục
 * ở trang Thương hiệu.
 */
export async function browseDriveFolder(
  brandId: string,
  pageToken?: string
): Promise<DriveBrowseResult> {
  const user = await requireCurrentUser();
  const brand = await ownedBrand(user.id, brandId);
  if (!brand) {
    return {
      ok: false,
      items: [],
      nextPageToken: null,
      folderName: null,
      brandId,
      error: "Thương hiệu không tồn tại hoặc không thuộc về bạn.",
    };
  }

  const folder = await prisma.brandDriveFolder.findUnique({
    where: { brandId },
    include: { connection: { select: { id: true, userId: true, status: true } } },
  });
  if (!folder || !folder.connectionId || !folder.connection) {
    return {
      ok: false,
      items: [],
      nextPageToken: null,
      folderName: null,
      brandId,
      error: "Thương hiệu chưa gắn thư mục Google Drive.",
    };
  }
  if (folder.connection.status !== "ACTIVE") {
    return {
      ok: false,
      items: [],
      nextPageToken: null,
      folderName: folder.folderName,
      brandId,
      error:
        folder.connection.status === "NEEDS_REAUTH"
          ? "Kết nối Google Drive cần cấp quyền lại — vào Cài đặt."
          : "Kết nối Google Drive đang bị tắt.",
    };
  }

  try {
    const page = await listFolderMedia(folder.connectionId, folder.folderId, {
      pageToken,
      allowVideo: folder.allowVideo,
      pageSize: 60,
    });

    const items: DriveBrowseItem[] = page.files.map((f) => ({
      id: f.id,
      name: f.name,
      type: isVideoMime(f.mimeType) ? "VIDEO" : "IMAGE",
      mimeType: f.mimeType,
      sizeBytes: f.size,
      width: f.width,
      height: f.height,
      duration: f.duration,
      previewUrl: `/api/drive/${f.id}`,
      thumbnailUrl: f.thumbnailLink,
    }));

    await prisma.brandDriveFolder
      .update({
        where: { brandId },
        data: { lastError: null, lastSyncedAt: new Date() },
      })
      .catch(() => {});

    return {
      ok: true,
      items,
      nextPageToken: page.nextPageToken,
      folderName: folder.folderName,
      brandId,
    };
  } catch (err) {
    const message = driveErrorMessage(err);
    await prisma.brandDriveFolder
      .update({ where: { brandId }, data: { lastError: message } })
      .catch(() => {});
    return {
      ok: false,
      items: [],
      nextPageToken: null,
      folderName: folder.folderName,
      brandId,
      error: message,
    };
  }
}

/** Trạng thái kết nối Drive để hiển thị ở Cài đặt và ở trang Thương hiệu. */
export type DriveStatus = {
  configured: boolean;
  pickerReady: boolean;
  connected: boolean;
  googleEmail: string | null;
  status: string | null;
  lastError: string | null;
  lastRefreshedAt: string | null;
  rootFolderId: string | null;
};

export async function getDriveStatus(): Promise<DriveStatus> {
  const user = await requireCurrentUser();
  const conn = await prisma.driveConnection.findUnique({ where: { userId: user.id } });

  return {
    configured: isDriveConfigured(),
    pickerReady: isPickerConfigured(),
    connected: Boolean(conn && conn.status === "ACTIVE"),
    googleEmail: conn?.googleEmail ?? null,
    status: conn?.status ?? null,
    lastError: conn?.lastError ?? null,
    lastRefreshedAt: conn?.lastRefreshedAt?.toISOString() ?? null,
    rootFolderId: conn?.rootFolderId ?? null,
  };
}

/**
 * Access token ngắn hạn cho Google Picker (chạy trong trình duyệt).
 *
 * CHỈ trả access token — refresh token ở lại server. Hết hạn thì hàm này tự
 * làm mới như mọi lời gọi Drive khác.
 */
export async function getDriveAccessToken(): Promise<
  { ok: true; accessToken: string } | { ok: false; error: string }
> {
  const user = await requireCurrentUser();
  const conn = await prisma.driveConnection.findUnique({
    where: { userId: user.id },
    select: { id: true, status: true },
  });
  if (!conn) {
    return { ok: false, error: "Chưa kết nối Google Drive." };
  }
  if (conn.status === "DISABLED") {
    return { ok: false, error: "Kết nối Google Drive đang bị tắt." };
  }

  try {
    const accessToken = await getAccessToken(conn.id);
    return { ok: true, accessToken };
  } catch (err) {
    if (needsReauth(err)) {
      await prisma.driveConnection
        .update({
          where: { id: conn.id },
          data: { status: "NEEDS_REAUTH", lastError: driveErrorMessage(err) },
        })
        .catch(() => {});
    }
    return { ok: false, error: driveErrorMessage(err) };
  }
}

/** Ngắt kết nối Drive của người dùng hiện tại. */
export async function disconnectDrive(): Promise<void> {
  const user = await requireCurrentUser();
  const conn = await prisma.driveConnection.findUnique({
    where: { userId: user.id },
    select: { id: true },
  });
  if (!conn) return;

  await prisma.$transaction(async (tx) => {
    // Giữ folderId lại: người dùng nối lại tài khoản cũ thì không phải chọn
    // thư mục cho từng thương hiệu lần nữa.
    await tx.brandDriveFolder.updateMany({
      where: { connectionId: conn.id },
      data: { connectionId: null },
    });

    // AutoPilot đang lấy ảnh từ Drive sẽ không còn nguồn → chuyển về Pexels và
    // BẬT dự phòng, để hệ thống không lặng lẽ đăng bài trắng ảnh.
    await tx.autoPilot.updateMany({
      where: { userId: user.id, mediaPrimary: "DRIVE" },
      data: { mediaPrimary: "PEXELS", mediaFallback: true },
    });

    await tx.driveConnection.delete({ where: { id: conn.id } });
  });

  revalidatePath("/settings");
  revalidatePath("/brand");
  revalidatePath("/autopilot");
}

/**
 * Gắn thư mục Drive cho thương hiệu bằng LINK do người dùng dán.
 *
 * Dùng khi Google Picker không chạy được (script bị chặn, Picker API lỗi).
 *
 * ⚠️ GIỚI HẠN THẬT: dán link KHÔNG cấp quyền `drive.file` cho app. Hàm này
 * trích ID rồi gọi `ensureFolderAccess` để KIỂM TRA QUYỀN THẬT ngay lập tức:
 *  - Đọc được  → lưu luôn.
 *  - Không đọc được → trả lỗi nguyên văn kèm hướng dẫn, KHÔNG lưu dữ liệu rác.
 *
 * Nhờ vậy người dùng biết ngay link đó có dùng được hay không, thay vì gắn xong
 * rồi bài đăng mới lộ lỗi.
 */
export async function linkBrandFolderByUrl(
  brandId: string,
  url: string
): Promise<DriveState> {
  const parsed = parseDriveFolderLink(url);
  if (!parsed.ok) return { error: parsed.error };
  if (parsed.kind !== "folder") {
    return { error: "Link phải trỏ tới một THƯ MỤC, không phải tệp." };
  }

  const res = await linkBrandFolder(brandId, parsed.folderId);

  // Dán link không cấp quyền mới, nên nếu đọc thất bại thì hướng dẫn đúng việc
  // cần làm: mở quyền cho thư mục, hoặc dùng Google Picker (cách cấp quyền thật).
  if (!res?.ok) {
    return {
      error:
        `${res?.error ?? "Không đọc được thư mục này."}\n\n` +
        "Dán link không tự cấp quyền cho app. Hai cách xử lý:\n" +
        "① Trên Google Drive, chuột phải thư mục → Chia sẻ → đổi thành “Bất kỳ ai có link” → dán lại link.\n" +
        "② Hoặc dùng nút “Chọn thư mục trên Drive” (Google Picker) — cách này cấp quyền thật cho app và an toàn hơn.",
    };
  }

  return {
    ok: true,
    message: `Đã gắn thư mục Drive từ link: ${parsed.folderId}`,
  };
}

/**
 * Lấy metadata một TỆP Drive từ link dán tay, để gắn vào bài đang soạn.
 *
 * Cùng tinh thần với `linkBrandFolderByUrl`: trích ID → kiểm tra quyền đọc thật
 * → chỉ trả dữ liệu khi Drive thực sự cho đọc. Không cấp quyền mới.
 */
export async function attachDriveFileByUrl(url: string): Promise<
  { ok: true; item: DriveBrowseItem } | { ok: false; error: string }
> {
  const user = await requireCurrentUser();

  const parsed = parseDriveFileLink(url);
  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.error.includes("THƯ MỤC")
        ? parsed.error
        : `${parsed.error}\n\nHoặc gắn cả thư mục ở trang Thương hiệu rồi dùng thẻ “Thư mục Drive” trong trình soạn bài.`,
    };
  }

  const conn = await prisma.driveConnection.findUnique({
    where: { userId: user.id },
    select: { id: true, status: true },
  });
  if (!conn) return { ok: false, error: "Chưa kết nối Google Drive — vào Cài đặt để kết nối trước." };
  if (conn.status === "NEEDS_REAUTH") {
    return { ok: false, error: "Kết nối Google Drive cần cấp quyền lại — vào Cài đặt." };
  }
  if (conn.status === "DISABLED") return { ok: false, error: "Kết nối Google Drive đang bị tắt." };

  try {
    const file = await getFile(conn.id, parsed.driveFileId);
    if (file.mimeType === "application/vnd.google-apps.folder") {
      return {
        ok: false,
        error:
          "Link này trỏ tới một THƯ MỤC. Hãy mở tấm ảnh cụ thể trong thư mục rồi copy link của tệp.",
      };
    }
    if (!isImageMime(file.mimeType) && !isVideoMime(file.mimeType)) {
      return {
        ok: false,
        error: `Tệp này không phải ảnh/video (${file.mimeType || "không rõ loại"}).`,
      };
    }

    return {
      ok: true,
      item: {
        id: file.id,
        name: file.name,
        type: isVideoMime(file.mimeType) ? "VIDEO" : "IMAGE",
        mimeType: file.mimeType,
        sizeBytes: file.size,
        width: file.width,
        height: file.height,
        duration: file.duration,
        previewUrl: `/api/drive/${file.id}`,
        thumbnailUrl: file.thumbnailLink,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error:
        `Không đọc được tệp này.\n${driveErrorMessage(err)}\n\n` +
        "Dán link không tự cấp quyền cho app — hãy dùng nút “Chọn từ Google Drive” (Picker), " +
        "hoặc để tệp ở chế độ “Bất kỳ ai có link”.",
    };
  }
}

/**
 * Chẩn đoán: "vì sao thư mục có ảnh mà app không thấy ảnh nào?".
 *
 * Trả về đủ dữ liệu để phân biệt 4 nguyên nhân (định dạng lạ / file nằm trong
 * thư mục con / Drive không trả kết quả / thư mục thật sự trống), kèm câu kết
 * luận bằng tiếng Việt. Chỉ đọc, không ghi.
 */
export async function diagnoseDriveFolder(brandId: string, url?: string): Promise<DriveState> {
  const user = await requireCurrentUser();

  const conn = await prisma.driveConnection.findUnique({
    where: { userId: user.id },
    select: { id: true, status: true },
  });
  if (!conn) return { error: "Chưa kết nối Google Drive — vào Cài đặt để kết nối trước." };
  if (conn.status !== "ACTIVE") {
    return { error: "Kết nối Google Drive cần cấp quyền lại hoặc đang bị tắt." };
  }

  let folderId: string | null = null;
  if (url && url.trim()) {
    const parsed = parseDriveFolderLink(url);
    if (!parsed.ok) return { error: parsed.error };
    folderId = parsed.kind === "folder" ? parsed.folderId : null;
    if (!folderId) return { error: "Link phải trỏ tới một thư mục." };
  } else {
    const brand = await ownedBrand(user.id, brandId);
    if (!brand) return { error: "Thương hiệu không tồn tại hoặc không thuộc về bạn." };
    const folder = await prisma.brandDriveFolder.findUnique({
      where: { brandId },
      select: { folderId: true },
    });
    folderId = folder?.folderId ?? null;
  }
  if (!folderId) return { error: "Chưa có thư mục nào để chẩn đoán." };

  try {
    const d = await diagnoseFolder(conn.id, folderId);

    const mimeList = Object.entries(d.mimeCounts)
      .map(([mime, n]) => `  • ${nilempty(mime)}: ${n}`)
      .join("\n");

    const mediaList = d.mediaFiles.length
      ? d.mediaFiles.slice(0, 8).map((f) => `  • ${f.name} (${f.mimeType})`).join("\n")
      : "  (không có)";

    const folderList = d.subfolders.length
      ? d.subfolders.slice(0, 8).map((f) => `  • ${f.name}`).join("\n")
      : "  (không có thư mục con)";

    // Kết luận: nói thẳng nguyên nhân số 1 hoặc số 2 vì đó là hai ca hay gặp nhất.
    let verdict: string;
    if (d.mediaFiles.length > 0) {
      verdict = `✓ Tìm thấy ${d.mediaFiles.length} ảnh/video dùng được. Bấm “Xem nội dung thư mục” để hiện.`;
    } else if (d.nestedMediaCount > 0) {
      verdict =
        `⚠ Thư mục này KHÔNG chứa ảnh trực tiếp — có ${d.nestedMediaCount} tệp nằm trong THƯ MỤC CON.\n` +
        `Cách xử lý: gắn thư mục con đó cho thương hiệu (dán link thư mục con), hoặc chuyển ảnh ra thẳng thư mục này.`;
    } else if (d.directFiles.length > 0) {
      verdict =
        `⚠ Có ${d.directFiles.length} tệp nhưng KHÔNG có định dạng ảnh/video Facebook dùng được.\n` +
        `Định dạng đang có:\n${mimeList}\n` +
        `Cách xử lý: đổi ảnh sang JPG/PNG/WEBP rồi tải lại lên Drive.`;
    } else if (d.subfolders.length > 0) {
      verdict =
        `⚠ Thư mục chỉ có thư mục con, không có tệp trực tiếp.\nThư mục con:\n${folderList}\n` +
        `Cách xử lý: gắn một thư mục con cho thương hiệu.`;
    } else {
      verdict = "⚠ Google trả về 0 mục. Kiểm tra lại thư mục có ảnh chưa, hoặc thử tải lại danh sách.";
    }

    return {
      ok: true,
      message:
        `${verdict}\n\n` +
        `Tổng tệp trực tiếp: ${d.directFiles.length} · thư mục con: ${d.subfolders.length} · ` +
        `ảnh/video dùng được: ${d.mediaFiles.length}\n` +
        `Ảnh/video dùng được:\n${mediaList}\n` +
        `Loại tệp trong thư mục:\n${mimeList || "  (trống)"}`,
    };
  } catch (err) {
    return {
      error:
        `Không đọc được thư mục để chẩn đoán.\n${driveErrorMessage(err)}\n\n` +
        "Nếu là 403/404: app chưa được cấp quyền với thư mục này.",
    };
  }
}

/** Tên loại tệp dễ đọc cho phần chẩn đoán. */
function nilempty(mime: string): string {
  return mime || "(không rõ loại)";
}

/**
 * Gắn một thư mục Drive cho thương hiệu.
 *
 * `folderId` đến từ Google Picker phía trình duyệt nên KHÔNG được tin ngay:
 * bước ensureFolderAccess vừa xác nhận đó là thư mục, vừa là cách để app
 * được cấp quyền `drive.file` trên thư mục đó.
 */
export async function linkBrandFolder(
  brandId: string,
  folderId: string
): Promise<DriveState> {
  const user = await requireCurrentUser();
  const folder = String(folderId ?? "").trim();
  if (!brandId || !folder) {
    return { error: "Chưa chọn thư mục trên Google Drive." };
  }

  const brand = await ownedBrand(user.id, brandId);
  if (!brand) return { error: "Thương hiệu không tồn tại hoặc không thuộc về bạn." };

  const conn = await prisma.driveConnection.findUnique({
    where: { userId: user.id },
    select: { id: true, status: true },
  });
  if (!conn) return { error: "Chưa kết nối Google Drive — vào Cài đặt để kết nối trước." };
  if (conn.status === "NEEDS_REAUTH") {
    return { error: "Kết nối Google Drive cần cấp quyền lại — vào Cài đặt." };
  }
  if (conn.status === "DISABLED") return { error: "Kết nối Google Drive đang bị tắt." };

  try {
    const meta = await ensureFolderAccess(conn.id, folder);
    await prisma.brandDriveFolder.upsert({
      where: { brandId },
      create: {
        brandId,
        connectionId: conn.id,
        folderId: meta.id,
        folderName: meta.name,
        lastError: null,
      },
      update: {
        connectionId: conn.id,
        folderId: meta.id,
        folderName: meta.name,
        lastError: null,
      },
    });
  } catch (err) {
    const message = driveErrorMessage(err);
    await prisma.brandDriveFolder
      .upsert({
        where: { brandId },
        create: { brandId, connectionId: conn.id, folderId: folder, lastError: message },
        update: { connectionId: conn.id, folderId: folder, lastError: message },
      })
      .catch(() => {});
    return { error: message };
  }

  revalidatePath("/brand");
  revalidatePath("/autopilot");
  return { ok: true, message: "Đã gắn thư mục Google Drive cho thương hiệu." };
}

/**
 * Lưu một tệp Drive vào thư viện cá nhân để dùng lại.
 *
 * Chống trùng theo (userId, providerId) — providerId giữ fileId Drive.
 */
export async function saveDriveFileToLibrary(input: {
  fileId: string;
  name?: string;
  type: "IMAGE" | "VIDEO";
  mimeType?: string;
  sizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
}): Promise<DriveState> {
  const user = await requireCurrentUser();
  const fileId = String(input.fileId ?? "").trim();
  if (!fileId) return { error: "Thiếu mã tệp Google Drive." };

  // Phải có kết nối Drive đang hoạt động — không cho lưu tệp của tài khoản khác
  const conn = await prisma.driveConnection.findUnique({
    where: { userId: user.id },
    select: { id: true, status: true },
  });
  if (!conn || conn.status !== "ACTIVE") {
    return { error: "Chưa kết nối Google Drive (hoặc kết nối cần cấp quyền lại)." };
  }

  const existing = await prisma.media.findFirst({
    where: { userId: user.id, postId: null, providerId: fileId, source: "DRIVE" },
    select: { id: true },
  });
  if (existing) return { ok: true, message: "Tệp này đã có trong thư viện." };

  const type: "IMAGE" | "VIDEO" = input.type === "VIDEO" ? "VIDEO" : "IMAGE";

  await prisma.media.create({
    data: {
      userId: user.id,
      postId: null,
      type,
      source: "DRIVE",
      // Route nội bộ — Media.remoteUrl cho DRIVE luôn ở dạng này
      remoteUrl: `/api/drive/${fileId}`,
      previewUrl: `/api/drive/${fileId}`,
      providerId: fileId,
      mimeType: input.mimeType ?? null,
      sizeBytes: typeof input.sizeBytes === "number" ? input.sizeBytes : null,
      width: typeof input.width === "number" ? input.width : null,
      height: typeof input.height === "number" ? input.height : null,
      duration: typeof input.duration === "number" ? input.duration : null,
      alt: input.name ?? null,
    },
  });

  revalidatePath("/media");
  revalidatePath("/composer");
  return {
    ok: true,
    message: type === "VIDEO" ? "Đã lưu video Drive vào thư viện." : "Đã lưu ảnh Drive vào thư viện.",
  };
}

/** Bỏ liên kết thư mục Drive của thương hiệu. */export async function unlinkBrandFolder(brandId: string): Promise<DriveState> {
  const user = await requireCurrentUser();
  const brand = await ownedBrand(user.id, brandId);
  if (!brand) return { error: "Thương hiệu không tồn tại hoặc không thuộc về bạn." };

  await prisma.$transaction(async (tx) => {
    await tx.brandDriveFolder.deleteMany({ where: { brandId } });

    // Page của thương hiệu này đang lấy ảnh Drive → chuyển về Pexels cho khỏi
    // hụt ảnh, và bật dự phòng để không bao giờ thiếu ảnh im lặng.
    const pages = await tx.facebookPage.findMany({
      where: { brandId },
      select: { id: true },
    });
    if (pages.length > 0) {
      await tx.autoPilot.updateMany({
        where: { pageId: { in: pages.map((p) => p.id) }, mediaPrimary: "DRIVE" },
        data: { mediaPrimary: "PEXELS", mediaFallback: true },
      });
    }
  });

  revalidatePath("/brand");
  revalidatePath("/autopilot");
  return { ok: true, message: "Đã bỏ thư mục Drive của thương hiệu." };
}

/** Trạng thái thư mục Drive của một Brand (để hiển thị ở trang Thương hiệu). */
export async function getBrandDriveFolder(brandId: string): Promise<{
  linked: boolean;
  folderId: string | null;
  folderName: string | null;
  lastError: string | null;
  connectionStatus: string | null;
}> {
  const user = await requireCurrentUser();
  const brand = await ownedBrand(user.id, brandId);
  if (!brand) {
    return { linked: false, folderId: null, folderName: null, lastError: null, connectionStatus: null };
  }

  const folder = await prisma.brandDriveFolder.findUnique({
    where: { brandId },
    include: { connection: { select: { status: true } } },
  });

  return {
    linked: Boolean(folder),
    folderId: folder?.folderId ?? null,
    folderName: folder?.folderName ?? null,
    lastError: folder?.lastError ?? null,
    connectionStatus: folder?.connection?.status ?? null,
  };
}

/** Brand + kiểm tra người dùng là thành viên workspace sở hữu brand. */
async function ownedBrand(userId: string, brandId: string) {
  const brand = await prisma.brand.findUnique({
    where: { id: brandId },
    select: { id: true, name: true, workspaceId: true },
  });
  if (!brand) return null;
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: brand.workspaceId, userId } },
    select: { role: true },
  });
  return member ? brand : null;
}
