import { NextResponse } from "next/server";
import {
  isSchedulerEnabled,
  kickAutopilotPlanner,
  kickInsightsRefresh,
  runSchedulerTick,
  type TickSource,
} from "@/lib/scheduler";

// ============================================================
// POST/GET /api/cron/tick — chạy một vòng worker đăng bài theo lịch.
//
// Đây là điểm kích hoạt duy nhất cho scheduler. Có thể gọi từ:
// - `npm run worker`  (tiến trình nền kèm sẵn, gọi mỗi 60 giây)
// - cron hệ thống     (crontab, cron của hosting, EasyCron...)
//
// Bảo vệ: nếu đặt CRON_SECRET trong .env thì BẮT BUỘC gửi kèm secret.
// Nếu chưa đặt, endpoint chỉ nhận request từ máy cục bộ (loopback).
//
// Cờ bật/tắt trên giao diện web (`scheduler.enabled`) có hiệu lực với MỌI
// nguồn gọi, kể cả cron bên ngoài — người dùng tắt là tắt thật, không thể bị
// đăng bài ngoài ý muốn.
// ============================================================

export const dynamic = "force-dynamic";

/** Lấy IP của client từ header của proxy (nếu có). */
function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "";
}

/** Kiểm tra request có quyền chạy scheduler không. */
function isAuthorized(request: Request, url: URL): boolean {
  const secret = process.env.CRON_SECRET;

  if (secret) {
    const header = request.headers.get("authorization") ?? "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const query = url.searchParams.get("secret") ?? "";
    // So sánh độ dài trước để tránh rò rỉ thông tin qua thời gian phản hồi
    return (
      (bearer.length === secret.length && bearer === secret) ||
      (query.length === secret.length && query === secret)
    );
  }

  // Chưa cấu hình secret: chỉ cho phép gọi từ chính máy này
  const ip = clientIp(request);
  return (
    ip === "" ||
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    ip === "localhost"
  );
}

async function handle(request: Request) {
  const url = new URL(request.url);

  if (!isAuthorized(request, url)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Không có quyền chạy scheduler. Đặt CRON_SECRET trong .env rồi gửi kèm " +
          "header 'Authorization: Bearer <secret>' hoặc ?secret=<secret>.",
      },
      { status: 401 }
    );
  }

  const startedAt = Date.now();

  // Người dùng đã tắt tự động đăng trên giao diện → không đăng gì cả.
  // Trả 200 (không phải lỗi) để cron không báo động rồi thử lại liên tục.
  if (!(await isSchedulerEnabled())) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason:
        "Tự động đăng đang TẮT trên giao diện web — không xử lý bài nào. " +
        "Bật lại ở trang Lịch đăng hoặc Cài đặt.",
      durationMs: Date.now() - startedAt,
      claimed: 0,
      published: 0,
      retrying: 0,
      failed: 0,
      recovered: 0,
      details: [],
    });
  }

  // Nguồn gọi để giao diện biết vòng lặp đang chạy ở đâu
  const sourceParam = url.searchParams.get("source");
  const source: TickSource =
    sourceParam === "worker" ? "worker" : sourceParam === "cron" ? "cron" : "worker";

  try {
    // Kích hoạt bộ lập kế hoạch của chế độ tự động (chạy song song, không
    // chờ). Nhờ vậy người dùng chạy SCHEDULER_IN_PROCESS=0 + cron ngoài vẫn
    // được lên kế hoạch bài mới y như khi vòng lặp chạy trong app.
    const plannerKicked = kickAutopilotPlanner();

    // Thu thập số liệu hiệu quả cũng chạy song song ở đây — nhờ vậy người dùng
    // chạy SCHEDULER_IN_PROCESS=0 + cron ngoài vẫn có số liệu mới cho phần tự
    // tối ưu, không cần vòng lặp trong app.
    const insightsKicked = kickInsightsRefresh();

    const result = await runSchedulerTick(new Date(), source);
    return NextResponse.json({
      ok: true,
      source,
      plannerKicked,
      insightsKicked,
      durationMs: Date.now() - startedAt,
      ...result,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  return handle(request);
}

// Cho phép cron dịch vụ chỉ gọi được bằng GET
export async function GET(request: Request) {
  return handle(request);
}
