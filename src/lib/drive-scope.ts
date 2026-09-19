// ============================================================
// Google Drive — SCOPE & quyền, phần THUẦN (không mạng, không DB).
//
// Tách khỏi lib/drive.ts (vốn import prisma + server-only) để kiểm thử được độc
// lập: xem scripts/test-drive.mjs. Giống cách drive-files.ts tách phần MIME.
//
// VÌ SAO PHẦN NÀY QUAN TRỌNG
// Nó quyết định "chọn cả thư mục" có chạy được hay không:
//   drive.file      → đọc được TÊN thư mục nhưng KHÔNG đọc được NỘI DUNG
//                     (Drive trả mảng rỗng, không kèm lỗi → dễ kết luận sai
//                      là "thư mục trống")
//   drive.readonly  → đọc được nội dung thư mục, nhưng là scope HẠN CHẾ
//                     (cần xác minh + CASA khi mở cho công chúng)
// ============================================================

/** Scope tối thiểu: đọc/ghi file do người dùng chọn cho app. */
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/**
 * Scope đọc TOÀN BỘ Drive — cần để chọn cả thư mục rồi liệt kê ảnh bên trong.
 *
 * ĐÁNH ĐỔI: `drive.readonly` là scope hạn chế (restricted). Dùng ngay được ở
 * chế độ Testing (<100 người dùng, email trong Test users), nhưng muốn mở cho
 * công chúng thì Google bắt buộc xác minh restricted scope + đánh giá bảo mật
 * CASA hằng năm.
 */
export const DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

/**
 * Quản trị viên đã bật xin quyền đọc toàn Drive chưa.
 *
 * Đọc env tại thời điểm gọi (không cache) để test đặt được biến và để việc đổi
 * .env + khởi động lại có hiệu lực ngay.
 */
export function isFullDriveReadEnabled(): boolean {
  const v = process.env.GOOGLE_DRIVE_FULL_READ;
  return v === "1" || v?.toLowerCase() === "true";
}

/**
 * Danh sách scope app sẽ xin.
 *
 * Khi bật full-read thì xin CẢ HAI: nếu Google chỉ cấp `readonly` thì vẫn đủ;
 * nếu vì lý do nào đó `readonly` không được cấp thì `drive.file` còn nguyên để
 * đường chọn từng tệp qua Picker tiếp tục chạy — không mất tính năng đang có.
 */
export function driveScopes(): string {
  return [
    "openid",
    "email",
    "profile",
    DRIVE_FILE_SCOPE,
    ...(isFullDriveReadEnabled() ? [DRIVE_READONLY_SCOPE] : []),
  ].join(" ");
}

/**
 * Kết nối hiện tại có quyền đọc TOÀN BỘ Drive không?
 *
 * Quyết định đường lấy ảnh: có quyền rộng thì đọc được nội dung thư mục; chỉ có
 * `drive.file` thì buộc phải chọn từng tệp qua Picker.
 */
export function hasFullDriveRead(grantedScope: string | null | undefined): boolean {
  if (!grantedScope) return false;
  return (
    grantedScope.includes(DRIVE_READONLY_SCOPE) ||
    // `auth/drive` là scope đầy đủ hơn, cũng bao gồm quyền đọc.
    // Đòi khoảng trắng hoặc hết chuỗi phía sau để KHÔNG nhận nhầm
    // `auth/drive.file` thành `auth/drive`.
    /auth\/drive(\s|$)/.test(grantedScope)
  );
}
