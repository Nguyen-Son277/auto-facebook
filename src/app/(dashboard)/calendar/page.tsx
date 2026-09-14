import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { getSchedulerStatus } from "@/lib/scheduler";
import PageHeader from "@/components/page-header";
import CalendarBoard, { type CalendarPost } from "@/components/calendar-board";
import { vnTime, vnYearMonth } from "@/lib/autopilot-plan";

// ============================================================
// Trang Lịch đăng — xem bài theo tháng, đổi lịch, hủy lịch, đăng ngay.
// ============================================================

/** Nhận "YYYY-MM" từ URL; trả về tháng hiện tại nếu thiếu hoặc sai định dạng. */
function parseMonth(raw?: string): { year: number; month: number } {
  const now = new Date();
  if (raw && /^\d{4}-\d{2}$/.test(raw)) {
    const [y, m] = raw.split("-").map(Number);
    if (m >= 1 && m <= 12 && y >= 2000 && y <= 2100) return { year: y, month: m };
  }
  // Tháng hiện tại theo LỊCH Việt Nam — Vercel chạy UTC nên getMonth() trần sẽ
  // trả về tháng trước vào 7 giờ đầu ngày mùng 1.
  return vnYearMonth(now);
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await requireCurrentUser();
  const sp = await searchParams;
  const { year, month } = parseMonth(sp.month);

  // Biên của tháng, mở rộng thêm 7 ngày mỗi phía để lấp các ô của tuần liền kề.
  // Tính bằng giờ Việt Nam tường minh — `new Date(y, m, d)` phụ thuộc múi giờ
  // máy chạy nên trên Vercel (UTC) sẽ lệch 7 tiếng và lấy sai khoảng bài.
  const rangeStart = vnTime(year, month - 1, 1 - 7);
  // 23:59:59.999 ngày cuối cùng của khoảng = 1ms trước mốc 00:00 kế tiếp
  const rangeEnd = new Date(vnTime(year, month, 1 + 7).getTime() - 1);

  const [posts, status, pages] = await Promise.all([
    prisma.post.findMany({
      where: {
        userId: user.id,
        status: { not: "DRAFT" },
        OR: [
          { scheduledAt: { gte: rangeStart, lte: rangeEnd } },
          { publishedAt: { gte: rangeStart, lte: rangeEnd } },
        ],
      },
      orderBy: [{ scheduledAt: "asc" }, { publishedAt: "asc" }],
      take: 400,
      include: {
        page: { select: { name: true } },
        _count: { select: { media: true } },
      },
    }),
    getSchedulerStatus(user.id),
    prisma.facebookPage.count({ where: { userId: user.id, isActive: true } }),
  ]);

  const rows: CalendarPost[] = posts.map((p) => ({
    id: p.id,
    content: p.content,
    status: p.status,
    // Bài đã đăng nằm ở ngày đăng thực tế; bài chờ thì ở ngày hẹn
    at: (p.scheduledAt ?? p.publishedAt)?.toISOString() ?? p.createdAt.toISOString(),
    scheduledAt: p.scheduledAt?.toISOString() ?? null,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    pageName: p.page?.name ?? null,
    mediaCount: p._count.media,
    errorMessage: p.errorMessage,
    attempts: p.attempts,
    fbPostId: p.fbPostId,
    origin: p.origin,
    pillarName: p.pillarName,
  }));

  return (
    <div>
      <PageHeader
        title="Lịch đăng"
        description="Xem bài đã hẹn theo tháng, đổi lịch hoặc đăng ngay. Bài 🤖 là do chế độ tự động viết."
      />

      <CalendarBoard
        year={year}
        month={month}
        posts={rows}
        scheduler={status}
        hasActivePage={pages > 0}
      />
    </div>
  );
}
