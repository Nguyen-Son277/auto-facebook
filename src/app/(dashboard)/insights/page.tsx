import Link from "next/link";
import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { loadInsightsPageView, loadLearningView } from "@/lib/insights-view";
import PageHeader from "@/components/page-header";
import InsightsDashboard from "@/components/insights-dashboard";

// ============================================================
// Trang Số liệu & tự tối ưu — /insights
//
// Server component nạp dữ liệu, client component chỉ lo tương tác (nút bấm).
// Cùng cách chia với trang /autopilot: mọi truy vấn DB ở server, không lộ
// thông tin qua client.
//
// ?page=<id> chọn Page cần xem; không có thì lấy Page đầu tiên đã bật tối ưu,
// hoặc Page đầu tiên nếu chưa Page nào bật.
// ============================================================

export const dynamic = "force-dynamic";

export default async function InsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requireCurrentUser();
  const sp = await searchParams;

  const pages = await prisma.facebookPage.findMany({
    where: { userId: user.id, isActive: true },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      insightsStatus: true,
      autopilot: { select: { insightsEnabled: true } },
    },
  });

  if (pages.length === 0) {
    return (
      <div>
        <PageHeader
          title="Số liệu & tự tối ưu"
          description="Đọc số liệu thật của bài đã đăng để biết nội dung nào đang được người xem quan tâm."
        />
        <div
          className="rounded-xl border border-dashed border-gray-300 p-8 text-center"
          data-testid="insights-no-page"
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

  // Ưu tiên Page được chọn trên URL; nếu không có thì Page đã bật tối ưu đầu
  // tiên (đó là Page người dùng quan tâm nhất), cuối cùng mới tới Page đầu.
  const selected =
    pages.find((p) => p.id === sp.page) ??
    pages.find((p) => p.autopilot?.insightsEnabled) ??
    pages[0];

  const now = new Date();
  const [view, learning] = await Promise.all([
    loadInsightsPageView(user.id, selected.id),
    loadLearningView(selected.id, now),
  ]);

  if (!view) {
    return (
      <div>
        <PageHeader title="Số liệu & tự tối ưu" description="" />
        <p className="text-sm text-red-600">Không đọc được Page này.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Số liệu & tự tối ưu"
        description="Xem nội dung nào đang được người xem quan tâm, và AutoPilot đang điều chỉnh bài viết theo hướng nào."
      />

      {/* Chọn Page — mỗi Page có số liệu và vòng học riêng */}
      <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="insights-page-picker">
        <span className="text-xs font-medium text-gray-500">Page:</span>
        {pages.map((p) => (
          <Link
            key={p.id}
            href={`/insights?page=${p.id}`}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              p.id === selected.id
                ? "border-blue-300 bg-blue-50 text-blue-700"
                : "border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            {p.name}
            {p.autopilot?.insightsEnabled ? (
              <span className="ml-1 text-emerald-600" title="Đang bật tự tối ưu">
                ●
              </span>
            ) : null}
          </Link>
        ))}
        <Link
          href={`/autopilot?page=${selected.id}`}
          className="ml-auto text-xs text-blue-600 hover:underline"
        >
          ← Về cấu hình tự động đăng
        </Link>
      </div>

      <InsightsDashboard view={view} learning={learning} />
    </div>
  );
}
