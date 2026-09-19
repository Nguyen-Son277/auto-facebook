// ============================================================
// Google Drive — phần THUẦN (không mạng, không database).
//
// Tách khỏi lib/drive.ts (vốn import prisma + server-only) để kiểm thử được
// độc lập: xem scripts/test-drive.mjs. Đúng cách autopilot-plan.ts và
// brand-scope.ts đã tách khỏi autopilot.ts / brand.ts.
//
// Nội dung: định dạng file Drive dùng được cho Facebook, và cách đọc
// metadata Drive trả về thành dữ liệu Media của app.
// ============================================================

/**
 * MIME ảnh nhận được.
 *
 * Mở rộng ngoài bộ cơ bản sau khi gặp ca "thư mục có ảnh nhưng app không thấy
 * ảnh nào": thư viện ảnh trên Drive có thể là BMP/TIFF (ảnh scan) hoặc
 * HEIC/AVIF (ảnh điện thoại). Chặn chúng ở đây chỉ khiến người dùng tưởng app
 * hỏng, nên cho đi qua — nếu Facebook từ chối thì lỗi sẽ hiện rõ lúc đăng.
 *
 * Lưu ý: HEIC/AVIF vẫn nên chuyển sang JPG cho chắc; Google Photos trả về
 * "image/heic" cho ảnh iPhone tuỳ cấu hình tải lên.
 */
export const IMAGE_MIMES = [
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/x-ms-bmp",
  "image/tiff",
  "image/heic",
  "image/heif",
  "image/avif",
] as const;

/** Danh sách MIME video Facebook nhận. */
export const VIDEO_MIMES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  // Định dạng cũ/điện thoại — Drive vẫn báo các MIME này; app nhận để người
  // dùng thấy tệp của mình thay vì một thư mục trống khó hiểu.
  "video/x-msvideo",
  "video/avi",
  "video/msvideo",
  "video/x-matroska",
  "video/mpeg",
  "video/3gpp",
] as const;

export function isImageMime(mime: string): boolean {
  return (IMAGE_MIMES as readonly string[]).includes(mime.toLowerCase());
}

export function isVideoMime(mime: string): boolean {
  return (VIDEO_MIMES as readonly string[]).includes(mime.toLowerCase());
}

/** Loại media suy ra từ MIME; null = không phải ảnh/video app dùng được. */
export function mediaKindFromMime(mime: string): "IMAGE" | "VIDEO" | null {
  if (isImageMime(mime)) return "IMAGE";
  if (isVideoMime(mime)) return "VIDEO";
  return null;
}

/** MIME có dùng được không (video bị loại khi thương hiệu tắt video). */
export function isSupportedMime(mime: string, allowVideo: boolean): boolean {
  if (isImageMime(mime)) return true;
  return allowVideo && isVideoMime(mime);
}

/** File gốc của Google (Docs/Sheets/Slides) — không tải được byte nên bỏ qua. */
export function isGoogleNative(mime: string): boolean {
  return mime.startsWith("application/vnd.google-apps");
}

/** Đuôi file suy từ MIME (dùng để đặt tên file khi gửi Facebook). */
export function extensionForMime(mime: string): string {
  switch (mime.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
    case "image/pjpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/bmp":
    case "image/x-ms-bmp":
      return ".bmp";
    case "image/tiff":
      return ".tiff";
    case "image/heic":
    case "image/heif":
      return ".heic";
    case "image/avif":
      return ".avif";
    case "video/quicktime":
    case "video/mov":
      return ".mov";
    case "video/webm":
      return ".webm";
    case "video/x-msvideo":
      return ".avi";
    case "video/x-matroska":
      return ".mkv";
    default:
      return ".mp4";
  }
}

/** Một file ảnh/video trên Drive, đã chuẩn hóa về kiểu app dùng. */
export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  width: number | null;
  height: number | null;
  /** Giây — Drive trả millisecond, đã quy đổi. */
  duration: number | null;
  /** Link ảnh thu nhỏ do Google phục vụ (cần cookie phiên nên chỉ dùng cho UI). */
  thumbnailLink: string | null;
  modifiedTime: string | null;
};

export type DriveFilePage = {
  files: DriveFile[];
  nextPageToken: string | null;
};

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Đọc một phần tử `files[]` của Drive API thành DriveFile.
 *
 * `size` là STRING trong JSON của Drive nên phải Number() trước khi so sánh
 * giới hạn dung lượng — đây là lỗi rất dễ mắc nếu đọc thẳng.
 */
export function mapDriveFile(raw: Record<string, unknown>): DriveFile {
  const image = (raw.imageMediaMetadata ?? {}) as Record<string, unknown>;
  const video = (raw.videoMediaMetadata ?? {}) as Record<string, unknown>;
  const durationMs = num(video.durationMillis);

  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? "Không tên"),
    mimeType: String(raw.mimeType ?? ""),
    size: num(raw.size),
    width: num(image.width),
    height: num(image.height),
    duration: durationMs && durationMs > 0 ? Math.round(durationMs / 1000) : null,
    thumbnailLink: typeof raw.thumbnailLink === "string" ? raw.thumbnailLink : null,
    modifiedTime: typeof raw.modifiedTime === "string" ? raw.modifiedTime : null,
  };
}

/** Duyệt `files[]` của Drive API thành danh sách DriveFile dùng được. */
export function mapDriveFiles(
  raw: unknown,
  allowVideo: boolean
): { files: DriveFile[]; nextPageToken: string | null } {
  const data = (raw ?? {}) as { files?: unknown; nextPageToken?: unknown };
  const list = Array.isArray(data.files) ? data.files : [];

  const files = list
    .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === "object")
    .map(mapDriveFile)
    .filter(
      (f) =>
        Boolean(f.id) &&
        !isGoogleNative(f.mimeType) &&
        isSupportedMime(f.mimeType, allowVideo)
    );

  return {
    files,
    nextPageToken: typeof data.nextPageToken === "string" ? data.nextPageToken : null,
  };
}

/**
 * Tên file an toàn để gửi lên Facebook.
 *
 * Tên trên Drive có thể chứa ký tự điều khiển, dấu ngoặc kép hay dài vô tận;
 * chuẩn hóa để header multipart không bị vỡ.
 */
export function safeFileName(name: string, mimeType: string): string {
  const base = (name || "drive-file")
    // bỏ đường dẫn nếu có, rồi bỏ mọi thứ không phải chữ/số/chấm/gạch
    .replace(/[\\/]+/g, "-")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);

  const ext = extensionForMime(mimeType);
  const trimmed = base || "drive-file";
  return trimmed.toLowerCase().endsWith(ext) ? trimmed : `${trimmed}${ext}`;
}
