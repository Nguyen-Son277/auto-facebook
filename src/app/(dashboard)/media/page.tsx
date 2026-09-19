import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import PageHeader from "@/components/page-header";
import MediaLibrary from "@/components/media-library";
import { getPexelsKeyForUser } from "@/lib/settings";
import { curatedMedia, getPexelsQuota } from "@/lib/pexels";
import { getDriveStatus } from "@/app/actions/drive";

export default async function MediaPage() {
  const user = await requireCurrentUser();

  const [pexels, saved, drive] = await Promise.all([
    getPexelsKeyForUser(user.id).then((apiKey) => ({ apiKey })),
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
    getDriveStatus(),
  ]);

  // Thư mục Drive của các thương hiệu thuộc workspace mà user là thành viên.
  // Đây là dữ liệu để tab "Google Drive" biết duyệt thư mục nào.
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId: user.id },
    select: { workspaceId: true },
  });
  const driveFolders =
    drive.connected && memberships.length > 0
      ? await prisma.brandDriveFolder.findMany({
          where: { brand: { workspaceId: { in: memberships.map((m) => m.workspaceId) } } },
          orderBy: { createdAt: "asc" },
          select: {
            brandId: true,
            folderName: true,
            brand: { select: { name: true } },
          },
        })
      : [];

  const quota = getPexelsQuota(user.id);

  // Tải sẵn ảnh phổ biến ở server để trang có nội dung ngay khi mở
  // (tránh gọi Pexels trong useEffect ở client).
  const initial = pexels.apiKey ? await curatedMedia(user.id, "IMAGE", 12) : null;
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
        drive={{
          connected: drive.connected,
          folders: driveFolders.map((f) => ({
            brandId: f.brandId,
            brandName: f.brand.name,
            folderName: f.folderName,
          })),
        }}
      />
    </div>
  );
}
