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
  /** Hồ sơ thương hiệu đã có phần giới thiệu doanh nghiệp chưa. */
  hasDescription: boolean;
  /** Hồ sơ thương hiệu đã có sản phẩm/dịch vụ chưa. */
  hasProducts: boolean;
};

/**
 * Hồ sơ doanh nghiệp TỐI THIỂU để AI viết được bài.
 *
 * Vì sao cần lớp này: thiếu mô tả doanh nghiệp và sản phẩm thì AI không có gì
 * để bám vào — bài viết ra chung chung, sai ngành hàng, hoặc tệ hơn là bịa.
 * Người dùng bật "đăng thẳng" mà hồ sơ trống thì bài rác lên Page thật trước
 * khi họ kịp nhận ra. Nên đây là điều kiện CHẶN, không phải gợi ý.
 *
 * `null` = đủ điều kiện tối thiểu.
 */
export function minimalProfileProblem(r: {
  hasDescription: boolean;
  hasProducts: boolean;
}): string | null {
  const missing: string[] = [];
  if (!r.hasDescription) missing.push("giới thiệu doanh nghiệp");
  if (!r.hasProducts) missing.push("sản phẩm/dịch vụ chính");

  if (missing.length === 0) return null;

  return (
    `Hồ sơ thương hiệu còn thiếu ${missing.join(" và ")} — AI chưa có thông tin ` +
    "doanh nghiệp để viết bài, nên chế độ tự động không chạy được. " +
    "Vào Thương hiệu → Hồ sơ & nội dung để bổ sung."
  );
}

/**
 * Vì sao Page chưa bật được chế độ tự động. `null` = đủ điều kiện.
 *
 * Tách khỏi getPageReadiness để server action, bộ lập kế hoạch và giao diện
 * dùng CHUNG một câu chữ — không còn chỗ báo "thiếu trụ cột" khi thật ra Page
 * chưa gắn thương hiệu.
 *
 * Thứ tự kiểm tra là CỐ Ý: mỗi tầng chỉ có nghĩa khi tầng trước đã đạt.
 * Chưa gắn Brand thì không thể nói gì về trụ cột (trụ cột thuộc Brand).
 */
export function readinessProblem(r: PageReadiness): string | null {
  if (!r.brandId) {
    return "Page chưa gắn thương hiệu — vào trang Pages để gán Page vào một thương hiệu, rồi thêm trụ cột nội dung ở trang Thương hiệu.";
  }
  if (r.pillars === 0) {
    return "Chưa có trụ cột nội dung nào đang bật — vào Thương hiệu để thêm (hoặc bấm tạo bộ mặc định).";
  }
  return minimalProfileProblem(r);
}

// ============================================================
// BẢO VỆ LỊCH ĐĂNG TỰ ĐỘNG
//
// Vấn đề: người dùng đang bật tự động đăng, rồi xoá thương hiệu / tắt trụ cột
// cuối / bỏ gắn Brand khỏi Page. AutoPilot vẫn `enabled = true` nhưng Page
// không còn đủ dữ liệu → mỗi nhịp lập kế hoạch lại lỗi, và bị lớp nghỉ 15 phút
// chặn lặp vô hạn. Người dùng chỉ thấy "tự động đăng không chạy" mà không hiểu
// vì sao.
//
// Giải pháp: mọi thao tác có thể gây ra tình trạng đó phải HỎI XÁC NHẬN, và
// nếu người dùng đồng ý thì TẮT tự động đăng của đúng những Page bị ảnh hưởng
// trước khi thao tác chạy. Bài đã lên lịch KHÔNG bị xoá.
//
// Toàn bộ câu chữ nằm ở đây để giao diện, server action và thông báo dùng
// chung — không có chỗ nào tự viết lại rồi lệch nhau.
// ============================================================

/** Tiêu đề thông báo gửi cho chủ Page khi hệ thống tự tắt tự động đăng. */
export const AUTO_PILOT_GUARD_TITLE = "⏸ Đã tắt tự động đăng để bảo vệ lịch đăng";

/** Liệt kê tên Page cho thông báo/hộp thoại; rút gọn khi quá nhiều. */
export function formatPageNames(pageNames: string[], max = 5): string {
  const names = pageNames.map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) return "không có Page nào";
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} và ${names.length - max} Page khác`;
}

/**
 * Câu hỏi xác nhận hiện trên giao diện trước khi thực hiện thao tác.
 *
 * @param action    mô tả thao tác người dùng sắp làm, ví dụ "xoá thương hiệu"
 * @param pageNames tên các Page đang bật tự động đăng và bị ảnh hưởng
 */
export function autoPilotConfirmPrompt(action: string, pageNames: string[]): string {
  const list = formatPageNames(pageNames);
  const count = pageNames.length;
  return (
    `${action} sẽ khiến ${count} Page đang tự động đăng không còn đủ thông tin doanh nghiệp:\n\n` +
    `${list}\n\n` +
    `Nếu tiếp tục, hệ thống sẽ TẮT tự động đăng của ${count === 1 ? "Page này" : "các Page này"}.\n` +
    "Bài đã lên lịch KHÔNG bị xoá — bạn bật lại được sau khi bổ sung thông tin.\n\n" +
    "Tiếp tục?"
  );
}

/** Lỗi trả về khi client gọi action mà chưa xác nhận tắt tự động đăng. */
export function autoPilotBlockedError(action: string, pageNames: string[]): string {
  const list = formatPageNames(pageNames);
  const count = pageNames.length;
  return (
    `Chưa xác nhận: ${action} sẽ làm ${count} Page đang tự động đăng mất thông tin doanh nghiệp ` +
    `(${list}). Hãy xác nhận tắt tự động đăng cho ${count === 1 ? "Page đó" : "các Page đó"} rồi thử lại.`
  );
}

/** Nội dung thông báo gửi cho chủ Page sau khi hệ thống tự tắt tự động đăng. */
export function autoPilotGuardNotice(reason: string, pageNames: string[]): string {
  const list = formatPageNames(pageNames);
  return (
    `Tự động đăng đã được tắt cho: ${list}.\n\n` +
    `Lý do: ${reason}\n\n` +
    "Bài đã lên lịch vẫn giữ nguyên và sẽ không bị xoá. " +
    "Bổ sung thông tin doanh nghiệp rồi bật lại ở trang Tự động đăng."
  );
}
