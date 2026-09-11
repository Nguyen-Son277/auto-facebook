/**
 * Khởi động vòng lặp tự động đăng bài ngay trong tiến trình server web.
 *
 * Next.js gọi `register()` một lần khi server khởi động (cả `next dev` và
 * `next start`). Nhờ vậy KHÔNG cần mở terminal chạy `npm run worker` nữa —
 * chỉ cần app đang chạy là bài hẹn giờ được đăng.
 *
 * Người dùng vẫn bật/tắt được tính năng này trên giao diện web; cờ đó lưu
 * trong DB (`scheduler.enabled`) và được kiểm tra ở mỗi nhịp.
 */
export async function register() {
  // Chỉ chạy ở runtime Node — Edge runtime không có Prisma/fs
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Không chạy khi build: vòng lặp sẽ giữ tiến trình sống và làm treo `next build`
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  // Cho phép tắt vòng lặp trong app (SCHEDULER_IN_PROCESS=0).
  // Dùng khi muốn tự quản việc đăng bài bằng cron/worker bên ngoài, hoặc khi
  // chạy test cần kết quả tất định (chỉ một nguồn điều khiển).
  if (process.env.SCHEDULER_IN_PROCESS === "0") {
    console.log(
      "[scheduler] SCHEDULER_IN_PROCESS=0 — không bật vòng lặp trong app. " +
        "Bài hẹn giờ sẽ chỉ đăng khi có cron/worker bên ngoài gọi /api/cron/tick."
    );
    return;
  }

  try {
    const { startSchedulerLoop } = await import("./lib/scheduler");
    startSchedulerLoop();
  } catch (err) {
    // Không được để lỗi ở đây làm sập server — app vẫn phải chạy được
    // (chỉ là bài hẹn giờ sẽ không tự đăng)
    console.error(
      "[scheduler] không khởi động được vòng lặp tự động đăng: " +
        (err instanceof Error ? err.message : String(err))
    );
  }
}
