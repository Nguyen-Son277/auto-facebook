import "server-only";

import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  createSignedReadUrl,
  createSignedUploadUrl,
  isStorageConfigured,
  listObjects,
  objectSize,
  removeObject,
} from "@/lib/storage";

// ============================================================
// Video người dùng tải lên — lưu trên Supabase Storage.
//
// Luồng: trình duyệt xin signed upload URL từ /api/uploads rồi PUT file
// TRỰC TIẾP lên Storage (không đi qua Vercel Function, vì body bị giới hạn
// 4.5MB). Server chỉ giữ storageKey trong DB.
//
// Mọi object nằm ở <userId>/<storageKey> nên tách biệt theo user.
// ============================================================

/**
 * Giới hạn dung lượng video.
 *
 * Mặc định 50MB vì Supabase Free chặn file lớn hơn 50MB. Nếu nâng lên gói
 * Pro (giới hạn 500GB) thì đặt MAX_VIDEO_BYTES lớn hơn qua biến môi trường.
 */
export const MAX_VIDEO_BYTES = Number(process.env.MAX_VIDEO_BYTES ?? 50 * 1024 * 1024);

/** Định dạng video được chấp nhận (Facebook hỗ trợ). */
export const ALLOWED_VIDEO_TYPES: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "video/x-msvideo": ".avi",
  "video/x-matroska": ".mkv",
};

export const ALLOWED_VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".avi", ".mkv"];

/** Chỉ cho phép tên file do chính app sinh ra: <hex>.<ext> */
const KEY_PATTERN = /^[a-f0-9]{24}\.(mp4|mov|webm|avi|mkv)$/;

export function isValidStorageKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

export type UploadTargetResult = {
  ok: boolean;
  storageKey?: string;
  /** URL tuyệt đối để trình duyệt PUT file lên Storage. */
  uploadUrl?: string;
  size?: number;
  mimeType?: string;
  error?: string;
};

/**
 * Kiểm tra định dạng + dung lượng rồi cấp signed upload URL cho trình duyệt.
 *
 * Không nhận nội dung file ở đây — file đi thẳng từ browser lên Storage.
 */
export async function createUploadTarget(
  userId: string,
  fileName: string,
  mimeTypeRaw: string,
  size: number
): Promise<UploadTargetResult> {
  if (!isStorageConfigured()) {
    return {
      ok: false,
      error:
        "Máy chủ chưa cấu hình lưu trữ video (Supabase Storage). " +
        "Liên hệ quản trị viên để bổ sung SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY.",
    };
  }

  const mime = (mimeTypeRaw || "").toLowerCase();
  const extFromName = path.extname(fileName || "").toLowerCase();

  const guessedExt =
    ALLOWED_VIDEO_TYPES[mime] ??
    (ALLOWED_VIDEO_EXTENSIONS.includes(extFromName) ? extFromName : "");

  if (!guessedExt) {
    return {
      ok: false,
      error:
        `Định dạng không được hỗ trợ${mimeTypeRaw ? ` (${mimeTypeRaw})` : ""}. ` +
        `Chỉ nhận video: ${ALLOWED_VIDEO_EXTENSIONS.join(", ")}.`,
    };
  }

  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: "File rỗng — chọn lại file khác." };
  }
  if (size > MAX_VIDEO_BYTES) {
    return {
      ok: false,
      error: `File ${(size / 1024 / 1024).toFixed(1)}MB vượt giới hạn ${Math.round(
        MAX_VIDEO_BYTES / 1024 / 1024
      )}MB.`,
    };
  }

  const storageKey = `${randomBytes(12).toString("hex")}${guessedExt}`;

  try {
    const uploadUrl = await createSignedUploadUrl(userId, storageKey);
    return { ok: true, storageKey, uploadUrl, size, mimeType: mime || "video/mp4" };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** URL có chữ ký để xem trước / cho Facebook tải video. */
export async function signedReadUrl(
  userId: string,
  storageKey: string,
  ttlSeconds?: number
): Promise<string> {
  if (!isValidStorageKey(storageKey)) {
    throw new Error("Tên file không hợp lệ.");
  }
  return createSignedReadUrl(userId, storageKey, ttlSeconds);
}

/** Danh sách file upload của user (chỉ tên file hợp lệ). */
export async function listUploads(userId: string): Promise<string[]> {
  try {
    const objects = await listObjects(userId);
    return objects.map((o) => o.name).filter((name) => isValidStorageKey(name));
  } catch {
    return [];
  }
}

/** Thời gian tối thiểu trước khi coi một file là "mồ côi" (tránh xóa nhầm file đang soạn). */
const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Dọn file upload không còn bản ghi Media nào tham chiếu.
 *
 * File upload chỉ được ghi vào DB khi bài được lưu nháp hoặc đăng; nếu người
 * dùng tải video lên rồi bỏ đi, file sẽ nằm lại Storage. Hàm này xóa những
 * file như vậy, nhưng chỉ khi đã cũ hơn 24 giờ để không đụng vào file đang soạn.
 *
 * @param referenced Tập storageKey đang được bản ghi Media tham chiếu.
 */
export async function pruneOrphanUploads(
  userId: string,
  referenced: Set<string>
): Promise<string[]> {
  if (!isStorageConfigured()) return [];

  const removed: string[] = [];
  const now = Date.now();

  let objects: Awaited<ReturnType<typeof listObjects>>;
  try {
    objects = await listObjects(userId);
  } catch {
    return [];
  }

  for (const obj of objects) {
    if (!isValidStorageKey(obj.name)) continue;
    if (referenced.has(obj.name)) continue;

    const updated = obj.updatedAt ? Date.parse(obj.updatedAt) : NaN;
    if (Number.isFinite(updated) && now - updated < ORPHAN_MIN_AGE_MS) continue;

    try {
      await removeObject(userId, obj.name);
      removed.push(obj.name);
    } catch {
      // Bỏ qua file đã bị xóa hoặc lỗi tạm thời
    }
  }

  return removed;
}

/** Xóa file upload (bỏ qua nếu không tồn tại / chưa cấu hình). */
export async function deleteUpload(userId: string, storageKey: string): Promise<void> {
  if (!isValidStorageKey(storageKey)) return;
  try {
    await removeObject(userId, storageKey);
  } catch {
    // Không quan trọng nếu file đã bị xóa trước đó
  }
}

/** Kích thước file trên Storage, hoặc null nếu không tồn tại. */
export async function uploadSize(
  userId: string,
  storageKey: string
): Promise<number | null> {
  if (!isValidStorageKey(storageKey)) return null;
  try {
    return await objectSize(userId, storageKey);
  } catch {
    return null;
  }
}
