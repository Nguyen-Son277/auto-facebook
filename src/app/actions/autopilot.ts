"use server";

import { formatDateTime } from "@/lib/format-date";

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { kickAutopilotPlanner } from "@/lib/scheduler";
import { runAutopilotPlanner, type PlannerRunResult } from "@/lib/autopilot";
import { getPageReadiness, readinessProblem } from "@/lib/brand";
import {
  addDays,
  clampPlanAheadDays,
  clampPostsPerDay,
  formatDateKey,
  parseDaysOfWeek,
  parseHm,
  startOfDay,
  vnTime,
} from "@/lib/autopilot-plan";

// ============================================================
// Server action cho trang Chế độ tự động.
//
// Triết lý: người dùng chỉ chạm vào vài thông số. Mọi giá trị nhập vào đều
// được kẹp về khoảng an toàn ở đây (server), không tin vào validate của
// trình duyệt — tránh trường hợp đặt 500 bài/ngày làm cháy quota AI.
// ============================================================

export type AutoPilotState = {
  ok?: boolean;
  error?: string;
  message?: string;
} | null;

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const bool = (fd: FormData, key: string) => str(fd, key) === "1" || str(fd, key) === "on";

/** Ngày bắt đầu lên lịch xa nhất được phép — chặn giá trị vô lý. */
const MAX_START_DATE_DAYS = 90;

async function assertOwnedPage(userId: string, pageId: string) {
  if (!pageId) return null;
  return prisma.facebookPage.findFirst({
    where: { id: pageId, userId },
    select: { id: true, name: true },
  });
}

/** Kiểm tra Page đã đủ điều kiện chạy tự động chưa. */
async function readiness(pageId: string): Promise<string | null> {
  // Dùng chung helper với bộ lập kế hoạch và giao diện — nhờ đó Page chưa gắn
  // thương hiệu nhận đúng thông báo thay vì bị báo nhầm là thiếu trụ cột.
  const state = await getPageReadiness(pageId);
  if (!state) return "Page không tồn tại.";
  return readinessProblem(state);
}

// ============================================================
// Lưu thông số
// ============================================================

export async function saveAutoPilot(
  _prev: AutoPilotState,
  formData: FormData
): Promise<AutoPilotState> {
  const user = await requireCurrentUser();
  const pageId = str(formData, "pageId");

  const page = await assertOwnedPage(user.id, pageId);
  if (!page) return { ok: false, error: "Page không tồn tại hoặc không thuộc về bạn." };

  const windowStart = str(formData, "windowStart") || "07:00";
  const windowEnd = str(formData, "windowEnd") || "21:00";

  const startMin = parseHm(windowStart);
  const endMin = parseHm(windowEnd);
  if (startMin === null || endMin === null) {
    return { ok: false, error: "Giờ không hợp lệ — dùng định dạng HH:MM, ví dụ 07:30." };
  }
  if (endMin <= startMin) {
    return {
      ok: false,
      error: "Giờ kết thúc phải sau giờ bắt đầu. Chế độ tự động không đăng qua đêm.",
    };
  }

  const postsPerDay = clampPostsPerDay(Number(str(formData, "postsPerDay")));
  const minGapMinutes = Math.min(Math.max(Number(str(formData, "minGapMinutes")) || 120, 30), 720);

  // Cảnh báo sớm thay vì để người dùng ngạc nhiên vì thiếu bài
  const span = endMin - startMin;
  const fits = Math.floor(span / minGapMinutes) + 1;
  if (fits < postsPerDay) {
    return {
      ok: false,
      error:
        `Khung giờ ${windowStart}–${windowEnd} với giãn cách ${minGapMinutes} phút ` +
        `chỉ đủ cho ${fits} bài/ngày (bạn đang đặt ${postsPerDay}). ` +
        "Hãy nới khung giờ, giảm giãn cách, hoặc giảm số bài.",
    };
  }

  const days = parseDaysOfWeek(str(formData, "daysOfWeek"));

  const mediaMixRaw = str(formData, "mediaMix");
  const mediaMix = ["IMAGE_ONLY", "VIDEO_ONLY", "MIXED"].includes(mediaMixRaw)
    ? mediaMixRaw
    : "IMAGE_ONLY";
  const videoPercent = Math.min(Math.max(Number(str(formData, "videoPercent")) || 25, 0), 100);

  // mediaKind cũ giữ lại để tương thích với giao diện cũ và nút "tìm lại ảnh"
  // của trang chi tiết; nhưng MIXED/VIDEO_ONLY mới có quyền quyết định.
  const mediaKind = str(formData, "mediaKind");
  const resolvedKind =
    mediaMix === "VIDEO_ONLY"
      ? "VIDEO"
      : mediaMix === "MIXED"
        ? "IMAGE" // ảnh là mặc định cho từng bài, qua decideMediaKind
        : mediaKind === "VIDEO"
          ? "VIDEO"
          : "IMAGE";

  // Mốc neo lập kế hoạch: "YYYY-MM-DD" → instant 00:00 giờ Việt Nam.
  // Trống, ở quá khứ, hoặc là hôm nay → null (bắt đầu từ hôm nay).
  const startDateRaw = str(formData, "startDate");
  let startDate: Date | null = null;
  if (startDateRaw) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDateRaw);
    if (!m) {
      return { ok: false, error: "Ngày bắt đầu không hợp lệ — dùng định dạng YYYY-MM-DD." };
    }
    const picked = vnTime(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    // vnTime tự cuộn ngày không tồn tại (31/02 → 03/03) nên phải so lại
    if (formatDateKey(picked) !== startDateRaw) {
      return { ok: false, error: "Ngày bắt đầu không tồn tại." };
    }
    const today = startOfDay(new Date());
    if (picked.getTime() > addDays(today, MAX_START_DATE_DAYS).getTime()) {
      return {
        ok: false,
        error: `Ngày bắt đầu quá xa — tối đa ${MAX_START_DATE_DAYS} ngày kể từ hôm nay.`,
      };
    }
    startDate = picked.getTime() > today.getTime() ? picked : null;
  }

  const data = {
    mode: str(formData, "mode") === "AUTO" ? "AUTO" : "REVIEW",
    postsPerDay,
    windowStart,
    windowEnd,
    daysOfWeek: days.join(","),
    minGapMinutes,
    autoMedia: bool(formData, "autoMedia"),
    mediaKind: resolvedKind,
    mediaMix,
    videoPercent,
    photosPerPost: Math.min(Math.max(Number(str(formData, "photosPerPost")) || 2, 1), 4),
    length: ["short", "medium", "long"].includes(str(formData, "length"))
      ? str(formData, "length")
      : "medium",
    toneOverride: str(formData, "toneOverride") || null,
    useHashtags: bool(formData, "useHashtags"),
    planAheadDays: clampPlanAheadDays(Number(str(formData, "planAheadDays"))),
    startDate,
  };

  await prisma.autoPilot.upsert({
    where: { pageId },
    create: { userId: user.id, pageId, enabled: false, ...data },
    update: data,
  });

  revalidatePath("/autopilot");
  revalidatePath("/calendar");
  const mixLabel =
    mediaMix === "MIXED"
      ? `xen kẽ ${videoPercent}% video`
      : mediaMix === "VIDEO_ONLY"
        ? "toàn video"
        : "toàn ảnh";
  return {
    ok: true,
    message: `Đã lưu thông số: ${postsPerDay} bài/ngày, ${mixLabel}.`,
  };
}

// ============================================================
// Bật / tắt
// ============================================================

export async function toggleAutoPilot(
  pageId: string,
  enabled: boolean
): Promise<AutoPilotState> {
  const user = await requireCurrentUser();
  const page = await assertOwnedPage(user.id, pageId);
  if (!page) return { ok: false, error: "Page không tồn tại hoặc không thuộc về bạn." };

  if (enabled) {
    const problem = await readiness(pageId);
    if (problem) return { ok: false, error: problem };
  }

  const existing = await prisma.autoPilot.findUnique({ where: { pageId } });
  if (!existing) {
    return { ok: false, error: "Hãy lưu thông số trước khi bật chế độ tự động." };
  }

  await prisma.autoPilot.update({
    where: { pageId },
    // Bật lại thì xóa lỗi cũ để không bị lớp chờ-sau-lỗi chặn ngay
    data: { enabled, lastPlanError: enabled ? null : existing.lastPlanError },
  });

  // Bật xong lên kế hoạch luôn để người dùng thấy kết quả ngay
  if (enabled) kickAutopilotPlanner(true);

  revalidatePath("/autopilot");
  revalidatePath("/calendar");
  revalidatePath("/dashboard");

  return {
    ok: true,
    message: enabled
      ? `Đã BẬT chế độ tự động cho "${page.name}". Hệ thống đang lên kế hoạch bài đầu tiên…`
      : `Đã TẮT chế độ tự động cho "${page.name}". Bài đã lên lịch vẫn giữ nguyên.`,
  };
}

// ============================================================
// Lên kế hoạch ngay (không chờ chu kỳ)
// ============================================================

export async function runPlannerNowAction(pageId: string): Promise<AutoPilotState> {
  const user = await requireCurrentUser();
  const page = await assertOwnedPage(user.id, pageId);
  if (!page) return { ok: false, error: "Page không tồn tại hoặc không thuộc về bạn." };

  const config = await prisma.autoPilot.findUnique({ where: { pageId } });
  if (!config) return { ok: false, error: "Chưa có cấu hình — hãy lưu thông số trước." };
  if (!config.enabled) {
    return { ok: false, error: "Chế độ tự động đang TẮT — bật lên rồi thử lại." };
  }

  const problem = await readiness(pageId);
  if (problem) return { ok: false, error: problem };

  // Xóa lỗi cũ để không bị lớp chờ-sau-lỗi chặn khi người dùng bấm thủ công
  await prisma.autoPilot.update({ where: { pageId }, data: { lastPlanError: null } });

  let result: PlannerRunResult;
  try {
    // Chạy đồng bộ ở đây (khác vòng lặp nền) để trả kết quả thật cho người dùng
    result = await runAutopilotPlanner(new Date());
  } catch (err) {
    return {
      ok: false,
      error: `Lỗi khi lập kế hoạch: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  revalidatePath("/autopilot");
  revalidatePath("/calendar");

  const mine = result.pages.find((p) => p.pageId === pageId);

  if (!mine) {
    return { ok: true, message: "Không có gì để làm — kế hoạch các ngày tới đã đủ bài." };
  }
  if (mine.created === 0) {
    return {
      ok: false,
      error:
        mine.error ??
        "Không tạo được bài nào. Kiểm tra lại cấu hình AI ở trang Cài đặt và khung giờ đăng.",
    };
  }

  return {
    ok: true,
    message:
      `Đã tạo ${mine.created} bài mới.` +
      (mine.skipped > 0 ? ` (${mine.skipped} bài chưa tạo được: ${mine.error ?? "lỗi AI"})` : "") +
      (mine.missingMedia
        ? ` ⚠️ ${mine.missingMedia} bài không tìm được ảnh — ${mine.mediaWarning}`
        : ""),
  };
}

// ============================================================
// Duyệt bài (chế độ REVIEW)
// ============================================================

export async function approvePlannedPost(postId: string): Promise<AutoPilotState> {
  const user = await requireCurrentUser();

  const post = await prisma.post.findFirst({
    where: { id: postId, userId: user.id, status: "PENDING_REVIEW" },
    select: { id: true, scheduledAt: true },
  });
  if (!post) return { ok: false, error: "Không tìm thấy bài chờ duyệt." };

  // Nếu giờ hẹn đã trôi qua trong lúc chờ duyệt thì đẩy lên 1 phút nữa,
  // để scheduler đăng ngay thay vì bỏ quên bài
  const soon = new Date(Date.now() + 60 * 1000);
  const scheduledAt =
    post.scheduledAt && post.scheduledAt.getTime() > soon.getTime() ? post.scheduledAt : soon;

  await prisma.post.update({
    where: { id: postId },
    data: { status: "SCHEDULED", scheduledAt, errorMessage: null },
  });

  revalidatePath("/autopilot");
  revalidatePath("/calendar");
  return {
    ok: true,
    message: `Đã duyệt — bài sẽ đăng lúc ${formatDateTime(scheduledAt)}.`,
  };
}

/** Duyệt tất cả bài đang chờ của một Page. */
export async function approveAllPlanned(pageId: string): Promise<AutoPilotState> {
  const user = await requireCurrentUser();
  const page = await assertOwnedPage(user.id, pageId);
  if (!page) return { ok: false, error: "Page không tồn tại hoặc không thuộc về bạn." };

  const pending = await prisma.post.findMany({
    where: { pageId, userId: user.id, status: "PENDING_REVIEW" },
    select: { id: true, scheduledAt: true },
  });
  if (pending.length === 0) return { ok: false, error: "Không có bài nào đang chờ duyệt." };

  const soon = new Date(Date.now() + 60 * 1000);
  for (const p of pending) {
    const scheduledAt =
      p.scheduledAt && p.scheduledAt.getTime() > soon.getTime() ? p.scheduledAt : soon;
    await prisma.post.update({
      where: { id: p.id },
      data: { status: "SCHEDULED", scheduledAt, errorMessage: null },
    });
  }

  revalidatePath("/autopilot");
  revalidatePath("/calendar");
  return { ok: true, message: `Đã duyệt ${pending.length} bài.` };
}

/** Bỏ một bài đã lên kế hoạch (chưa đăng). */
export async function discardPlannedPost(postId: string): Promise<AutoPilotState> {
  const user = await requireCurrentUser();

  const deleted = await prisma.post.deleteMany({
    where: {
      id: postId,
      userId: user.id,
      origin: "AUTOPILOT",
      // Chỉ xóa bài CHƯA đăng — không bao giờ đụng vào bài đã lên Facebook
      status: { in: ["PENDING_REVIEW", "SCHEDULED"] },
    },
  });

  if (deleted.count === 0) {
    return { ok: false, error: "Không xóa được — bài có thể đã đăng hoặc đang đăng." };
  }

  revalidatePath("/autopilot");
  revalidatePath("/calendar");
  return { ok: true, message: "Đã bỏ bài khỏi kế hoạch." };
}

/** Xóa toàn bộ bài tự động chưa đăng của một Page (làm lại kế hoạch từ đầu). */
export async function clearPlannedPosts(pageId: string): Promise<AutoPilotState> {
  const user = await requireCurrentUser();
  const page = await assertOwnedPage(user.id, pageId);
  if (!page) return { ok: false, error: "Page không tồn tại hoặc không thuộc về bạn." };

  const deleted = await prisma.post.deleteMany({
    where: {
      pageId,
      userId: user.id,
      origin: "AUTOPILOT",
      status: { in: ["PENDING_REVIEW", "SCHEDULED"] },
    },
  });

  revalidatePath("/autopilot");
  revalidatePath("/calendar");
  return {
    ok: true,
    message:
      deleted.count > 0
        ? `Đã xóa ${deleted.count} bài chưa đăng. Bài đã đăng vẫn giữ nguyên.`
        : "Không có bài nào chưa đăng để xóa.",
  };
}

// ============================================================
// Bật / tắt TẤT CẢ cấu hình (quản lý tập trung)
// ============================================================

export async function toggleAllAutoPilots(enabled: boolean): Promise<AutoPilotState> {
  const user = await requireCurrentUser();

  const configs = await prisma.autoPilot.findMany({
    where: { userId: user.id },
    select: { pageId: true, enabled: true, lastPlanError: true },
  });
  if (configs.length === 0) {
    return { ok: false, error: "Chưa có cấu hình tự động nào — lưu thông số cho ít nhất một Page trước." };
  }

  if (enabled) {
    // Chỉ bật những Page đủ điều kiện (có trụ cột); gom Pages bị chặn để báo
    const blocked: string[] = [];
    let onCount = 0;
    for (const c of configs) {
      const problem = await readiness(c.pageId);
      if (problem) {
        blocked.push(c.pageId);
        continue;
      }
      await prisma.autoPilot.update({
        where: { pageId: c.pageId },
        data: { enabled: true, lastPlanError: null },
      });
      onCount++;
    }
    if (onCount > 0) kickAutopilotPlanner(true);
    revalidatePath("/autopilot");
    revalidatePath("/calendar");
    if (blocked.length > 0) {
      return {
        ok: true,
        message: `Đã bật ${onCount}/${configs.length} cấu hình. ${blocked.length} Page chưa có trụ cột nội dung nên bị bỏ qua — vào Thương hiệu để bổ sung.`,
      };
    }
    return { ok: true, message: `Đã bật ${onCount}/${configs.length} cấu hình tự động.` };
  }

  await prisma.autoPilot.updateMany({
    where: { userId: user.id },
    data: { enabled: false },
  });
  revalidatePath("/autopilot");
  revalidatePath("/calendar");
  return { ok: true, message: `Đã tắt tất cả ${configs.length} cấu hình tự động. Bài đã lên lịch vẫn giữ nguyên.` };
}
