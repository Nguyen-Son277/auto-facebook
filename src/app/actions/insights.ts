"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import {
  refreshInsightsForPage,
  MAX_API_CALLS_PER_RUN,
  type RefreshOutcome,
} from "@/lib/fb-insights";
import { kickInsightsRefresh } from "@/lib/scheduler";

// ============================================================
// Server action cho trang Số liệu & tự tối ưu.
//
// Mọi action ở đây tự lấy user từ session — KHÔNG nhận userId từ client, và
// luôn kiểm tra Page thuộc về user trước khi làm bất cứ việc gì. Số liệu bài
// đăng là dữ liệu kinh doanh, không được để lộ giữa các tài khoản.
// ============================================================

export type InsightsState = {
  ok?: boolean;
  message?: string;
  error?: string;
} | null;

/**
 * Lấy số liệu ngay (nút "🔄 Lấy số liệu ngay").
 *
 * Chạy đồng bộ và chờ kết quả (khác với bản chạy nền trong scheduler) vì người
 * dùng đang đợi để xem số liệu — trả về luôn con số đã cập nhật để họ biết nút
 * có tác dụng.
 */
export async function refreshInsightsNow(pageId: string): Promise<InsightsState> {
  const user = await requireCurrentUser();

  const page = await prisma.facebookPage.findFirst({
    where: { id: pageId, userId: user.id },
    select: { id: true, name: true },
  });
  if (!page) return { ok: false, error: "Page không tồn tại hoặc không thuộc về bạn." };

  try {
    const outcome: RefreshOutcome = await refreshInsightsForPage(page.id, {
      now: new Date(),
      budget: { remaining: MAX_API_CALLS_PER_RUN },
    });

    revalidatePath("/insights");
    revalidatePath("/autopilot");

    if (outcome.status === "TOKEN_INVALID") {
      return {
        ok: false,
        error:
          "Token của Page đã hết hiệu lực nên Facebook không trả số liệu. Vào trang Facebook Apps để đồng bộ lại token.",
      };
    }
    if (outcome.status === "LOW_FANS") {
      return {
        ok: false,
        error:
          "Facebook chỉ cung cấp số liệu Insights cho Page có từ 100 lượt thích trở lên. Hệ thống vẫn xếp hạng theo tương tác (cảm xúc, bình luận, chia sẻ).",
      };
    }
    if (outcome.updated === 0) {
      return {
        ok: true,
        message:
          "Chưa có bài AutoPilot nào đã đăng trong 90 ngày gần đây nên chưa có số liệu để lấy. Số liệu sẽ tự được thu thập sau khi bài đầu tiên lên sóng khoảng 24 giờ.",
      };
    }

    return {
      ok: true,
      message:
        `Đã cập nhật số liệu cho ${outcome.updated} bài` +
        (outcome.deep > 0 ? ` (${outcome.deep} bài có số lượt xem/tiếp cận).` : ".") +
        (outcome.status === "NO_PERMISSION"
          ? " Lưu ý: token chưa có quyền read_insights nên chưa lấy được lượt hiển thị — thứ hạng hiện chỉ dựa trên tương tác."
          : ""),
    };
  } catch (err) {
    return {
      ok: false,
      error: `Không lấy được số liệu: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Bật/tắt tự tối ưu theo số liệu cho MỘT Page.
 *
 * Bật lần đầu sẽ chạy NGAY bước kiểm tra khởi động: lấy số liệu và tính trạng
 * thái học, để người dùng thấy kết quả thay vì màn hình trống chờ nhịp nền.
 *
 * Tắt KHÔNG xoá dữ liệu đã thu thập — chỉ ngừng điều chỉnh cách lập kế hoạch.
 * Nhờ vậy bật lại là dùng tiếp lịch sử cũ, và người dùng yên tâm thử nghiệm.
 */
export async function setInsightsOptimization(
  pageId: string,
  enabled: boolean
): Promise<InsightsState> {
  const user = await requireCurrentUser();

  const page = await prisma.facebookPage.findFirst({
    where: { id: pageId, userId: user.id },
    select: { id: true, name: true },
  });
  if (!page) return { ok: false, error: "Page không tồn tại hoặc không thuộc về bạn." };

  try {
    await prisma.autoPilot.upsert({
      where: { pageId: page.id },
      // Chưa có cấu hình AutoPilot → tạo bản ghi tối thiểu, KHÔNG bật tự động
      // đăng: bật tối ưu không được phép vô tình bật đăng bài.
      create: {
        userId: user.id,
        pageId: page.id,
        enabled: false,
        insightsEnabled: enabled,
      },
      update: { insightsEnabled: enabled },
    });

    if (enabled) {
      // Bước kiểm tra khởi động — chạy nền để không chặn phản hồi giao diện
      // (lấy số liệu nhiều bài có thể mất vài giây).
      kickInsightsRefresh(true);
    }

    revalidatePath("/insights");
    revalidatePath("/autopilot");

    return {
      ok: true,
      message: enabled
        ? `Đã bật tự tối ưu cho "${page.name}". Hệ thống đang lấy số liệu và sẽ bắt đầu dò tìm hướng đi — xem tiến độ ở trang Số liệu.`
        : `Đã tắt tự tối ưu cho "${page.name}". Dữ liệu số liệu đã thu thập vẫn được giữ; cách lập kế hoạch trở về như trước.`,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Không lưu được cài đặt: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Kiểm tra lại ngay (nút "Kiểm tra lại ngay").
 *
 * Dùng khi người dùng nghi ngờ nội dung đang lỗi thời nhưng hệ thống chưa tự
 * phát hiện (ví dụ họ vừa thấy tương tác giảm trên Facebook). Bỏ qua cooldown
 * 14 ngày vì đây là quyết định của con người, không phải suy luận tự động.
 */
export async function reprobeNow(pageId: string): Promise<InsightsState> {
  const user = await requireCurrentUser();

  const page = await prisma.facebookPage.findFirst({
    where: { id: pageId, userId: user.id },
    select: { id: true, name: true, autopilot: { select: { insightsEnabled: true } } },
  });
  if (!page) return { ok: false, error: "Page không tồn tại hoặc không thuộc về bạn." };

  if (!page.autopilot?.insightsEnabled) {
    return {
      ok: false,
      error: "Hãy bật tự tối ưu theo số liệu trước khi kiểm tra lại.",
    };
  }

  try {
    // Lấy số liệu mới nhất trước, rồi mới chạy bước kiểm tra — nếu không thì
    // kết luận sẽ dựa trên số liệu cũ.
    await refreshInsightsForPage(page.id, {
      now: new Date(),
      budget: { remaining: MAX_API_CALLS_PER_RUN },
    });

    const { runVerifier } = await import("@/lib/insight-optimize");
    const verified = await runVerifier(page.id, new Date());

    revalidatePath("/insights");
    revalidatePath("/autopilot");

    if (!verified) {
      return { ok: false, error: "Không chạy được bước kiểm tra — xem lại cấu hình Page." };
    }

    return {
      ok: true,
      message:
        `Đã kiểm tra lại. Giai đoạn hiện tại: ${verified.phase}. ${verified.commentary.headline}`,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Không kiểm tra lại được: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
