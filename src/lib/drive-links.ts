// ============================================================
// Đọc ID thư mục Google Drive từ LINK do người dùng dán.
//
// VÌ SAO CẦN
// Google Picker là cách chuẩn để cấp quyền `drive.file` cho một thư mục, nhưng
// nó phụ thuộc script apis.google.com + Picker API — có môi trường/mạng chặn
// mất. Khi đó người dùng dán thẳng link thư mục là lối tắt duy nhất.
//
// GIỚI HẠN PHẢI NHỚ: dán link KHÔNG tự cấp quyền cho app. App chỉ đọc được
// thư mục nếu Google cho phép (ví dụ thư mục để chế độ "Bất kỳ ai có link").
// Vì vậy hàm này chỉ TRÍCH ID; việc kiểm tra quyền thật do
// `ensureFolderAccess()` trong lib/drive.ts làm, và lỗi sẽ được báo nguyên văn.
//
// Phần này THUẦN (không mạng, không DB) nên test được độc lập:
// xem scripts/test-drive.mjs.
// ============================================================

/** Chuỗi ID của Google Drive: chữ, số, `-`, `_`; thường dài 20–60 ký tự. */
const ID_PATTERN = /^[a-zA-Z0-9_-]{10,120}$/;

/** Các dạng link thư mục Google Drive hay gặp. */
const FOLDER_PATTERNS: RegExp[] = [
  // https://drive.google.com/drive/folders/<ID>
  // https://drive.google.com/drive/u/0/folders/<ID>
  // https://drive.google.com/drive/mobile/folders/<ID>
  /drive\.google\.com\/(?:drive\/)?(?:u\/\d+\/)?(?:mobile\/)?folders\/([a-zA-Z0-9_-]+)/i,
  // https://drive.google.com/open?id=<ID>&...
  /drive\.google\.com\/open\?(?:[^#]*&)?id=([a-zA-Z0-9_-]+)/i,
  // https://drive.google.com/file/d/<ID>/view  (dán nhầm file — báo rõ để người dùng biết)
  /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i,
  // Shared drive: https://drive.google.com/drive/u/0/shared-drives?...
  /drive\.google\.com\/.*[?&]id=([a-zA-Z0-9_-]+)/i,
];

/** Link rút gọn — không thể trích ID nếu không gọi mạng. */
const SHORT_LINK = /(?:drive\.google\.com\/[a-z]+\/|\bdocs\.google\.com\/)/i;

export type ParsedDriveLink =
  | { ok: true; folderId: string; kind: "folder" }
  | { ok: true; driveFileId: string; kind: "file" }
  | { ok: false; error: string };

/**
 * Trích ID thư mục từ link (hoặc từ ID dán trực tiếp).
 *
 * Trả về `kind: "file"` khi link trỏ tới TỆP — người dùng cần biết họ phải chọn
 * thư mục, chứ không phải một tấm ảnh.
 */
export function parseDriveFolderLink(raw: string): ParsedDriveLink {
  const input = (raw ?? "").trim();
  if (!input) {
    return { ok: false, error: "Chưa dán link thư mục Google Drive." };
  }

  // Trường hợp dán thẳng ID (không phải URL)
  if (!input.includes("/") && !input.includes(" ")) {
    if (ID_PATTERN.test(input)) return { ok: true, folderId: input, kind: "folder" };
    return {
      ok: false,
      error:
        "Chuỗi này không giống ID hay link Drive. Hãy mở thư mục trên Drive rồi dán link đầy đủ.",
    };
  }

  if (SHORT_LINK.test(input) && !/\/folders\/|\/d\/|[?&]id=/.test(input)) {
    return {
      ok: false,
      error:
        "Link rút gọn (docs.google.com/… hoặc /drive/a/…) không chứa ID thư mục. Mở thư mục trên Drive rồi copy link trên thanh địa chỉ.",
    };
  }

  for (const pattern of FOLDER_PATTERNS) {
    const match = pattern.exec(input);
    if (!match?.[1]) continue;

    const isFileLink = /\/file\/d\//i.test(input);
    if (isFileLink) {
      return {
        ok: false,
        error:
          "Link này trỏ tới một TỆP, không phải thư mục. Mở thư mục chứa ảnh rồi copy link của thư mục đó.",
      };
    }

    return { ok: true, folderId: match[1], kind: "folder" };
  }

  if (!/drive\.google\.com/i.test(input)) {
    return {
      ok: false,
      error: "Link không phải của Google Drive. Cần link dạng https://drive.google.com/drive/folders/…",
    };
  }

  return {
    ok: false,
    error:
      "Không tìm thấy ID thư mục trong link. Cần link dạng https://drive.google.com/drive/folders/<ID>.",
  };
}

export type ParsedDriveFileLink =
  | { ok: true; driveFileId: string }
  | { ok: false; error: string };

/** Trích ID TỆP từ link (dùng cho ô dán ảnh lẻ trong trình soạn bài). */
export function parseDriveFileLink(raw: string): ParsedDriveFileLink {
  const input = (raw ?? "").trim();
  if (!input) return { ok: false, error: "Chưa dán link tệp Google Drive." };

  if (!input.includes("/") && ID_PATTERN.test(input)) {
    return { ok: true, driveFileId: input };
  }

  const fileMatch = /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i.exec(input);
  if (fileMatch?.[1]) return { ok: true, driveFileId: fileMatch[1] };

  const openMatch = /drive\.google\.com\/open\?(?:[^#]*&)?id=([a-zA-Z0-9_-]+)/i.exec(input);
  if (openMatch?.[1]) return { ok: true, driveFileId: openMatch[1] };

  const folderMatch = /drive\.google\.com\/(?:drive\/)?(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]+)/i.exec(
    input
  );
  if (folderMatch?.[1]) {
    return {
      ok: false,
      error:
        "Link này trỏ tới THƯ MỤC, không phải tệp ảnh. Trong thư mục, mở tấm ảnh rồi copy link của tệp (…/file/d/<ID>/view).",
    };
  }

  return {
    ok: false,
    error: "Không tìm thấy ID tệp trong link. Cần link dạng https://drive.google.com/file/d/<ID>/view.",
  };
}
