import Link from "next/link";
import { requireCurrentUser, resolveWorkspace } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import PageHeader from "@/components/page-header";
import BrandEditor from "@/components/brand-editor";
import BrandListClient from "./brand-list-client";

// ============================================================
// Trang Thương hiệu — quản lý NHIỀU thương hiệu trong workspace.
//
// Mỗi thương hiệu: hồ sơ + trụ cột + kho tài liệu dùng chung cho
// mọi Page gắn với nó. Chọn brand bằng ?brand=<id>.
// ============================================================

export default async function BrandPage({
  searchParams,
}: {
  searchParams: Promise<{ ws?: string; brand?: string }>;
}) {
  await requireCurrentUser();
  const sp = await searchParams;
  const ctx = await resolveWorkspace(sp.ws ?? null);

  const [brands, pages] = await Promise.all([
    prisma.brand.findMany({
      where: { workspaceId: ctx.workspace.id },
      orderBy: { createdAt: "asc" },
      include: {
        _count: { select: { pages: true, pillars: true, docs: true, posts: true } },
        profile: true,
        pillars: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] },
        docs: { orderBy: { createdAt: "desc" } },
      },
    }),
    prisma.facebookPage.findMany({
      where: { workspaceId: ctx.workspace.id, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, brandId: true },
    }),
  ]);

  const selected = brands.find((b) => b.id === sp.brand) ?? null;

  return (
    <div>
      <PageHeader
        title="Thương hiệu"
        description="Tạo và quản lý nhiều thương hiệu — mỗi thương hiệu một bộ hồ sơ, trụ cột nội dung và kho tài liệu dùng chung cho mọi Page."
      />

      {brands.length === 0 ? (
        <div
          className="rounded-xl border border-dashed border-gray-300 p-8 text-center"
          data-testid="brand-empty"
        >
          <p className="text-gray-600">Chưa có thương hiệu nào trong workspace này.</p>
          <p className="mt-1 text-sm text-gray-500">
            Tạo thương hiệu đầu tiên — bạn có thể thêm nhiều thương hiệu khác nhau, mỗi thương hiệu gắn với một hoặc nhiều Page Facebook.
          </p>
        </div>
      ) : null}

      <BrandListClient
        workspaceId={ctx.workspace.id}
        brands={brands.map((b) => ({
          id: b.id,
          name: b.name,
          slug: b.slug,
          description: b.description,
          pageCount: b._count.pages,
          pillarCount: b._count.pillars,
          docCount: b._count.docs,
          postCount: b._count.posts,
          profileFilled: b.profile
            ? [b.profile.description, b.profile.products, b.profile.audience, b.profile.industry, b.profile.priceRange]
                .filter((v) => v && v.trim()).length
            : 0,
        }))}
        pages={pages}
        selectedBrandId={selected?.id ?? null}
      />

      {selected ? (
        <>
          <div
            className="mt-6 mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 px-4 py-3 text-sm"
            data-testid="brand-summary"
          >
            <span className="font-medium text-gray-900">{selected.name}</span>
            <span className="text-gray-400">·</span>
            <span className={selected.profile && [
              selected.profile.description, selected.profile.products, selected.profile.audience,
              selected.profile.industry, selected.profile.priceRange,
            ].filter((v) => v && v.trim()).length >= 3 ? "text-emerald-700" : "text-amber-700"}>
              {selected.profile && [
                selected.profile.description, selected.profile.products, selected.profile.audience,
                selected.profile.industry, selected.profile.priceRange,
              ].filter((v) => v && v.trim()).length >= 3
                ? "✓ Hồ sơ đã đủ dùng"
                : "⚠ Hồ sơ còn thiếu thông tin — AI càng biết nhiều, bài càng đúng"}
            </span>
            <span className="text-gray-400">·</span>
            <span className="text-gray-600">
              {selected._count.pillars} trụ cột · {selected._count.docs} tài liệu · {selected._count.pages} Page
            </span>
          </div>

          {/* ===== Pages thuộc thương hiệu ===== */}
          <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4" data-testid="brand-pages-panel">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Page thuộc thương hiệu</h3>
              <span className="text-xs text-gray-500">
                {pages.filter((p) => p.brandId === selected.id).length} Page gắn vào thương hiệu này
              </span>
            </div>
            {pages.filter((p) => p.brandId === selected.id).length === 0 ? (
              <p className="text-sm text-gray-500">
                Chưa có Page nào. Gán Page ở{" "}
                <Link href="/pages" className="font-medium text-blue-600 hover:underline">
                  trang Pages
                </Link>{" "}
                để nội dung thương hiệu áp dụng cho Page đó.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {pages
                  .filter((p) => p.brandId === selected.id)
                  .map((p) => (
                    <span key={p.id} className="rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-800">
                      {p.name}
                    </span>
                  ))}
              </div>
            )}
          </div>

          <BrandEditor
            brandId={selected.id}
            profile={selected.profile}
            pillars={selected.pillars.map((p) => ({
              id: p.id,
              name: p.name,
              description: p.description,
              goal: p.goal,
              weight: p.weight,
              enabled: p.enabled,
            }))}
            docs={selected.docs.map((d) => ({
              id: d.id,
              title: d.title,
              kind: d.kind,
              content: d.content,
              enabled: d.enabled,
              length: d.content.length,
            }))}
          />
        </>
      ) : null}

      {brands.length === 0 ? null : (
        <p className="mt-4 text-sm text-gray-500">
          Xong hồ sơ?{" "}
          <Link href="/autopilot" className="font-medium text-blue-600 hover:underline">
            Bật chế độ tự động →
          </Link>{" "}
          để hệ thống tự viết và đăng theo lịch bạn đặt.
        </p>
      )}
    </div>
  );
}
