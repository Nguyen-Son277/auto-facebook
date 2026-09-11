import Link from "next/link";
import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import PageHeader from "@/components/page-header";
import BrandEditor from "@/components/brand-editor";

// ============================================================
// Trang Hồ sơ thương hiệu.
//
// "Nơi chứa tài liệu cơ bản về trang Facebook" — nhập một lần, AI dùng mãi.
// Chọn Page bằng ?page=<id>; nếu chỉ có một Page thì tự chọn luôn.
// ============================================================

export default async function BrandPage({
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
          title="Hồ sơ thương hiệu"
          description="Nơi lưu thông tin cơ bản về Page để AI viết đúng chất thương hiệu của bạn."
        />
        <div
          className="rounded-xl border border-dashed border-gray-300 p-8 text-center"
          data-testid="brand-no-page"
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

  // Page được chọn phải thuộc về user — không tin tham số trên URL
  const selected = pages.find((p) => p.id === sp.page) ?? pages[0];

  const [profile, pillars, docs] = await Promise.all([
    prisma.brandProfile.findUnique({ where: { pageId: selected.id } }),
    prisma.contentPillar.findMany({
      where: { pageId: selected.id },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    }),
    prisma.knowledgeDoc.findMany({
      where: { pageId: selected.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const filled = profile
    ? [
        profile.description,
        profile.products,
        profile.audience,
        profile.industry,
        profile.priceRange,
      ].filter((v) => v && v.trim()).length
    : 0;

  return (
    <div>
      <PageHeader
        title="Hồ sơ thương hiệu"
        description="Nhập một lần — mọi bài AI viết (thủ công lẫn tự động) đều dựa trên thông tin ở đây."
      />

      {pages.length > 1 ? (
        <div className="mb-4 flex flex-wrap gap-2" data-testid="brand-page-switcher">
          {pages.map((p) => (
            <Link
              key={p.id}
              href={`/brand?page=${p.id}`}
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

      <div
        className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-gray-50 px-4 py-3 text-sm"
        data-testid="brand-summary"
      >
        <span className="font-medium text-gray-900">{selected.name}</span>
        <span className="text-gray-400">·</span>
        <span className={filled >= 3 ? "text-emerald-700" : "text-amber-700"}>
          {filled >= 3
            ? `✓ Hồ sơ đã đủ dùng (${filled}/5 mục chính)`
            : `⚠ Mới điền ${filled}/5 mục chính — AI càng biết nhiều, bài càng đúng`}
        </span>
        <span className="text-gray-400">·</span>
        <span className="text-gray-600">
          {pillars.filter((p) => p.enabled).length} trụ cột · {docs.filter((d) => d.enabled).length}{" "}
          tài liệu
        </span>
      </div>

      <BrandEditor
        pageId={selected.id}
        profile={profile}
        pillars={pillars.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          goal: p.goal,
          weight: p.weight,
          enabled: p.enabled,
        }))}
        docs={docs.map((d) => ({
          id: d.id,
          title: d.title,
          kind: d.kind,
          content: d.content,
          enabled: d.enabled,
          length: d.content.length,
        }))}
      />

      <p className="mt-4 text-sm text-gray-500">
        Xong rồi?{" "}
        <Link href="/autopilot" className="font-medium text-blue-600 hover:underline">
          Bật chế độ tự động →
        </Link>{" "}
        để hệ thống tự viết và đăng theo lịch bạn đặt.
      </p>
    </div>
  );
}
