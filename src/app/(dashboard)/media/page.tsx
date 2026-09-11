import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import PageHeader from "@/components/page-header";
import MediaLibrary from "@/components/media-library";
import { getPexelsConfig } from "@/lib/settings";
import { curatedMedia, getPexelsQuota } from "@/lib/pexels";

export default async function MediaPage() {
  const user = await requireCurrentUser();

  const [pexels, saved] = await Promise.all([
    getPexelsConfig(),
    prisma.media.findMany({
      where: { userId: user.id, postId: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        type: true,
        remoteUrl: true,
        previewUrl: true,
        width: true,
        height: true,
        duration: true,
        photographer: true,
        photographerUrl: true,
        sourcePageUrl: true,
        alt: true,
        providerId: true,
      },
    }),
  ]);

  const quota = getPexelsQuota();

  // Tải sẵn ảnh phổ biến ở server để trang có nội dung ngay khi mở
  // (tránh gọi Pexels trong useEffect ở client).
  const initial = pexels.apiKey ? await curatedMedia("IMAGE", 12) : null;
  const initialResult = initial
    ? {
        ok: initial.ok,
        error: initial.error,
        items: initial.items,
        keyword: "",
        mediaType: "IMAGE" as const,
        page: initial.page,
        hasNextPage: initial.hasNextPage,
        totalResults: initial.totalResults,
        cached: initial.cached,
        curated: true,
      }
    : null;

  return (
    <div>
      <PageHeader
        title="Thư viện Media"
        description="Tìm ảnh/video miễn phí bản quyền từ Pexels, lưu vào thư viện để tái sử dụng cho các bài đăng"
      />

      <MediaLibrary
        saved={saved}
        pexelsReady={Boolean(pexels.apiKey)}
        quotaUsed={quota.used}
        quotaLimit={quota.limit}
        initialResult={initialResult}
      />
    </div>
  );
}
