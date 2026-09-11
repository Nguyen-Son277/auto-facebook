import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { getSchedulerStatus } from "@/lib/scheduler";
import PageHeader from "@/components/page-header";
import CalendarBoard, { type CalendarPost } from "@/components/calendar-board";

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
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await requireCurrentUser();
  const sp = await searchParams;
  const { year, month } = parseMonth(sp.month);

  // Biên của tháng, mở rộng thêm 7 ngày mỗi phía để lấp các ô của tuần liền kề
  const monthStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const rangeStart = new Date(monthStart);
  rangeStart.setDate(rangeStart.getDate() - 7);
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
  const rangeEnd = new Date(monthEnd);
  rangeEnd.setDate(rangeEnd.getDate() + 7);

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
