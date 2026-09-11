import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import PageHeader from "@/components/page-header";
import ComposerStudio from "@/components/composer-studio";
import { getAiConfig, getPexelsConfig } from "@/lib/settings";
import { pruneOrphanUploads } from "@/lib/uploads";

export default async function ComposerPage() {
  const user = await requireCurrentUser();

  const [activePages, drafts, history, ai, pexels, library, uploads] = await Promise.all([
    prisma.facebookPage.findMany({
      where: { userId: user.id, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, fbPageId: true },
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
    getAiConfig(),
    getPexelsConfig(),
    prisma.media.findMany({
      where: { userId: user.id, postId: null, providerId: { not: null } },
      select: { providerId: true },
    }),
    // storageKey đang được tham chiếu — dùng cho việc dọn file mồ côi bên dưới
    prisma.media.findMany({
      where: { userId: user.id, storageKey: { not: null } },
      select: { storageKey: true },
    }),
  ]);

  // Dọn file video tải lên nhưng không còn bài nào tham chiếu (chỉ file cũ > 24h).
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
        pages={activePages}
        aiReady={Boolean(ai.baseUrl && ai.apiKey && ai.model)}
        pexelsReady={Boolean(pexels.apiKey)}
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
