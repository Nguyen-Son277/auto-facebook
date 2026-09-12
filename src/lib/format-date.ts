/**
 * Định dạng ngày/giờ DÙNG CHUNG cho cả server và trình duyệt.
 *
 * Vì sao cần file này:
 * - Server (Vercel) chạy múi giờ **UTC**, trình duyệt người dùng thường là
 *   **+07**. Gọi `toLocaleString()` trần cho ra hai chuỗi khác nhau ở hai môi
 *   trường → React báo lỗi hydration (#418) và ngày hiển thị lệch 7 tiếng.
 * - Luôn chỉ định `timeZone` nên kết quả giống hệt nhau ở mọi môi trường, đồng
 *   thời hiển thị đúng giờ Việt Nam bất kể server đặt ở đâu.
 *
 * Dùng hai hàm này thay cho `new Date(x).toLocaleString("vi-VN")` ở mọi nơi.
 */
export const APP_TIME_ZONE = "Asia/Ho_Chi_Minh";

/** Ngày dạng 14/9/2026 */
export function formatDate(value: string | number | Date): string {
  return new Date(value).toLocaleDateString("vi-VN", {
    timeZone: APP_TIME_ZONE,
  });
}

/** Ngày + giờ dạng 14/9/2026 21:30:05 */
export function formatDateTime(value: string | number | Date): string {
  return new Date(value).toLocaleString("vi-VN", {
    timeZone: APP_TIME_ZONE,
  });
}
