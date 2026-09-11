import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { getFacebookConfig } from "@/lib/settings";
import PageHeader from "@/components/page-header";
import SyncPagesForm from "@/components/sync-pages-form";
import {
  PageDeleteButton,
  PageToggleActiveButton,
} from "@/components/page-actions";

/** Tính số ngày còn lại của token (hàm thuần, tách khỏi render). */
function daysUntil(date: Date): number {
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 86_400_000));
}

export default async function PagesPage() {
  const user = await requireCurrentUser();
  const [pages, fbConfig] = await Promise.all([
    prisma.facebookPage.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    }),
    getFacebookConfig(),
  ]);

  const tokenExpiry = fbConfig.userTokenExpiresAt
    ? new Date(Number(fbConfig.userTokenExpiresAt))
    : null;
  const daysLeft = tokenExpiry ? daysUntil(tokenExpiry) : null;

  return (
    <div>
      <PageHeader
        title="Facebook Pages"
        description="Các Page Facebook sẽ nhận bài đăng tự động từ hệ thống"
      />

      <SyncPagesForm hasToken={Boolean(fbConfig.userToken)} />

      {tokenExpiry && daysLeft !== null && (
        <p className="mt-3 text-xs text-gray-500">
          🔑 User token hết hạn sau ~{daysLeft} ngày
          {daysLeft <= 7 ? " — sắp hết hạn, hãy đồng bộ lại bằng token mới!" : ""}
        </p>
      )}

      <div className="mt-6 space-y-3">
        {pages.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 text-3xl">
              📄
            </div>
            <h2 className="text-lg font-semibold text-gray-900">Chưa có Page nào</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
              Đồng bộ Pages phía trên để import danh sách Page bạn quản lý. Sau đó có thể
              đăng bài ngay ở trang Soạn bài.
            </p>
          </div>
        ) : (
          pages.map((page) => (
            <div
              key={page.id}
              className="flex flex-wrap items-center gap-4 rounded-2xl border border-gray-200 bg-white p-4"
            >
              {page.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={page.avatarUrl} alt="" className="h-12 w-12 rounded-xl object-cover" />
              ) : (
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-xl">
                  📄
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-gray-900">{page.name}</p>
                <p className="truncate text-sm text-gray-500">
                  {page.category ?? "—"} · ID: {page.fbPageId}
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  page.isActive
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-gray-100 text-gray-500"
                }`}
              >
                {page.isActive ? "Hoạt động" : "Tạm dừng"}
              </span>
              <div className="flex gap-2">
                <PageToggleActiveButton pageId={page.id} isActive={page.isActive} />
                <PageDeleteButton pageId={page.id} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
