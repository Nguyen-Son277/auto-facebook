// ============================================================
// NGUỒN MEDIA — logic THUẦN, kiểm thử được độc lập.
//
// Ba nguồn ảnh/video, người dùng chọn tự do và có thể KẾT HỢP:
//   PEXELS — kho ảnh/video miễn phí bản quyền (hạn mức 200 request/giờ/key)
//   DRIVE  — thư mục Google Drive riêng của thương hiệu (dung lượng của user)
//   UPLOAD — tệp người dùng tải từ máy lên (Supabase Storage, 1 GB gói Free)
//
// Ở chế độ tự động (AutoPilot), người dùng chọn nguồn CHÍNH và có bật dự
// phòng sang nguồn còn lại hay không. File này quyết định thứ tự thử nguồn;
// KHÔNG gọi mạng, KHÔNG đụng database — nhờ vậy test được mọi tổ hợp mà
// không cần Drive/Pexels thật (xem scripts/test-media-source.mjs).
//
// Tách khỏi lib/autopilot.ts (vốn import prisma + "server-only") theo đúng
// cách autopilot-plan.ts và brand-scope.ts đã tách logic thuần.
// ============================================================

export type MediaSource = "DRIVE" | "PEXELS" | "UPLOAD";

/** Ba nguồn theo đúng thứ tự hiển thị trên giao diện. */
export const MEDIA_SOURCES: MediaSource[] = ["DRIVE", "PEXELS", "UPLOAD"];

/** Tên gọi ngắn để hiện trên nhãn thumbnail và thông báo. */
export const MEDIA_SOURCE_LABEL: Record<MediaSource, string> = {
  DRIVE: "Drive cá nhân",
  PEXELS: "Pexels",
  UPLOAD: "Tải từ máy",
};

/**
 * Nguồn chính dùng được ở chế độ tự động.
 *
 * UPLOAD bị loại vì tiến trình chạy nền không có trình duyệt: không có tệp
 * nào để "tải từ máy" vào lúc hệ thống tự tạo bài. UPLOAD vẫn dùng được khi
 * soạn bài thủ công (composer).
 */
export const AUTOPILOT_SOURCES: MediaSource[] = ["DRIVE", "PEXELS"];

export function isAutopilotSource(value: string): value is "DRIVE" | "PEXELS" {
  return value === "DRIVE" || value === "PEXELS";
}

/** Tình trạng kết nối Drive của người dùng + thư mục đã gắn cho thương hiệu. */
export type DriveAvailability = {
  /** Thư mục Drive đã gắn cho Brand chưa (null = chưa gắn). */
  folderId: string | null;
  /** ACTIVE | NEEDS_REAUTH | DISABLED; null = chưa kết nối Drive. */
  connectionStatus: string | null;
} | null;

export type MediaCandidatesInput = {
  /** Người dùng có bật "tự tìm ảnh/video" không. */
  autoMedia: boolean;
  /** Nguồn chính người dùng chọn: PEXELS | DRIVE. */
  mediaPrimary: string;
  /** Có được lấy tiếp từ nguồn còn lại khi nguồn chính hết/lỗi không. */
  mediaFallback: boolean;
  /** Trạng thái Drive của Brand. */
  drive: DriveAvailability;
  /** Người dùng sở hữu bài đã có Pexels API key chưa. */
  pexelsReady: boolean;
  /**
   * Số ảnh/video Drive đã GHI NHỚ trong thư viện (đã được Picker cấp quyền).
   *
   * VÌ SAO ĐÂY MỚI LÀ ĐIỀU KIỆN QUYẾT ĐỊNH: scope `drive.file` cấp quyền theo
   * TỪNG tài nguyên người dùng chọn. Thực tế: gắn được thư mục (đọc được tên)
   * nhưng `files.list` bên trong trả RỖNG, không kèm lỗi. Nên nguồn Drive dùng
   * được khi có tệp đã chọn — KHÔNG phụ thuộc việc gắn thư mục.
   */
  driveFileCount: number;
};

/** Vì sao một nguồn không dùng được — dùng để viết thông báo cho người dùng. */
export type SourceBlocker =
  | "AUTO_MEDIA_OFF"
  | "DRIVE_NOT_CONNECTED"
  | "DRIVE_NO_FOLDER"
  | "DRIVE_NO_FILES"
  | "DRIVE_NEEDS_REAUTH"
  | "DRIVE_DISABLED"
  | "PEXELS_NO_KEY";

/**
 * Lý do một nguồn không khả dụng, hoặc null nếu dùng được.
 *
 * Tách riêng để thông báo cho người dùng nói đúng việc cần làm
 * ("vào Cài đặt cấp quyền lại") thay vì câu chung chung.
 */
export function sourceBlocker(
  source: "DRIVE" | "PEXELS",
  input: Pick<MediaCandidatesInput, "drive" | "pexelsReady" | "driveFileCount">
): SourceBlocker | null {
  if (source === "PEXELS") {
    return input.pexelsReady ? null : "PEXELS_NO_KEY";
  }

  const drive = input.drive;
  if (!drive || !drive.connectionStatus) return "DRIVE_NOT_CONNECTED";
  if (drive.connectionStatus === "NEEDS_REAUTH") return "DRIVE_NEEDS_REAUTH";
  if (drive.connectionStatus === "DISABLED") return "DRIVE_DISABLED";

  // Thư mục KHÔNG còn là điều kiện bắt buộc: nguồn Drive chạy được bằng "kho
  // ảnh đã chọn qua Picker" (driveFileCount > 0). Đây là hệ quả của việc
  // `drive.file` không cho app đọc nội dung thư mục một cách đáng tin.
  if ((input.driveFileCount ?? 0) <= 0) return "DRIVE_NO_FILES";
  return null;
}

/** Câu giải thích tương ứng với từng blocker. */
export function blockerMessage(blocker: SourceBlocker): string {
  switch (blocker) {
    case "AUTO_MEDIA_OFF":
      return "Bài chỉ có chữ vì bạn đã tắt tự tìm ảnh/video.";
    case "DRIVE_NOT_CONNECTED":
      return "Chưa kết nối Google Drive — vào Cài đặt để kết nối.";
    case "DRIVE_NO_FOLDER":
      return "Thương hiệu chưa gắn thư mục Drive — vào trang Thương hiệu để chọn thư mục.";
    case "DRIVE_NO_FILES":
      return "Chưa có ảnh/video Drive nào được chọn. Vào trang Thương hiệu → “📷 Chọn ảnh/video từ Drive” để chọn ảnh (giữ Ctrl/Cmd để chọn nhiều).";
    case "DRIVE_NEEDS_REAUTH":
      return "Kết nối Google Drive cần cấp quyền lại — vào Cài đặt rồi bấm “Cấp quyền lại”.";
    case "DRIVE_DISABLED":
      return "Kết nối Google Drive đang bị tắt — vào Cài đặt để bật lại.";
    case "PEXELS_NO_KEY":
      return "Chưa nhập Pexels API Key — vào Cài đặt nếu muốn dùng kho ảnh Pexels.";
  }
}

/**
 * Thứ tự các nguồn sẽ thử cho một bài tự động.
 *
 * Quy tắc:
 *  - `autoMedia = false` → mảng rỗng (bài chỉ có chữ, giữ nguyên hành vi cũ).
 *  - Nguồn chính không khả dụng → loại khỏi danh sách, KHÔNG báo lỗi cứng;
 *    nếu `mediaFallback` bật thì nguồn còn lại vẫn được thử.
 *  - `mediaFallback = false` → chỉ đúng nguồn chính; thiếu ảnh thì chấp nhận
 *    bài không ảnh (planner sẽ ghi cảnh báo).
 *  - Trả về mảng rỗng khi không nguồn nào chạy được.
 */
export function mediaCandidates(input: MediaCandidatesInput): MediaSource[] {
  if (!input.autoMedia) return [];

  const primary: "DRIVE" | "PEXELS" = input.mediaPrimary === "DRIVE" ? "DRIVE" : "PEXELS";
  const secondary: "DRIVE" | "PEXELS" = primary === "DRIVE" ? "PEXELS" : "DRIVE";

  const usable = (source: "DRIVE" | "PEXELS") => sourceBlocker(source, input) === null;

  const out: MediaSource[] = [];
  if (usable(primary)) out.push(primary);
  if (input.mediaFallback && usable(secondary)) out.push(secondary);

  return out;
}

/**
 * Lý do ĐẦU TIÊN giải thích vì sao không lấy được ảnh nào — dùng khi
 * `mediaCandidates` trả về mảng rỗng, để cảnh báo chỉ đúng việc cần làm.
 */
export function noSourceReason(input: MediaCandidatesInput): string {
  if (!input.autoMedia) return blockerMessage("AUTO_MEDIA_OFF");

  const primary: "DRIVE" | "PEXELS" = input.mediaPrimary === "DRIVE" ? "DRIVE" : "PEXELS";
  const secondary: "DRIVE" | "PEXELS" = primary === "DRIVE" ? "PEXELS" : "DRIVE";

  const primaryBlocker = sourceBlocker(primary, input);
  if (primaryBlocker) return blockerMessage(primaryBlocker);

  // Nguồn chính dùng được nhưng không được chọn ⇒ chỉ có thể do tắt dự phòng
  if (!input.mediaFallback) {
    return `Không lấy được ảnh từ ${MEDIA_SOURCE_LABEL[primary]} và bạn đã tắt nguồn dự phòng — bài sẽ đăng dạng chỉ có chữ.`;
  }

  const secondaryBlocker = sourceBlocker(secondary, input);
  if (secondaryBlocker) return blockerMessage(secondaryBlocker);

  return "Không có nguồn ảnh/video nào khả dụng — bài sẽ đăng dạng chỉ có chữ.";
}

/**
 * Cảnh báo khi đã lấy được ảnh nhưng phải rơi sang nguồn dự phòng.
 * Trả về null khi bài dùng đúng nguồn chính (không cần báo gì).
 */
export function fallbackNotice(
  used: MediaSource,
  primary: string
): string | null {
  const wanted = primary === "DRIVE" ? "DRIVE" : "PEXELS";
  if (used === wanted) return null;
  return `Không lấy được ảnh từ ${MEDIA_SOURCE_LABEL[wanted as MediaSource]} nên bài dùng ${MEDIA_SOURCE_LABEL[used]} thay thế.`;
}
