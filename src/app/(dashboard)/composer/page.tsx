import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import PageHeader from "@/components/page-header";
import ComposerStudio from "@/components/composer-studio";
import { getAiConfigForUser, getPexelsKeyForUser } from "@/lib/settings";
import { MAX_VIDEO_BYTES, pruneOrphanUploads } from "@/lib/uploads";
import { getDriveStatus } from "@/app/actions/drive";

export default async function ComposerPage() {
  const user = await requireCurrentUser();

  // Workspace user là thành viên — brands lấy theo các workspace đó
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId: user.id },
    select: { workspaceId: true },
  });
  const workspaceIds = memberships.map((m) => m.workspaceId);

  const [activePages, drafts, history, ai, pexels, library, uploads, brands] =
    await Promise.all([      prisma.facebookPage.findMany({
        where: { userId: user.id, isActive: true },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          fbPageId: true,
          brandId: true,
          brand: { select: { name: true } },
          connection: { select: { name: true } },
        },
      }),
      prisma.post.findMany({
        where: { userId: user.id, status: "DRAFT" },
        orderBy: { updatedAt: "desc" },
        take: 20,
        include: { page: { select: { name: true } } },
      }),
      prisma.post.findMany({
        where: { userId: user.id, status: { not: "DRAFT" } },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { page: { select: { name: true } } },
      }),
      getAiConfigForUser(user.id),
      getPexelsKeyForUser(user.id).then((apiKey) => ({ apiKey })),
      prisma.media.findMany({
        where: { userId: user.id, postId: null, providerId: { not: null } },
        select: { providerId: true },
      }),
      // storageKey đang được tham chiếu — dùng cho việc dọn file mồ côi bên dưới
      prisma.media.findMany({
        where: { userId: user.id, storageKey: { not: null } },
        select: { storageKey: true },
      }),
      // Thương hiệu của workspace — cho dropdown "viết theo thương hiệu"
      workspaceIds.length > 0
        ? prisma.brand.findMany({
            where: { workspaceId: { in: workspaceIds } },
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              name: true,
              profile: { select: { industry: true, products: true } },
            },
          })
        : Promise.resolve([]),
    ]);

  // Nguồn media thứ ba: Google Drive cá nhân (nút "Chọn từ Google Drive").
  const drive = await getDriveStatus();

  // Dọn file tải lên nhưng không còn bài nào tham chiếu (chỉ file cũ > 24h).
  // Không chặn render — đây chỉ là dọn dẹp nền.
  void pruneOrphanUploads(
    user.id,
    new Set(uploads.map((u) => u.storageKey).filter((k): k is string => Boolean(k)))
  ).catch(() => {
    // Bỏ qua lỗi dọn dẹp — không ảnh hưởng việc soạn bài
  });

  return (
    <div>
      <PageHeader
        title="Soạn bài"
        description="AI viết nội dung, tìm ảnh/video từ Pexels — chọn phương án ưng ý rồi đăng lên Page"
      />

      <ComposerStudio
        pages={activePages.map((p) => ({
          id: p.id,
          name: p.name,
          fbPageId: p.fbPageId,
          brandId: p.brandId,
          brandName: p.brand?.name ?? null,
          connectionName: p.connection?.name ?? null,
        }))}
        brands={brands.map((b) => ({
          id: b.id,
          name: b.name,
          industry: b.profile?.industry ?? null,
          products: b.profile?.products ?? null,
        }))}
        aiReady={Boolean(ai.baseUrl && ai.apiKey && ai.model)}
        pexelsReady={Boolean(pexels.apiKey)}
        maxVideoBytes={MAX_VIDEO_BYTES}
        driveConnected={drive.connected}
        driveEmail={drive.googleEmail}
        pickerApiKey={process.env.GOOGLE_PICKER_API_KEY ?? ""}
        libraryProviderIds={library
          .map((m) => m.providerId)
          .filter((id): id is string => Boolean(id))}
        drafts={drafts.map((d) => ({
          id: d.id,
          content: d.content,
          hashtags: d.hashtags,
          pageName: d.page?.name ?? null,
          updatedAt: d.updatedAt.toISOString(),
        }))}
        history={history.map((p) => ({
          id: p.id,
          content: p.content,
          status: p.status,
          pageName: p.page?.name ?? null,
          createdAt: p.createdAt.toISOString(),
          errorMessage: p.errorMessage,
          permalink: p.fbPostId
            ? `https://www.facebook.com/${p.fbPostId.replace("_", "/posts/")}`
            : null,
        }))}
      />
    </div>
  );
}
