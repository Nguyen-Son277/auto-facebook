import "server-only";

import {
  publishMultiPhotosToPage,
  publishTextToPage,
  publishVideoToPage,
  type GraphContext,
} from "@/lib/facebook";
import { signedReadUrl, uploadSize } from "@/lib/uploads";

// ============================================================
// Gửi nội dung + media lên Facebook.
//
// Tách riêng khỏi actions/publish.ts để CẢ hai đường dùng chung một logic:
// - Người dùng bấm "Đăng ngay" (actions/publish.ts)
// - Worker tự động đăng theo lịch (lib/scheduler.ts)
// Nhờ vậy quy tắc chọn endpoint chỉ tồn tại ở một nơi.
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
  mimeType?: string | null;
};

/** Ghép nội dung + hashtag thành message gửi Facebook. */
export function buildMessage(content: string, hashtags?: string | null): string {
  const tags = hashtags?.trim() ?? "";
  return tags ? `${content}\n\n${tags}` : content;
}

/**
 * Gửi nội dung + media lên Facebook, chọn đúng endpoint:
 * - Có video (file upload)   → POST /videos với file_url = signed URL của Storage
 * - Có video (URL công khai) → POST /videos với file_url
 * - Có ảnh                   → /photos hoặc /photos unpublished + /feed
 * - Không có media           → /feed
 */
export async function deliverToFacebook(
  userId: string,
  page: DeliverPage,
  message: string,
  media: DeliverMedia[],
  conn?: GraphContext | null
): Promise<string> {
  const video = media.find((m) => m.type === "VIDEO");
  const photos = media.filter((m) => m.type === "IMAGE").map((m) => m.remoteUrl);

  if (video) {
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
  return publishMultiPhotosToPage(page, message, photos, conn);
}
