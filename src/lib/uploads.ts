import "server-only";

import { createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// ============================================================
// Lưu trữ file upload cục bộ (video từ máy người dùng).
//
// File nằm trong uploads/<userId>/<key> — tách theo user nên không thể
// tham chiếu chéo file của nhau, và mọi thao tác đều phải truyền userId.
// ============================================================

// Thư mục gốc chứa video người dùng tải lên. Có thể đổi bằng biến môi trường
// UPLOAD_DIR (ví dụ trỏ ra ổ đĩa ngoài). Đây là dữ liệu người dùng nên KHÔNG
// nằm trong gói build — vì vậy đường dẫn được đánh dấu turbopackIgnore để
// Turbopack không truy vết cả project vào output.
const UPLOAD_ROOT =
  process.env.UPLOAD_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), "uploads");

/** Giới hạn dung lượng video (mặc định 200MB — Graph API chấp nhận tốt). */
export const MAX_VIDEO_BYTES = Number(process.env.MAX_VIDEO_BYTES ?? 200 * 1024 * 1024);

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

export function userUploadDir(userId: string): string {
  // userId là cuid nên an toàn, nhưng vẫn chặn ký tự đường dẫn cho chắc
  if (!/^[a-zA-Z0-9_-]+$/.test(userId)) {
    throw new Error("userId không hợp lệ để tạo thư mục upload.");
  }
  return path.join(/* turbopackIgnore: true */ UPLOAD_ROOT, userId);
}

/**
 * Trả về đường dẫn tuyệt đối của file upload, đã kiểm tra:
 * key đúng định dạng và đường dẫn cuối cùng vẫn nằm trong thư mục của user.
 */
export function resolveUploadPath(userId: string, storageKey: string): string {
  if (!isValidStorageKey(storageKey)) {
    throw new Error("Tên file không hợp lệ.");
  }
  const dir = userUploadDir(userId);
  const full = path.join(/* turbopackIgnore: true */ dir, storageKey);
  const normalized = path.normalize(full);
  if (!normalized.startsWith(dir + path.sep)) {
    throw new Error("Đường dẫn file không hợp lệ.");
  }
  return normalized;
}

export type UploadResult = {
  ok: boolean;
  storageKey?: string;
  size?: number;
  mimeType?: string;
  error?: string;
};

/** Lưu file upload xuống đĩa (stream, không nạp cả file vào RAM). */
export async function saveUpload(userId: string, file: File): Promise<UploadResult> {
  const mime = (file.type || "").toLowerCase();
  const extFromName = path.extname(file.name).toLowerCase();

  const guessedExt =
    ALLOWED_VIDEO_TYPES[mime] ??
    (ALLOWED_VIDEO_EXTENSIONS.includes(extFromName) ? extFromName : "");

  if (!guessedExt) {
    return {
      ok: false,
      error:
        `Định dạng không được hỗ trợ${file.type ? ` (${file.type})` : ""}. ` +
        `Chỉ nhận video: ${ALLOWED_VIDEO_EXTENSIONS.join(", ")}.`,
    };
  }

  if (file.size === 0) {
    return { ok: false, error: "File rỗng — chọn lại file khác." };
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return {
      ok: false,
      error: `File ${(file.size / 1024 / 1024).toFixed(1)}MB vượt giới hạn ${Math.round(
        MAX_VIDEO_BYTES / 1024 / 1024
      )}MB.`,
    };
  }

  const storageKey = `${randomBytes(12).toString("hex")}${guessedExt}`;
  const dir = userUploadDir(userId);
  await mkdir(dir, { recursive: true });

  const target = path.join(/* turbopackIgnore: true */ dir, storageKey);

  try {
    // file.stream() là ReadableStream (Web) → chuyển sang stream của Node để ghi
    await pipeline(Readable.fromWeb(file.stream() as never), createWriteStream(target));
  } catch (err) {
    await rm(target, { force: true });
    return {
      ok: false,
      error: `Không ghi được file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { ok: true, storageKey, size: file.size, mimeType: mime || "video/mp4" };
}

/** Danh sách file upload của user (chỉ tên file hợp lệ). */
export async function listUploads(userId: string): Promise<string[]> {
  try {
    const entries = await readdir(userUploadDir(userId));
    return entries.filter((e) => isValidStorageKey(e));
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
 * dùng tải video lên rồi bỏ đi, file sẽ nằm lại đĩa. Hàm này xóa những file
 * như vậy, nhưng chỉ khi đã cũ hơn 24 giờ để không đụng vào file đang soạn.
 *
 * @param referenced Tập storageKey đang được bản ghi Media tham chiếu.
 */
export async function pruneOrphanUploads(
  userId: string,
  referenced: Set<string>
): Promise<string[]> {
  const removed: string[] = [];
  const now = Date.now();

  for (const key of await listUploads(userId)) {
    if (referenced.has(key)) continue;
    const full = path.join(/* turbopackIgnore: true */ userUploadDir(userId), key);
    try {
      const s = await stat(full);
      if (now - s.mtimeMs < ORPHAN_MIN_AGE_MS) continue;
      await rm(full, { force: true });
      removed.push(key);
    } catch {
      // Bỏ qua file đã bị xóa
    }
  }

  return removed;
}

/** Xóa file upload (bỏ qua nếu không tồn tại). */
export async function deleteUpload(userId: string, storageKey: string): Promise<void> {
  try {
    await rm(resolveUploadPath(userId, storageKey), { force: true });
  } catch {
    // Không quan trọng nếu file đã bị xóa trước đó
  }
}

/** Kích thước file trên đĩa, hoặc null nếu không tồn tại. */
export async function uploadSize(userId: string, storageKey: string): Promise<number | null> {
  try {
    const s = await stat(resolveUploadPath(userId, storageKey));
    return s.size;
  } catch {
    return null;
  }
}
