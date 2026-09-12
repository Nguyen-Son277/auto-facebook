import Link from "next/link";
import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { getAutoPilotOverview, listAutoPilotConfigs } from "@/lib/autopilot";
import { getPexelsQuota } from "@/lib/pexels";
import PageHeader from "@/components/page-header";
import AutopilotDashboard from "@/components/autopilot-dashboard";
import AutopilotListClient from "./autopilot-list-client";

// ============================================================
// Trang Tự động đăng — quản lý NHIỆU cấu hình cùng lúc.
//
// Mặc định: bảng tổng quan mọi Page (mỗi Page một cấu hình) với
// bật/tắt nhanh. ?page=<id> → bảng điều khiển chi tiết như cũ.
// ============================================================

export default async function AutopilotPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requireCurrentUser();
  const sp = await searchParams;

  const [configs, totalPages] = await Promise.all([
    listAutoPilotConfigs(user.id),
    prisma.facebookPage.count({ where: { userId: user.id, isActive: true } }),
  ]);

  if (totalPages === 0) {
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

  const activeCount = configs.filter((c) => c.enabled).length;
  const selected = configs.find((c) => c.pageId === sp.page) ?? null;

  // ===== Chế độ chi tiết một Page (?page=) =====
  if (selected) {
    const [overview, pillarCount, page] = await Promise.all([
      getAutoPilotOverview(user.id, selected.pageId),
      selected.brandId
        ? prisma.contentPillar.count({ where: { brandId: selected.brandId, enabled: true } })
        : prisma.contentPillar.count({ where: { pageId: selected.pageId, enabled: true } }),
      prisma.brandProfile.findFirst({
        where: selected.brandId
          ? { brandId: selected.brandId }
          : { brand: { pages: { some: { id: selected.pageId } } } },
        select: { description: true, products: true },
      }),
    ]);

    const quota = getPexelsQuota();
    const config = overview.config;

    return (
      <div>
        <PageHeader
          title="Tự động đăng"
          description="Đặt số bài mỗi ngày và khung giờ — hệ thống lo phần còn lại."
        />

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Link
            href="/autopilot"
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            data-testid="ap-back-to-list"
          >
            ← Danh sách cấu hình
          </Link>
          <span className="text-sm text-gray-600">
            Đang cấu hình cho <span className="font-medium text-gray-900">{selected.pageName}</span>
            {selected.brandName ? (
              <span className="text-gray-400"> · thương hiệu {selected.brandName}</span>
            ) : null}
          </span>
        </div>

        <AutopilotDashboard
          pageId={selected.pageId}
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
            hasProfile: Boolean(page?.description?.trim() || page?.products?.trim()),
          }}
        />
      </div>
    );
  }

  // ===== Mặc định: bảng quản lý mọi cấu hình =====
  return (
    <div>
      <PageHeader
        title="Tự động đăng"
        description="Mỗi Page một cấu hình — bật/tắt riêng lẻ hoặc tất cả cùng lúc."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="ap-summary">
        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
          {configs.length} Page · {activeCount} đang chạy
        </span>
        {configs.some((c) => c.lastPlanError) ? (
          <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-700">
            ⚠ Có cấu hình đang lỗi
          </span>
        ) : null}
      </div>

      <AutopilotListClient configs={configs} />
    </div>
  );
}
