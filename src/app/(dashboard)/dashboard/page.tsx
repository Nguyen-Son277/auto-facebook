import Link from "next/link";
import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import PageHeader from "@/components/page-header";
import SchedulerBanner from "@/components/scheduler-banner";
import { getSchedulerStatus } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireCurrentUser();

  const [pagesCount, postsTotal, published, scheduled, drafts, recentPosts, scheduler] =
    await Promise.all([
      prisma.facebookPage.count({ where: { userId: user.id, isActive: true } }),
      prisma.post.count({ where: { userId: user.id } }),
      prisma.post.count({ where: { userId: user.id, status: "PUBLISHED" } }),
      prisma.post.count({ where: { userId: user.id, status: "SCHEDULED" } }),
      prisma.post.count({ where: { userId: user.id, status: "DRAFT" } }),
      prisma.post.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { page: true, media: true },
      }),
      getSchedulerStatus(user.id),
    ]);

  const stats = [
    { label: "Pages đã kết nối", value: pagesCount, icon: "📄", href: "/pages" },
    { label: "Tổng số bài", value: postsTotal, icon: "📝", href: "/calendar" },
    { label: "Đã đăng", value: published, icon: "✅", href: "/calendar" },
    { label: "Đang chờ lịch", value: scheduled, icon: "⏰", href: "/calendar" },
  ];

  const statusBadge: Record<string, { label: string; cls: string }> = {
    DRAFT: { label: "Nháp", cls: "bg-gray-100 text-gray-600" },
    SCHEDULED: { label: "Đã lên lịch", cls: "bg-amber-100 text-amber-700" },
    PUBLISHING: { label: "Đang đăng", cls: "bg-blue-100 text-blue-700" },
    PUBLISHED: { label: "Đã đăng", cls: "bg-emerald-100 text-emerald-700" },
    FAILED: { label: "Lỗi", cls: "bg-red-100 text-red-700" },
  };

  return (
    <div>
      <PageHeader
        title={`Xin chào, ${user.name ?? "bạn"} 👋`}
        description="Tổng quan hoạt động đăng bài của bạn"
      />

      {/* Thẻ thống kê */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-blue-300 hover:shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className="text-2xl" aria-hidden>
                {s.icon}
              </span>
              <span className="text-3xl font-bold text-gray-900">{s.value}</span>
            </div>
            <p className="mt-2 text-sm text-gray-500">{s.label}</p>
          </Link>
        ))}
      </div>

      {/* Quick actions */}
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <Link
          href="/composer"
          className="rounded-2xl border border-blue-200 bg-blue-50 p-5 transition hover:bg-blue-100"
        >
          <span className="text-2xl" aria-hidden>✍️</span>
          <p className="mt-2 font-semibold text-blue-900">Soạn bài mới</p>
          <p className="text-sm text-blue-700">AI viết nội dung + tìm media</p>
        </Link>
        <Link
          href="/pages"
          className="rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-blue-300"
        >
          <span className="text-2xl" aria-hidden>🔗</span>
          <p className="mt-2 font-semibold text-gray-900">Kết nối Page</p>
          <p className="text-sm text-gray-500">Thêm Page Facebook để đăng bài</p>
        </Link>
        <Link
          href="/calendar"
          className="rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-blue-300"
        >
          <span className="text-2xl" aria-hidden>📅</span>
          <p className="mt-2 font-semibold text-gray-900">Lịch đăng</p>
          <p className="text-sm text-gray-500">Xem các bài đã lên lịch</p>
        </Link>
      </div>

      <SchedulerBanner status={scheduler} canManage={user.role === "ADMIN"} />

      {/* Bài đăng gần đây */}
      <div className="mt-8 rounded-2xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="font-semibold text-gray-900">Bài đăng gần đây</h2>
          <Link
            href="/calendar"
            className="text-sm font-medium text-blue-600 hover:underline"
          >
            Xem tất cả →
          </Link>
        </div>

        {recentPosts.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-gray-500">
            Chưa có bài nào. Bắt đầu bằng cách{" "}
            <Link href="/composer" className="font-medium text-blue-600 hover:underline">
              soạn bài mới
            </Link>
            .
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {recentPosts.map((post) => {
              const badge = statusBadge[post.status] ?? statusBadge.DRAFT;
              return (
                <li key={post.id} className="flex items-center gap-4 px-5 py-3">
                  {post.media[0]?.previewUrl || post.media[0]?.remoteUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={post.media[0].previewUrl ?? post.media[0].remoteUrl}
                      alt=""
                      className="h-10 w-10 rounded-lg object-cover"
                    />
                  ) : (
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-lg">
                      📝
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {post.content || "(Chưa có nội dung)"}
                    </p>
                    <p className="text-xs text-gray-500">
                      {post.page?.name ?? "Chưa chọn Page"} ·{" "}
                      {new Date(post.createdAt).toLocaleString("vi-VN")}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${badge.cls}`}
                  >
                    {badge.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {drafts > 0 && (
        <p className="mt-4 text-sm text-gray-500">
          Bạn có {drafts} bản nháp chưa hoàn thành.
        </p>
      )}
    </div>
  );
}
