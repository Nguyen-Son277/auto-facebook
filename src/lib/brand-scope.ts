// ============================================================
// Phạm vi nội dung & điều kiện sẵn sàng của một Page — logic THUẦN.
//
// Tách khỏi brand.ts (vốn import prisma + "server-only") để kiểm thử được độc
// lập, không cần database: xem scripts/test-brand-page-link.mjs.
//
// Bối cảnh: trụ cột nội dung và tài liệu nay thuộc Brand (schema.prisma:
// ContentPillar/KnowledgeDoc có brandId bắt buộc, pageId chỉ giữ cho dữ liệu
// cũ). Vì vậy mọi chỗ cần "nội dung của Page này" phải đi qua brandId của Page.
//
// Lỗi cũ: mỗi nơi tự viết lại `page.brandId ? {brandId} : {pageId}`, nên khi
// Page CHƯA gắn brand thì truy vấn rơi vào nhánh pageId — luôn ra 0 kết quả —
// và hệ thống báo nhầm là "Chưa có trụ cột nội dung nào".
// ============================================================

/**
 * Phạm vi nội dung của một Page: theo Brand, hoặc theo pageId cho dữ liệu cũ
 * chưa kịp chuyển sang Brand.
 */
export function contentScopeForPage(
  brandId: string | null,
  pageId: string
): { brandId: string } | { pageId: string } {
  return brandId ? { brandId } : { pageId };
}

export type PageReadiness = {
  brandId: string | null;
  brandName: string | null;
  /** Số trụ cột nội dung đang bật. */
  pillars: number;
  /** Hồ sơ thương hiệu đã có mô tả/sản phẩm chưa. */
  hasProfile: boolean;
};

/**
 * Vì sao Page chưa bật được chế độ tự động. `null` = đủ điều kiện.
 *
 * Tách khỏi getPageReadiness để server action, bộ lập kế hoạch và giao diện
 * dùng CHUNG một câu chữ — không còn chỗ báo "thiếu trụ cột" khi thật ra Page
 * chưa gắn thương hiệu.
 */
export function readinessProblem(r: PageReadiness): string | null {
  if (!r.brandId) {
    return "Page chưa gắn thương hiệu — vào trang Pages để gán Page vào một thương hiệu, rồi thêm trụ cột nội dung ở trang Thương hiệu.";
  }
  if (r.pillars === 0) {
    return "Chưa có trụ cột nội dung nào đang bật — vào Thương hiệu để thêm (hoặc bấm tạo bộ mặc định).";
  }
  return null;
}
