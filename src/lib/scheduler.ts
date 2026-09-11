import "server-only";

import { prisma } from "@/lib/prisma";
import { buildMessage, deliverToFacebook } from "@/lib/deliver";
import { getSetting, setSetting } from "@/lib/settings";
import { validateAttachments, type AttachedMedia } from "@/lib/posts";

// ============================================================
// Worker tự động đăng bài theo lịch.
//
// Vì sao không dùng BullMQ/Redis: app này chạy trên SQLite, một người dùng,
// tự host. Bắt cài thêm Redis chỉ để hẹn giờ là quá nặng và dễ hỏng khi triển
// khai. SQLite đã là nguồn dữ liệu duy nhất, nên hàng đợi nằm luôn trong bảng
// Post: bài đến hạn = status SCHEDULED và scheduledAt <= hiện tại.
//
// Chống 2 worker đăng trùng: mỗi lần giành bài là một updateMany CÓ ĐIỀU KIỆN
// (status = SCHEDULED). SQLite thực thi câu lệnh này nguyên tử, nên chỉ một
// tiến trình nhận được count = 1 — tiến trình kia nhận 0 và bỏ qua.
// ============================================================

/** Số lần thử tối đa trước khi bỏ cuộc (1 lần đầu + 2 lần thử lại). */
export const MAX_ATTEMPTS = 3;

/** Thời gian chờ trước mỗi lần thử lại (theo số lần đã thử). */
export const RETRY_DELAYS_MS = [5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000];

/** Bài PUBLISHING lâu hơn mức này bị coi là worker đã chết giữa chừng. */
export const STALE_LOCK_MS = 15 * 60 * 1000;

/** Số bài xử lý tối đa mỗi lần chạy — tránh một lần chạy kéo quá dài. */
export const MAX_POSTS_PER_TICK = 5;

/** Chu kỳ kiểm tra bài đến hạn (mặc định 60 giây). */
export const TICK_INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 60_000);

/** Khóa lưu trạng thái bật/tắt tự động đăng. Không có giá trị = đang bật. */
const ENABLED_KEY = "scheduler.enabled";
/** Khóa lưu nhịp tim (lần chạy gần nhất) + nguồn chạy. */
const HEARTBEAT_KEY = "scheduler.lastRunAt";
const SOURCE_KEY = "scheduler.lastSource";

/** Nguồn gọi một vòng scheduler. */
export type TickSource = "server" | "worker" | "cron" | "manual";

/** Tự động đăng có đang được bật không. Mặc định BẬT. */
export async function isSchedulerEnabled(): Promise<boolean> {
  const value = await getSetting(ENABLED_KEY);
  return value !== "0";
}

/** Bật/tắt tự động đăng bài theo lịch. */
export async function setSchedulerEnabled(enabled: boolean): Promise<void> {
  await setSetting(ENABLED_KEY, enabled ? "1" : "0");
}

export type TickResult = {
  /** Số bài worker đã giành được trong lần chạy này. */
  claimed: number;
  published: number;
  /** Bài lỗi nhưng sẽ được thử lại sau. */
  retrying: number;
  /** Bài lỗi đã hết lượt thử — cần người dùng xử lý. */
  failed: number;
  /** Bài bị kẹt ở PUBLISHING do worker chết, đã chuyển sang FAILED. */
  recovered: number;
  /** Chi tiết từng bài để hiển thị log. */
  details: {
    postId: string;
    content: string;
    outcome: "PUBLISHED" | "RETRY" | "FAILED";
    message?: string;
  }[];
};

/** Lỗi không nên thử lại — thử lại cũng không giải quyết được. */
function isPermanentError(message: string): boolean {
  return /không còn trên máy chủ|không hợp lệ|Page không tồn tại|đã bị tắt hoạt động|hết hạn|không có quyền|permission|does not exist|has expired|invalid/i.test(
    message
  );
}

/**
 * Dọn bài kẹt ở trạng thái PUBLISHING.
 *
 * Trường hợp này xảy ra khi worker bị tắt đột ngột giữa lúc đăng. Ta KHÔNG tự
 * đăng lại vì không biết bài đã lên Facebook hay chưa — đăng lại sẽ tạo bài
 * trùng. Thay vào đó đánh dấu FAILED kèm hướng dẫn kiểm tra thủ công.
 */
async function recoverStaleLocks(now: Date): Promise<number> {
  const threshold = new Date(now.getTime() - STALE_LOCK_MS);
  const result = await prisma.post.updateMany({
    where: {
      status: "PUBLISHING",
      lockedAt: { lt: threshold },
    },
    data: {
      status: "FAILED",
      lockedAt: null,
      errorMessage:
        "Lần đăng trước bị dừng giữa chừng (worker tắt đột ngột). " +
        "Hãy kiểm tra trên Facebook xem bài đã lên chưa rồi mới bấm Đăng lại, " +
        "để tránh đăng trùng.",
    },
  });
  return result.count;
}

/**
 * Tìm các bài đến hạn: đã tới giờ hẹn và không đang chờ thử lại.
 *
 * LƯU Ý: KHÔNG lọc `pageId: { not: null }` ở đây. Nếu Page của bài bị xóa
 * (quan hệ đặt onDelete: SetNull nên pageId thành null), bài sẽ kẹt ở
 * SCHEDULED vĩnh viễn và người dùng không biết vì sao bài không đăng.
 * Cứ đưa vào rồi để phần kiểm tra bên dưới đánh dấu FAILED kèm lý do rõ ràng.
 */
async function findDuePosts(now: Date) {
  return prisma.post.findMany({
    where: {
      status: "SCHEDULED",
      scheduledAt: { lte: now },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    take: MAX_POSTS_PER_TICK,
    include: {
      media: { orderBy: { position: "asc" } },
      page: true,
    },
  });
}

/**
 * Chạy một vòng của worker: đăng tất cả bài đã đến hạn.
 *
 * Hàm này an toàn khi gọi chồng lên nhau (nhiều worker, hoặc cron gọi trùng):
 * mỗi bài chỉ được một tiến trình giành được nhờ updateMany có điều kiện.
 */
export async function runSchedulerTick(
  now: Date = new Date(),
  source: TickSource = "server"
): Promise<TickResult> {
  const result: TickResult = {
    claimed: 0,
    published: 0,
    retrying: 0,
    failed: 0,
    recovered: await recoverStaleLocks(now),
    details: [],
  };

  const duePosts = await findDuePosts(now);

  for (const post of duePosts) {
    const attemptNumber = post.attempts + 1;

    // --- Giành bài một cách nguyên tử ---
    // Điều kiện status = SCHEDULED đảm bảo chỉ một worker thắng.
    const claim = await prisma.post.updateMany({
      where: { id: post.id, status: "SCHEDULED" },
      data: {
        status: "PUBLISHING",
        lockedAt: now,
        attempts: attemptNumber,
        lastAttemptAt: now,
      },
    });

    if (claim.count !== 1) continue; // worker khác đã giành trước
    result.claimed += 1;

    const preview = post.content.slice(0, 60);

    // --- Tính trước các lỗi chặn, không cần gọi Facebook ---
    let blocking: string | null = null;
    if (!post.page) {
      blocking =
        "Page của bài này không còn tồn tại (có thể đã bị xóa). " +
        "Hãy vào Soạn bài chọn lại Page rồi hẹn lại giờ.";
    } else if (!post.page.isActive) {
      blocking = "Page đã bị tắt hoạt động — bật lại ở trang Facebook Pages.";
    } else if (
      post.page.tokenExpiresAt &&
      post.page.tokenExpiresAt.getTime() <= now.getTime()
    ) {
      blocking =
        "Token của Page đã hết hạn — vào trang Facebook Pages để đồng bộ lại token.";
    }

    if (blocking) {
      await prisma.post.update({
        where: { id: post.id },
        data: { status: "FAILED", lockedAt: null, nextAttemptAt: null, errorMessage: blocking },
      });
      result.failed += 1;
      result.details.push({
        postId: post.id,
        content: preview,
        outcome: "FAILED",
        message: blocking,
      });
      continue;
    }

    // --- Kiểm tra media trước khi gọi Facebook ---
    const media: AttachedMedia[] = post.media.map((m) => ({
      remoteUrl: m.remoteUrl,
      type: m.type === "VIDEO" ? "VIDEO" : "IMAGE",
      source: m.source === "PEXELS" ? "PEXELS" : m.source === "UPLOAD" ? "UPLOAD" : "URL",
      storageKey: m.storageKey ?? undefined,
      mimeType: m.mimeType ?? undefined,
    }));

    const check = validateAttachments(media);
    if (!check.ok) {
      await prisma.post.update({
        where: { id: post.id },
        data: {
          status: "FAILED",
          lockedAt: null,
          nextAttemptAt: null,
          errorMessage: `Media không hợp lệ: ${check.error}`,
        },
      });
      result.failed += 1;
      result.details.push({
        postId: post.id,
        content: preview,
        outcome: "FAILED",
        message: check.error,
      });
      continue;
    }

    // --- Gửi lên Facebook ---
    try {
      const fbPostId = await deliverToFacebook(
        post.userId,
        { fbPageId: post.page!.fbPageId, accessToken: post.page!.accessToken },
        buildMessage(post.content, post.hashtags),
        media
      );

      await prisma.post.update({
        where: { id: post.id },
        data: {
          status: "PUBLISHED",
          fbPostId,
          publishedAt: new Date(),
          lockedAt: null,
          nextAttemptAt: null,
          errorMessage: null,
        },
      });

      result.published += 1;
      result.details.push({ postId: post.id, content: preview, outcome: "PUBLISHED" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const canRetry = attemptNumber < MAX_ATTEMPTS && !isPermanentError(message);

      if (canRetry) {
        const delay = RETRY_DELAYS_MS[attemptNumber - 1] ?? RETRY_DELAYS_MS[0];
        await prisma.post.update({
          where: { id: post.id },
          data: {
            // Quay lại SCHEDULED kèm nextAttemptAt → lần chạy sau sẽ thử lại
            status: "SCHEDULED",
            lockedAt: null,
            nextAttemptAt: new Date(now.getTime() + delay),
            errorMessage: `${message} (sẽ thử lại lần ${attemptNumber + 1}/${MAX_ATTEMPTS} sau ${Math.round(
              delay / 60000
            )} phút)`,
          },
        });
        result.retrying += 1;
        result.details.push({
          postId: post.id,
          content: preview,
          outcome: "RETRY",
          message,
        });
      } else {
        await prisma.post.update({
          where: { id: post.id },
          data: {
            status: "FAILED",
            lockedAt: null,
            nextAttemptAt: null,
            errorMessage:
              attemptNumber >= MAX_ATTEMPTS
                ? `${message} (đã thử ${MAX_ATTEMPTS} lần, không thử lại nữa)`
                : message,
          },
        });
        result.failed += 1;
        result.details.push({
          postId: post.id,
          content: preview,
          outcome: "FAILED",
          message,
        });
      }
    }
  }

  // Ghi nhịp tim + nguồn chạy để giao diện biết scheduler còn sống và đang
  // chạy ở đâu (trong app, hay do worker/cron bên ngoài gọi vào)
  await Promise.all([
    setSetting(HEARTBEAT_KEY, new Date().toISOString()),
    setSetting(SOURCE_KEY, source),
  ]).catch(() => {
    // Không quan trọng nếu không ghi được
  });

  return result;
}

/** Nhịp tim cũ hơn mức này coi như worker đã tắt. */
export const WORKER_ALIVE_THRESHOLD_MS = 3 * 60 * 1000;

// ============================================================
// Kích hoạt bộ lập kế hoạch của chế độ tự động.
//
// Vì sao tách khỏi runSchedulerTick: lập kế hoạch phải gọi AI + Pexels, có thể
// mất hàng chục giây cho mỗi bài. Nếu chạy trong cùng luồng với việc đăng bài
// thì một provider AI chậm sẽ làm trễ toàn bộ bài đã tới giờ đăng.
//
// Giải pháp: chạy "bắn rồi quên" (fire-and-forget) với 2 lớp bảo vệ —
//   1. Giãn cách tối thiểu PLANNER_INTERVAL_MS giữa 2 lần lập kế hoạch.
//   2. Khóa chống chạy chồng bên trong runAutopilotPlannerSafely().
// ============================================================

/** Giãn cách giữa 2 lần lập kế hoạch (mặc định 5 phút). */
export const PLANNER_INTERVAL_MS = Number(
  process.env.PLANNER_INTERVAL_MS ?? 5 * 60 * 1000
);

const PLANNER_CLOCK = "__marketingPlannerLastRunAt" as const;

/**
 * Xin chạy bộ lập kế hoạch. KHÔNG chờ kết quả — trả về ngay.
 *
 * Gọi được từ cả vòng lặp trong app lẫn endpoint cron bên ngoài; lớp giãn
 * cách đảm bảo gọi dồn dập cũng chỉ chạy đúng một lần mỗi chu kỳ.
 *
 * @param force bỏ qua giãn cách (dùng cho nút "Lên kế hoạch ngay")
 */
export function kickAutopilotPlanner(force = false): boolean {
  const g = globalThis as Record<string, unknown>;
  const last = typeof g[PLANNER_CLOCK] === "number" ? (g[PLANNER_CLOCK] as number) : 0;
  const now = Date.now();

  if (!force && now - last < PLANNER_INTERVAL_MS) return false;
  g[PLANNER_CLOCK] = now;

  void (async () => {
    try {
      // Nạp động: giữ cho luồng đăng bài không phải tải sẵn AI/Pexels
      const { runAutopilotPlannerSafely } = await import("./autopilot");
      const result = await runAutopilotPlannerSafely(new Date());
      if (result && (result.created > 0 || result.skipped > 0)) {
        console.log(
          `[tự động] đã tạo ${result.created} bài cho ${result.pages.length} Page` +
            (result.skipped > 0 ? `, bỏ qua ${result.skipped} bài do lỗi` : "")
        );
        for (const page of result.pages) {
          if (page.error) console.warn(`[tự động] ${page.pageName}: ${page.error}`);
        }
      }
    } catch (err) {
      console.error(
        `[tự động] lỗi khi lập kế hoạch: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  })();

  return true;
}

// ============================================================
// Vòng lặp chạy NGAY TRONG tiến trình server web.
//
// Nhờ vậy không cần mở terminal chạy `npm run worker` nữa: chỉ cần app đang
// chạy là bài hẹn giờ được đăng. Vòng lặp được khởi động từ src/instrumentation.ts.
//
// Vẫn giữ endpoint /api/cron/tick cho ai muốn dùng cron hệ thống — worker gọi
// vào đó cũng ghi nhịp tim như nhau, nên giao diện báo đúng dù chạy cách nào.
// ============================================================

/** Khóa trên globalThis để hot-reload của dev không tạo nhiều vòng lặp. */
const LOOP_GUARD = "__marketingSchedulerLoop" as const;

type LoopGuard = { timer: NodeJS.Timeout; running: boolean; ticks: number };

/** Đang có vòng lặp nào chạy trong tiến trình này không. */
export function isLoopRunning(): boolean {
  return Boolean((globalThis as Record<string, unknown>)[LOOP_GUARD]);
}

/**
 * Khởi động vòng lặp scheduler trong tiến trình hiện tại.
 *
 * An toàn khi gọi nhiều lần: chỉ vòng lặp đầu tiên có hiệu lực. Dev server
 * hot-reload có thể gọi lại hàm này, nên phải chặn bằng globalThis.
 */
export function startSchedulerLoop(intervalMs: number = TICK_INTERVAL_MS): void {
  const g = globalThis as unknown as Record<string, LoopGuard | undefined>;
  if (g[LOOP_GUARD]) return; // đã có vòng lặp

  const guard: LoopGuard = {
    ticks: 0,
    running: false,
    timer: setInterval(() => {
      // Bỏ qua nhịp nếu nhịp trước chưa xong (bài đăng lâu hơn chu kỳ)
      if (guard.running) return;
      guard.running = true;
      void (async () => {
        try {
          if (!(await isSchedulerEnabled())) return;

          // Lập kế hoạch chạy song song, KHÔNG chờ — để bài tới giờ đăng ngay
          kickAutopilotPlanner();

          const result = await runSchedulerTick(new Date(), "server");
          guard.ticks += 1;
          if (result.published || result.retrying || result.failed || result.recovered) {
            console.log(
              `[scheduler] xử lý ${result.claimed} bài — thành công ${result.published}, ` +
                `thử lại ${result.retrying}, lỗi ${result.failed}, gỡ kẹt ${result.recovered}`
            );
          }
        } catch (err) {
          // Không được để lỗi làm chết vòng lặp
          console.error(
            `[scheduler] lỗi khi chạy: ${err instanceof Error ? err.message : String(err)}`
          );
        } finally {
          guard.running = false;
        }
      })();
    }, intervalMs),
  };

  // Không giữ tiến trình sống chỉ vì vòng lặp này (ví dụ khi chạy script ngắn)
  guard.timer.unref?.();

  g[LOOP_GUARD] = guard;

  console.log(
    `[scheduler] đã bật vòng lặp tự động đăng trong app, kiểm tra mỗi ${Math.round(
      intervalMs / 1000
    )} giây`
  );

  // Chạy ngay một nhịp đầu để bài quá hạn không phải chờ hết chu kỳ
  void (async () => {
    try {
      if (!(await isSchedulerEnabled())) return;
      kickAutopilotPlanner();
      const result = await runSchedulerTick(new Date(), "server");
      guard.ticks += 1;
      if (result.published || result.retrying || result.failed || result.recovered) {
        console.log(
          `[scheduler] nhịp đầu — thành công ${result.published}, thử lại ${result.retrying}, lỗi ${result.failed}`
        );
      }
    } catch {
      // Bỏ qua — nhịp định kỳ sẽ thử lại
    }
  })();
}

export type SchedulerStatus = {
  lastRunAt: string | null;
  /** Số bài đang chờ đến giờ. */
  pending: number;
  /** Bài chờ thử lại sau lỗi. */
  awaitingRetry: number;
  /** Bài hẹn gần nhất trong tương lai. */
  nextScheduledAt: string | null;
  /**
   * Worker còn sống không. Tính sẵn ở server để component chỉ việc hiển thị —
   * gọi Date.now() trong lúc render là hàm không thuần (react-hooks/purity).
   */
  workerAlive: boolean;
  /** Số phút kể từ nhịp tim gần nhất; null nếu chưa từng chạy. */
  minutesSinceLastRun: number | null;
  /** Tự động đăng có đang được bật không (người dùng tắt được trên web). */
  enabled: boolean;
  /** Vòng lặp đang chạy ở đâu: trong app web, hay do worker/cron ngoài gọi vào. */
  source: TickSource | null;
};

/** Thông tin trạng thái scheduler cho trang Lịch đăng. */
export async function getSchedulerStatus(userId: string): Promise<SchedulerStatus> {
  const [lastRunAt, source, enabled, pending, awaitingRetry, next] = await Promise.all([
    getSetting(HEARTBEAT_KEY),
    getSetting(SOURCE_KEY),
    isSchedulerEnabled(),
    prisma.post.count({
      where: { userId, status: "SCHEDULED", nextAttemptAt: null },
    }),
    prisma.post.count({
      where: { userId, status: "SCHEDULED", nextAttemptAt: { not: null } },
    }),
    prisma.post.findFirst({
      where: { userId, status: "SCHEDULED", scheduledAt: { gt: new Date() } },
      orderBy: { scheduledAt: "asc" },
      select: { scheduledAt: true },
    }),
  ]);

  const lastRun = lastRunAt ? new Date(lastRunAt) : null;
  const ageMs = lastRun ? Date.now() - lastRun.getTime() : Infinity;

  return {
    lastRunAt,
    pending,
    awaitingRetry,
    nextScheduledAt: next?.scheduledAt?.toISOString() ?? null,
    workerAlive: ageMs < WORKER_ALIVE_THRESHOLD_MS,
    minutesSinceLastRun: lastRun ? Math.floor(ageMs / 60000) : null,
    enabled,
    source: (source as TickSource | null) ?? null,
  };
}
