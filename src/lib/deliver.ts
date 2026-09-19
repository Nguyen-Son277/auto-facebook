import "server-only";

import {
  publishFeedWithPhotoIds,
  publishMultiPhotosToPage,
  publishPhotoBinaryToPage,
  publishTextToPage,
  publishVideoToPage,
  type BinaryUpload,
  type GraphContext,
} from "@/lib/facebook";
import { signedReadUrl, uploadSize } from "@/lib/uploads";
import { DriveError, downloadFile, driveErrorMessage, getFile } from "@/lib/drive";
import { extensionForMime } from "@/lib/drive-files";
import { prisma } from "@/lib/prisma";

// ============================================================
// Gửi nội dung + media lên Facebook.
//
// Tách riêng khỏi actions/publish.ts để CẢ hai đường dùng chung một logic:
// - Người dùng bấm "Đăng ngay" (actions/publish.ts)
// - Worker tự động đăng theo lịch (lib/scheduler.ts)
// Nhờ vậy quy tắc chọn endpoint chỉ tồn tại ở một nơi.
//
// BA NGUỒN MEDIA, TRỘN ĐƯỢC TRONG CÙNG MỘT BÀI:
//   PEXELS / URL → đăng bằng `url` (Facebook tự tải về)
//   UPLOAD       → signed URL của Supabase Storage (video) hoặc binary (ảnh)
//   DRIVE        → tải binary từ Drive rồi upload multipart lên Graph API,
//                  vì Facebook KHÔNG đọc được link Drive riêng tư.
// Mỗi media tự quyết định đường đi theo `source` của nó, nên bài trộn
// (ví dụ 2 ảnh Drive + 2 ảnh Pexels) chạy đúng mà không cần nhánh riêng.
//
// ĐA CONNECTION: `conn` mang graphVersion (và appId/secret khi cần)
// của FacebookConnection đã cấp token cho Page — mỗi Page đăng bằng
// đúng phiên bản Graph API của App tương ứng.
// ============================================================

export type DeliverPage = { fbPageId: string; accessToken: string };

export type DeliverMedia = {
  type: string;
  source: string;
  remoteUrl: string;
  storageKey?: string | null;
  /** Chỉ có với source = DRIVE: fileId trên Google Drive. */
  driveFileId?: string | null;
  mimeType?: string | null;
  /** Byte — dùng để chặn sớm video quá lớn. */
  sizeBytes?: number | null;
};

/** Ghép nội dung + hashtag thành message gửi Facebook. */
export function buildMessage(content: string, hashtags?: string | null): string {
  const tags = hashtags?.trim() ?? "";
  return tags ? `${content}\n\n${tags}` : content;
}

/**
 * Giới hạn dung lượng video có thể chuyển tiếp.
 *
 * Dùng chung biến với luồng upload Supabase (mặc định 50MB) để người dùng
 * không gặp hai ngưỡng khác nhau cho cùng một loại tệp.
 */
function maxVideoBytes(): number {
  return Number(process.env.MAX_VIDEO_BYTES ?? 50 * 1024 * 1024);
}

/** MIME mặc định khi bản ghi cũ không lưu mimeType (Pexels/Drive luôn có). */
function fallbackMime(type: string, source: string): string {
  if (type === "VIDEO") return "video/mp4";
  return source === "DRIVE" ? "image/jpeg" : "image/jpeg";
}

/**
 * Lấy thông tin tải một tệp Drive, có kiểm tra quyền sở hữu.
 *
 * fileId nằm trong DB (không phải do client gửi ở bước này), nhưng vẫn phải
 * tra đúng connection của người dùng — nếu không, một workspace nhiều người
 * có thể đăng tệp Drive của người khác.
 */
async function resolveDriveFile(
  userId: string,
  fileId: string,
  hint: { mimeType?: string | null; sizeBytes?: number | null; type: string }
): Promise<{ connectionId: string; mimeType: string; size: number | null; filename: string }> {
  const conn = await prisma.driveConnection.findUnique({
    where: { userId },
    select: { id: true, status: true },
  });
  if (!conn || conn.status === "DISABLED") {
    throw new Error("Chưa kết nối Google Drive — vào Cài đặt để kết nối.");
  }

  // Có sẵn metadata (do Picker/AutoPilot lưu) thì dùng luôn: tiết kiệm một
  // lượt gọi Drive cho mỗi ảnh. Chỉ hỏi Drive khi thiếu.
  let mimeType = hint.mimeType ?? "";
  let size = hint.sizeBytes ?? null;

  if (!mimeType) {
    const meta = await getFile(conn.id, fileId);
    mimeType = meta.mimeType;
    size = size ?? meta.size;
  }

  const type = hint.type === "VIDEO" ? "VIDEO" : "IMAGE";
  if (type === "VIDEO" && size !== null && size > maxVideoBytes()) {
    throw new Error(
      `Video trên Drive nặng ${(size / 1024 / 1024).toFixed(1)}MB, vượt giới hạn ` +
        `${Math.round(maxVideoBytes() / 1024 / 1024)}MB — nén lại hoặc nâng MAX_VIDEO_BYTES.`
    );
  }

  return {
    connectionId: conn.id,
    mimeType: mimeType || fallbackMime(type, "DRIVE"),
    size,
    filename: `drive-${fileId.slice(0, 12)}${extensionForMime(mimeType || fallbackMime(type, "DRIVE"))}`,
  };
}

/** Tải một tệp Drive thành BinaryUpload để gửi thẳng lên Graph API. */
async function driveBinary(
  connectionId: string,
  fileId: string,
  filename: string,
  mimeType: string,
  size: number | null
): Promise<BinaryUpload> {
  const res = await downloadFile(connectionId, fileId);
  return {
    data: res.body ?? (await res.blob()),
    filename,
    mimeType,
    size,
  };
}

/**
 * Tải nội dung một tệp Drive vào Supabase Storage tạm, trả về URL có chữ ký
 * cho Facebook tự lấy. Dùng cho VIDEO: đường `file_url` chịu được file lớn
 * tốt hơn là đẩy toàn bộ byte qua hàm serverless của mình, và đây cũng là
 * cách luồng "tải video từ máy" đang chạy.
 *
 * Object được đặt tiền tố "tmp-" và XOÁ trong `finally` ở hàm gọi.
 */
async function stageDriveVideo(
  userId: string,
  connectionId: string,
  fileId: string,
  mimeType: string,
  size: number | null
): Promise<{ url: string; storageKey: string }> {
  const { createSignedUploadUrl, createSignedReadUrl } = await import("@/lib/storage");
  const { randomBytes } = await import("node:crypto");

  // Tên tạm theo đúng dạng tmp-<24 hex>.<ext>: nếu tiến trình chết giữa đường,
  // pruneOrphanUploads (xem lib/uploads.ts) sẽ dọn sau 24 giờ.
  const storageKey = `tmp-${randomBytes(12).toString("hex")}${extensionForMime(mimeType)}`;
  const uploadUrl = await createSignedUploadUrl(userId, storageKey);

  const upstream = await downloadFile(connectionId, fileId);
  const body = upstream.body ?? (await upstream.blob());

  const put = await fetch(uploadUrl, {
    method: "PUT",
    body: body as unknown as BodyInit,
    headers: {
      "Content-Type": mimeType,
      ...(size !== null ? { "Content-Length": String(size) } : {}),
      "x-upsert": "true",
    },
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  if (!put.ok) {
    throw new Error(
      `Không đưa được video Drive lên kho tạm (HTTP ${put.status}). Thử lại hoặc chọn video khác.`
    );
  }

  return { url: await createSignedReadUrl(userId, storageKey), storageKey };
}

/** Xoá object tạm — không bao giờ để lỗi xoá làm hỏng việc đăng bài. */
async function cleanupTemp(userId: string, storageKey: string): Promise<void> {
  try {
    const { removeObject } = await import("@/lib/storage");
    await removeObject(userId, storageKey);
  } catch {
    // Object tạm nằm lại cũng không sao: pruneOrphanUploads sẽ dọn sau 24 giờ,
    // nhưng tmp-* không khớp KEY_PATTERN nên nó không tự dọn — chấp nhận, và
    // đây là lý do XOÁ NGAY trong finally là quan trọng.
  }
}

/**
 * Gửi nội dung + media lên Facebook, chọn đúng endpoint theo từng media:
 * - Video  → Drive: kho tạm + file_url | UPLOAD: signed URL | URL: file_url
 * - Ảnh    → Drive: binary multipart | PEXELS/URL: `url`
 * - Không media → /feed
 */
export async function deliverToFacebook(
  userId: string,
  page: DeliverPage,
  message: string,
  media: DeliverMedia[],
  conn?: GraphContext | null
): Promise<string> {
  const video = media.find((m) => m.type === "VIDEO");
  const photos = media.filter((m) => m.type === "IMAGE");

  // ---------- VIDEO (mỗi bài tối đa 1) ----------
  if (video) {
    if (video.source === "DRIVE" && video.driveFileId) {
      const resolved = await resolveDriveFile(userId, video.driveFileId, {
        mimeType: video.mimeType,
        sizeBytes: video.sizeBytes,
        type: "VIDEO",
      });

      const staged = await stageDriveVideo(
        userId,
        resolved.connectionId,
        video.driveFileId,
        resolved.mimeType,
        resolved.size
      );
      try {
        return await publishVideoToPage(page, message, staged.url, conn);
      } finally {
        await cleanupTemp(userId, staged.storageKey);
      }
    }

    if (video.source === "UPLOAD" && video.storageKey) {
      // Trên Vercel không còn file trên đĩa: kiểm tra object còn tồn tại rồi
      // đưa Facebook một URL có chữ ký để Facebook tự tải video về.
      const size = await uploadSize(userId, video.storageKey);
      if (size === null) {
        throw new Error(
          "File video không còn trên máy chủ — hãy chọn lại video rồi đăng."
        );
      }
      const videoUrl = await signedReadUrl(userId, video.storageKey);
      return publishVideoToPage(page, message, videoUrl, conn);
    }

    if (/^https?:\/\//i.test(video.remoteUrl)) {
      return publishVideoToPage(page, message, video.remoteUrl, conn);
    }
    throw new Error("Video không hợp lệ — hãy chọn lại video.");
  }

  if (photos.length === 0) return publishTextToPage(page, message, conn);

  // ---------- ẢNH ----------
  const drivePhotos = photos.filter((p) => p.source === "DRIVE" && p.driveFileId);
  const urlPhotos = photos
    .filter((p) => !(p.source === "DRIVE" && p.driveFileId))
    .map((p) => p.remoteUrl);

  // Không có ảnh Drive → giữ nguyên đường cũ (nhanh nhất, Facebook tự tải).
  if (drivePhotos.length === 0) {
    return publishMultiPhotosToPage(page, message, urlPhotos, conn);
  }

  // Ảnh Drive phải đi qua binary vì link Drive riêng tư.
  /** Tải 1 ảnh Drive và upload unpublished, trả về photo id. */
  const uploadDrivePhoto = async (photo: DeliverMedia): Promise<string> => {
    const resolved = await resolveDriveFile(userId, photo.driveFileId!, {
      mimeType: photo.mimeType,
      sizeBytes: photo.sizeBytes,
      type: "IMAGE",
    });
    const binary = await driveBinary(
      resolved.connectionId,
      photo.driveFileId!,
      resolved.filename,
      resolved.mimeType,
      resolved.size
    );
    return publishPhotoBinaryToPage(page, binary, { published: false, conn });
  };

  // Trường hợp gọn nhất: cả bài chỉ có ảnh Drive.
  if (urlPhotos.length === 0) {
    try {
      // Một ảnh: đăng thẳng thành bài 1 ảnh kèm caption, đỡ một lượt gọi.
      if (photos.length === 1) {
        const resolved = await resolveDriveFile(userId, drivePhotos[0].driveFileId!, {
          mimeType: drivePhotos[0].mimeType,
          sizeBytes: drivePhotos[0].sizeBytes,
          type: "IMAGE",
        });
        const binary = await driveBinary(
          resolved.connectionId,
          drivePhotos[0].driveFileId!,
          resolved.filename,
          resolved.mimeType,
          resolved.size
        );
        return await publishPhotoBinaryToPage(page, binary, {
          caption: message,
          published: true,
          conn,
        });
      }

      const ids: string[] = [];
      for (const photo of drivePhotos) ids.push(await uploadDrivePhoto(photo));
      return await publishFeedWithPhotoIds(page, message, ids, conn);
    } catch (err) {
      throw new Error(deliverErrorMessage(err));
    }
  }

  // Bài TRỘN ảnh Drive + ảnh URL: phải đưa cả hai về photo id rồi ghép feed,
  // vì Facebook không cho trộn tham số `url` với attached_media.
  const photoIds: string[] = [];
  try {
    for (const photo of drivePhotos) photoIds.push(await uploadDrivePhoto(photo));
  } catch (err) {
    throw new Error(deliverErrorMessage(err));
  }

  for (const url of urlPhotos.slice(0, Math.max(4 - photoIds.length, 0))) {
    const id = await publishPhotoBinaryToPage(
      page,
      {
        data: await fetchAsBlob(url),
        filename: filenameFromUrl(url),
        mimeType: guessMime(url),
      },
      { published: false, conn }
    );
    photoIds.push(id);
  }

  return publishFeedWithPhotoIds(page, message, photoIds, conn);
}

// ---------- Tiện ích cho ảnh URL khi phải ghép chung với ảnh Drive ----------

async function fetchAsBlob(url: string): Promise<Blob> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Không tải được ảnh từ ${url} (HTTP ${res.status}).`);
  return res.blob();
}

function filenameFromUrl(url: string): string {
  const name = url.split("?")[0].split("/").pop() || "photo";
  return /\.(jpe?g|png|webp|gif)$/i.test(name) ? name : `${name}.jpg`;
}

function guessMime(url: string): string {
  if (/\.png$/i.test(url)) return "image/png";
  if (/\.webp$/i.test(url)) return "image/webp";
  if (/\.gif$/i.test(url)) return "image/gif";
  return "image/jpeg";
}

/** Đưa lỗi Drive về câu thông báo người dùng hiểu được. */
export function deliverErrorMessage(err: unknown): string {
  if (err instanceof DriveError) return driveErrorMessage(err);
  return err instanceof Error ? err.message : String(err);
}
