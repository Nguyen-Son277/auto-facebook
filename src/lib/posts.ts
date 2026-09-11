// Helper thuần (pure) dùng chung cho server action và UI.
// Không đặt trong file "use server" vì file đó chỉ được export async function.

/** Một media được chọn để đính kèm vào bài đăng (ảnh hoặc video). */
export type AttachedMedia = {
  remoteUrl: string;
  previewUrl?: string;
  type: "IMAGE" | "VIDEO";
  source: "PEXELS" | "URL" | "UPLOAD";
  /** Chỉ có với source "UPLOAD": tên file trong uploads/<userId>/. */
  storageKey?: string;
  mimeType?: string;
  sizeBytes?: number;
  /** ID trên Pexels (dùng để chống trùng trong thư viện). */
  providerId?: string;
  photographer?: string;
  photographerUrl?: string;
  sourcePageUrl?: string;
  alt?: string;
  width?: number;
  height?: number;
  duration?: number;
};

export const MAX_PHOTOS_PER_POST = 4;

/** Tách các dòng URL ảnh hợp lệ từ textarea (mỗi dòng 1 URL). */
export function parseImageUrls(raw: string): string[] {
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Đọc danh sách media đính kèm từ hidden input (JSON do Media Picker ghi ra).
 * Bỏ qua mọi phần tử không hợp lệ thay vì báo lỗi — tránh vỡ form vì dữ liệu lạ.
 */
export function parseAttachments(raw: string | null | undefined): AttachedMedia[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const list: AttachedMedia[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const remoteUrl = str(obj.remoteUrl);
    // Cho phép URL công khai hoặc đường dẫn nội bộ /api/uploads/<key>
    const isRemote = remoteUrl ? /^https?:\/\//i.test(remoteUrl) : false;
    const isLocalUpload = remoteUrl ? /^\/api\/uploads\/[a-f0-9]{24}\.[a-z0-9]+$/i.test(remoteUrl) : false;
    if (!remoteUrl || (!isRemote && !isLocalUpload)) continue;

    const type = obj.type === "VIDEO" ? "VIDEO" : "IMAGE";
    const source =
      obj.source === "PEXELS" ? "PEXELS" : obj.source === "UPLOAD" ? "UPLOAD" : "URL";

    // File upload phải có storageKey khớp với remoteUrl, nếu không thì bỏ
    const storageKey = str(obj.storageKey);
    if (source === "UPLOAD") {
      if (!storageKey || !isLocalUpload || !remoteUrl.endsWith(storageKey)) continue;
    }

    list.push({
      remoteUrl,
      previewUrl: str(obj.previewUrl),
      type,
      source,
      storageKey,
      mimeType: str(obj.mimeType),
      sizeBytes: num(obj.sizeBytes),
      providerId: str(obj.providerId),
      photographer: str(obj.photographer),
      photographerUrl: str(obj.photographerUrl),
      sourcePageUrl: str(obj.sourcePageUrl),
      alt: str(obj.alt),
      width: num(obj.width),
      height: num(obj.height),
      duration: num(obj.duration),
    });
  }

  // Chống trùng URL
  const seen = new Set<string>();
  return list.filter((m) => {
    if (seen.has(m.remoteUrl)) return false;
    seen.add(m.remoteUrl);
    return true;
  });
}

export type AttachmentCheck = { ok: true } | { ok: false; error: string };

/**
 * Kiểm tra ràng buộc đính kèm của Facebook:
 * không cho trộn ảnh với video, tối đa 4 ảnh, tối đa 1 video.
 */
export function validateAttachments(media: AttachedMedia[]): AttachmentCheck {
  const photos = media.filter((m) => m.type === "IMAGE");
  const videos = media.filter((m) => m.type === "VIDEO");

  if (photos.length > 0 && videos.length > 0) {
    return {
      ok: false,
      error:
        "Facebook không cho phép đăng chung ảnh và video trong một bài — hãy bỏ bớt một loại.",
    };
  }
  if (photos.length > MAX_PHOTOS_PER_POST) {
    return {
      ok: false,
      error: `Tối đa ${MAX_PHOTOS_PER_POST} ảnh mỗi bài (bạn đang chọn ${photos.length}).`,
    };
  }
  if (videos.length > 1) {
    return { ok: false, error: "Mỗi bài chỉ đăng được 1 video." };
  }
  return { ok: true };
}

export const POST_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "Nháp", cls: "bg-gray-100 text-gray-600" },
  PENDING_REVIEW: { label: "Chờ duyệt", cls: "bg-purple-100 text-purple-700" },
  SCHEDULED: { label: "Đã lên lịch", cls: "bg-amber-100 text-amber-700" },
  PUBLISHING: { label: "Đang đăng", cls: "bg-blue-100 text-blue-700" },
  PUBLISHED: { label: "Đã đăng", cls: "bg-emerald-100 text-emerald-700" },
  FAILED: { label: "Lỗi", cls: "bg-red-100 text-red-700" },
};

export function statusBadgeOf(status: string) {
  return POST_STATUS_BADGE[status] ?? POST_STATUS_BADGE.DRAFT;
}

/** Đếm ký tự để hiển thị gợi ý độ dài bài đăng. */
export function countChars(text: string): number {
  return text.trim().length;
}

// ============================================================
// Chấm điểm dễ đọc trên Facebook
//
// Vấn đề thực tế: AI hay viết một khối văn xuôi dài, đọc trên điện thoại
// thành "bức tường chữ" và người xem lướt qua luôn. Các quy tắc dưới đây
// rút ra từ cách Facebook hiển thị bài:
//   - Chỉ ~2 dòng đầu hiện trước nút "Xem thêm" → câu đầu phải là ý chính.
//   - Màn hình điện thoại ~40 ký tự/dòng → đoạn 300 ký tự thành 7-8 dòng liền.
//   - Danh sách có xuống dòng dễ đọc hơn liệt kê trong một câu dài.
//
// Hàm thuần, không phụ thuộc gì — kiểm thử độc lập được.
// ============================================================

/** Câu đầu dài hơn ngần này thì không còn là "ý chính" gọn gàng nữa. */
export const MAX_HOOK_CHARS = 90;
/** Một đoạn dài hơn ngần này sẽ thành bức tường chữ trên điện thoại. */
export const MAX_PARAGRAPH_CHARS = 280;
/** Facebook cắt bớt bài rất dài; quá ngưỡng này nên cân nhắc rút gọn. */
export const LONG_POST_CHARS = 1500;

export type ReadabilityIssue = {
  /** Mã để test kiểm tra ổn định, không phụ thuộc câu chữ tiếng Việt. */
  code:
    | "HOOK_TOO_LONG"
    | "NO_LINE_BREAK"
    | "PARAGRAPH_TOO_LONG"
    | "TOO_LONG"
    | "NO_CTA";
  message: string;
};

export type ReadabilityReport = {
  /** Câu/dòng đầu tiên — thứ người đọc thấy trước khi bấm "Xem thêm". */
  hook: string;
  chars: number;
  paragraphs: number;
  issues: ReadabilityIssue[];
  /** true khi không có vấn đề nào. */
  ok: boolean;
};

/**
 * Kiểm tra bài viết có dễ đọc trên Facebook không.
 *
 * Trả về danh sách vấn đề cụ thể thay vì một điểm số mơ hồ, để người dùng
 * biết chính xác cần sửa gì.
 */
export function analyzeReadability(content: string): ReadabilityReport {
  const text = (content ?? "").trim();
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const firstLine = text.split("\n")[0]?.trim() ?? "";
  const issues: ReadabilityIssue[] = [];

  if (!text) {
    return { hook: "", chars: 0, paragraphs: 0, issues: [], ok: true };
  }

  if (firstLine.length > MAX_HOOK_CHARS) {
    issues.push({
      code: "HOOK_TOO_LONG",
      message: `Câu đầu dài ${firstLine.length} ký tự — Facebook chỉ hiện ~2 dòng đầu. Nên rút còn dưới ${MAX_HOOK_CHARS} ký tự và tách thành dòng riêng.`,
    });
  }

  if (!text.includes("\n") && text.length > MAX_PARAGRAPH_CHARS) {
    issues.push({
      code: "NO_LINE_BREAK",
      message:
        "Cả bài là một khối chữ liền — trên điện thoại sẽ thành bức tường chữ. Hãy tách đoạn bằng dòng trống.",
    });
  }

  const longOnes = paragraphs.filter((p) => p.length > MAX_PARAGRAPH_CHARS);
  if (longOnes.length > 0) {
    issues.push({
      code: "PARAGRAPH_TOO_LONG",
      message: `Có ${longOnes.length} đoạn dài quá ${MAX_PARAGRAPH_CHARS} ký tự. Nên tách nhỏ hoặc chuyển thành gạch đầu dòng.`,
    });
  }

  if (text.length > LONG_POST_CHARS) {
    issues.push({
      code: "TOO_LONG",
      message: `Bài dài ${text.length} ký tự — Facebook sẽ cắt bớt. Cân nhắc rút gọn dưới ${LONG_POST_CHARS}.`,
    });
  }

  // CTA thường nằm ở cuối và có dấu hiệu kêu gọi hoặc liên hệ
  const tail = text.slice(-220).toLowerCase();
  const hasCta =
    /inbox|nhắn tin|liên hệ|gọi ngay|đặt hàng|ghé|xem thêm|đăng ký|tư vấn|báo giá|comment|bình luận|để lại|\d{9,11}|http/.test(
      tail
    );
  if (!hasCta) {
    issues.push({
      code: "NO_CTA",
      message:
        "Cuối bài chưa có lời kêu gọi hành động (inbox, gọi, để lại bình luận…). Người đọc sẽ không biết làm gì tiếp.",
    });
  }

  return {
    hook: firstLine,
    chars: text.length,
    paragraphs: paragraphs.length,
    issues,
    ok: issues.length === 0,
  };
}
