import Link from "next/link";
import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { getAutoPilotOverview } from "@/lib/autopilot";
import { getPexelsQuota } from "@/lib/pexels";
import PageHeader from "@/components/page-header";
import AutopilotDashboard from "@/components/autopilot-dashboard";

// ============================================================
// Trang Chế độ tự động.
//
// Mục tiêu: người dùng đặt vài thông số rồi không phải làm gì nữa.
// ============================================================

export default async function AutopilotPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requireCurrentUser();
  const sp = await searchParams;

  const pages = await prisma.facebookPage.findMany({
    where: { userId: user.id, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });

  if (pages.length === 0) {
    return (
      <div>
        <PageHeader
          title="Tự động đăng"
          description="Đặt thông số một lần, hệ thống tự viết nội dung và đăng liên tục."
        />
        <div
          className="rounded-xl border border-dashed border-gray-300 p-8 text-center"
          data-testid="ap-no-page"
        >
          <p className="text-gray-600">Bạn chưa kết nối Facebook Page nào.</p>
          <Link
            href="/pages"
            className="mt-3 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Kết nối Page ngay
          </Link>
        </div>
      </div>
    );
  }

  const selected = pages.find((p) => p.id === sp.page) ?? pages[0];

  const [overview, pillarCount, profile] = await Promise.all([
    getAutoPilotOverview(user.id, selected.id),
    prisma.contentPillar.count({ where: { pageId: selected.id, enabled: true } }),
    prisma.brandProfile.findUnique({
      where: { pageId: selected.id },
      select: { description: true, products: true },
    }),
  ]);

  // Đọc hạn mức Pexels (từ header thật nếu đã gọi lần nào trong tiến trình này)
  const quota = getPexelsQuota();

  const config = overview.config;

  return (
    <div>
      <PageHeader
        title="Tự động đăng"
        description="Đặt số bài mỗi ngày và khung giờ — hệ thống lo phần còn lại."
      />

      {pages.length > 1 ? (
        <div className="mb-4 flex flex-wrap gap-2" data-testid="ap-page-switcher">
          {pages.map((p) => (
            <Link
              key={p.id}
              href={`/autopilot?page=${p.id}`}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                p.id === selected.id
                  ? "bg-blue-600 text-white"
                  : "border border-gray-300 text-gray-700 hover:bg-gray-50"
              }`}
            >
              {p.name}
            </Link>
          ))}
        </div>
      ) : null}

      <p className="mb-4 text-sm text-gray-600">
        Đang cấu hình cho <span className="font-medium text-gray-900">{selected.name}</span>
      </p>

      <AutopilotDashboard
        pageId={selected.id}
        config={
          config
            ? {
                enabled: config.enabled,
                mode: config.mode,
                postsPerDay: config.postsPerDay,
                windowStart: config.windowStart,
                windowEnd: config.windowEnd,
                daysOfWeek: config.daysOfWeek,
                minGapMinutes: config.minGapMinutes,
                autoMedia: config.autoMedia,
                mediaKind: config.mediaKind,
                mediaMix: config.mediaMix,
                videoPercent: config.videoPercent,
                photosPerPost: config.photosPerPost,
                length: config.length,
                toneOverride: config.toneOverride,
                useHashtags: config.useHashtags,
                planAheadDays: config.planAheadDays,
                lastPlannedAt: config.lastPlannedAt?.toISOString() ?? null,
                lastPlanError: config.lastPlanError,
                totalPlanned: config.totalPlanned,
              }
            : null
        }
        posts={overview.upcoming}
        pendingReview={overview.pendingReview}
        quota={quota}
        readiness={{
          pillars: pillarCount,
          hasProfile: Boolean(profile?.description?.trim() || profile?.products?.trim()),
        }}
      />
    </div>
  );
}
