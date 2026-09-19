"use client";

// ============================================================
// Bắt đầu luồng cấp quyền Google Drive từ phía client.
//
// VÌ SAO KHÔNG DÙNG <Link> / <a href>
// Đây không phải điều hướng trong app mà là REDIRECT sang Google rồi quay lại.
// Link của Next sẽ cố điều hướng phía client (không được), còn <a> thì bị rule
// no-html-link-for-pages chặn cho đường dẫn nội bộ. Dùng location.assign là
// đúng bản chất: rời trang, để Google hiện màn hình đồng ý quyền.
//
// VÌ SAO KHÔNG DÙNG form POST
// Luồng OAuth cần GET để Google chuyển hướng tiếp; POST sẽ mất state cookie.
// ============================================================

export const DRIVE_CONNECT_PATH = "/api/drive/connect";

/** Rời trang sang màn hình đồng ý quyền của Google. */
export function startDriveConnect(): void {
  // Cố ý rời trang thật (không phải điều hướng client-side): đích cuối cùng là
  // accounts.google.com, kèm cookie state mà server vừa đặt. Router.push sẽ
  // không gửi được luồng redirect của Google.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(DRIVE_CONNECT_PATH);
}
