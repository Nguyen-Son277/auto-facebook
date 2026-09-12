import { requireCurrentUser, resolveWorkspace } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
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
  const ctx = await resolveWorkspace(null);

  const [pages, connections, brands] = await Promise.all([
    prisma.facebookPage.findMany({
      where: { userId: user.id, workspaceId: ctx.workspace.id },
      orderBy: { createdAt: "asc" },
      include: { connection: { select: { id: true, name: true } } },
    }),
    prisma.facebookConnection.findMany({
      where: { workspaceId: ctx.workspace.id },
      select: { id: true, name: true, appId: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.brand.findMany({
      where: { workspaceId: ctx.workspace.id },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const brandNameOf = (brandId: string | null) =>
    brands.find((b) => b.id === brandId)?.name ?? null;

  return (
    <div>
      <PageHeader
        title="Facebook Pages"
        description={`Các Page Facebook sẽ nhận bài đăng tự động — workspace ${ctx.workspace.name}`}
      />

      <SyncPagesForm
        hasToken={connections.some((c) => c.id)}
        connections={connections.map((c) => ({ id: c.id, name: c.name, appId: c.appId }))}
      />

      <div className="mt-6 space-y-3">
        {pages.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 text-3xl">
              📄
            </div>
            <h2 className="text-lg font-semibold text-gray-900">Chưa có Page nào</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
              Đồng bộ Pages phía trên để import danh sách Page bạn quản lý. Mỗi
              Facebook App lấy được một nhóm Page — thêm nhiều App ở trang{" "}
              <a href="/facebook-apps" className="text-blue-600 hover:underline">
                Facebook Apps
              </a>{" "}
              để quản lý nhiều Page hơn.
            </p>
          </div>
        ) : (
          pages.map((page) => {
            const daysLeft = page.tokenExpiresAt
              ? daysUntil(page.tokenExpiresAt)
              : null;
            const brandName = brandNameOf(page.brandId);
            return (
              <div
                key={page.id}
                className="flex flex-wrap items-center gap-4 rounded-2xl border border-gray-200 bg-white p-4"
                data-testid={`page-card-${page.fbPageId}`}
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
                  <p className="font-semibold text-gray-900">
                    {page.name}
                    {brandName && (
                      <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                        🏷️ {brandName}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-sm text-gray-500">
                    {page.category ?? "—"} · ID: {page.fbPageId}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {page.connection ? (
                      <>🔗 App: {page.connection.name}</>
                    ) : (
                      <span className="text-yellow-600">
                        ⚠️ Chưa gắn Facebook App — đồng bộ lại để gắn
                      </span>
                    )}
                    {daysLeft !== null && ` · Token còn ~${daysLeft} ngày`}
                    {daysLeft !== null && daysLeft <= 7 && (
                      <span className="text-yellow-600"> — sắp hết hạn!</span>
                    )}
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
            );
          })
        )}
      </div>
    </div>
  );
}
