// Worker tự động đăng bài theo lịch — TÙY CHỌN.
//
// Ứng dụng đã tự chạy vòng lặp đăng bài bên trong tiến trình web server
// (xem src/instrumentation.ts), nên bình thường KHÔNG cần chạy file này.
//
// Chỉ dùng khi:
// - Bạn muốn một tiến trình riêng chịu trách nhiệm đăng bài (ví dụ chạy nhiều
//   bản web server, hoặc muốn tách việc đăng bài khỏi web).
// - Hoặc môi trường triển khai không giữ tiến trình server chạy liên tục.
//
// Chạy: npm run worker        (dừng bằng Ctrl+C)
//
// Worker chỉ là một nhịp tim: mỗi chu kỳ nó gọi POST /api/cron/tick để web
// server chạy một vòng scheduler. Nhờ vậy logic đăng bài chỉ tồn tại ở MỘT nơi
// (src/lib/scheduler.ts) và dùng chung với app — không bị lệch logic.
//
// Nếu không muốn chạy tiến trình này, có thể dùng cron hệ thống gọi thẳng:
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/tick
import "dotenv/config";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const SECRET = process.env.CRON_SECRET ?? "";
const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 60_000);

// source=worker để giao diện hiển thị đúng "do worker bên ngoài"
const tickUrl = new URL("/api/cron/tick?source=worker", BASE);

function stamp() {
  return new Date().toLocaleTimeString("vi-VN", { hour12: false });
}

async function tick() {
  const headers = {};
  if (SECRET) headers["Authorization"] = `Bearer ${SECRET}`;

  let res;
  try {
    res = await fetch(tickUrl, { method: "POST", headers });
  } catch (err) {
    console.error(
      `[${stamp()}] ✗ Không gọi được ${tickUrl.href} — web server đã chạy chưa? ` +
        `(${err instanceof Error ? err.message : String(err)})`
    );
    return;
  }

  if (res.status === 401) {
    console.error(
      `[${stamp()}] ✗ Bị từ chối (401). Kiểm tra CRON_SECRET có khớp giữa .env và web server không.`
    );
    return;
  }

  let data;
  try {
    data = await res.json();
  } catch {
    console.error(`[${stamp()}] ✗ Phản hồi không phải JSON (HTTP ${res.status}).`);
    return;
  }

  if (!data.ok) {
    console.error(`[${stamp()}] ✗ Lỗi scheduler: ${data.error ?? `HTTP ${res.status}`}`);
    return;
  }

  if (data.skipped) {
    console.log(`[${stamp()}] ⏸ ${data.reason ?? "Tự động đăng đang tắt."}`);
    return;
  }

  const { published, retrying, failed, recovered, claimed } = data;

  if (published || retrying || failed || recovered) {
    console.log(
      `[${stamp()}] ✔ Đã xử lý ${claimed} bài — thành công ${published}, ` +
        `thử lại ${retrying}, lỗi ${failed}, gỡ kẹt ${recovered}`
    );
    for (const d of data.details ?? []) {
      const icon =
        d.outcome === "PUBLISHED" ? "✅" : d.outcome === "RETRY" ? "🔁" : "❌";
      console.log(`   ${icon} ${d.content}${d.message ? ` — ${d.message.slice(0, 100)}` : ""}`);
    }
  } else {
    // Vẫn in nhịp để người dùng biết worker còn sống
    console.log(`[${stamp()}] · không có bài nào đến hạn`);
  }
}

console.log("─".repeat(64));
console.log("⏰ Worker đăng bài theo lịch (tùy chọn — app đã tự chạy sẵn)");
console.log(`   Máy chủ   : ${tickUrl.href}`);
console.log(`   Chu kỳ    : ${INTERVAL_MS / 1000} giây`);
console.log(`   Bảo vệ    : ${SECRET ? "CRON_SECRET ✓" : "chưa đặt CRON_SECRET (chỉ loopback)"}`);
console.log("   Dừng      : Ctrl+C");
console.log("─".repeat(64));

let running = false;
let stopped = false;

async function loop() {
  if (stopped) return;
  // Bỏ qua nhịp nếu vòng trước còn đang chạy (bài đăng lâu hơn chu kỳ)
  if (!running) {
    running = true;
    try {
      await tick();
    } finally {
      running = false;
    }
  }
}

await loop();

const timer = setInterval(loop, INTERVAL_MS);

function shutdown(signal) {
  if (stopped) return;
  stopped = true;
  clearInterval(timer);
  console.log(`\n[${stamp()}] Đã dừng worker (${signal}).`);
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
