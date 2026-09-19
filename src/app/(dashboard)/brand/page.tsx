import Link from "next/link";
import { requireCurrentUser, resolveWorkspace } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import PageHeader from "@/components/page-header";
import BrandEditor from "@/components/brand-editor";
import BrandPagesPanel from "@/components/brand-pages-panel";
import BrandDrivePanel from "@/components/brand-drive-panel";
import BrandListClient from "./brand-list-client";
import { getBrandDriveFolder, getDriveStatus } from "@/app/actions/drive";

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

  // Nguồn Google Drive: trạng thái kết nối + thư mục của brand đang chọn.
  // Chỉ truy vấn khi có brand được chọn để không tốn công vô ích.
  const [driveStatus, brandDrive] = await Promise.all([
    getDriveStatus(),
    selected
      ? getBrandDriveFolder(selected.id)
      : Promise.resolve({
          linked: false,
          folderId: null,
          folderName: null,
          lastError: null,
          connectionStatus: null,
          fileCount: null,
          contentWarning: null,
        }),
  ]);

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

          {/* ===== Pages thuộc thương hiệu — gán/bỏ gán ngay tại đây ===== */}
          <BrandPagesPanel brandId={selected.id} pages={pages} />

          {/* ===== Thư mục Google Drive riêng của thương hiệu (không bắt buộc) ===== */}
          <BrandDrivePanel
            brandId={selected.id}
            state={brandDrive}
            driveConnected={driveStatus.connected}
            pickerReady={driveStatus.pickerReady}
            pickerApiKey={process.env.GOOGLE_PICKER_API_KEY ?? ""}
            fullDriveRead={driveStatus.fullDriveRead}
          />

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
