import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { getPexelsConfig } from "@/lib/settings";
import PostEditor from "@/components/post-editor";

// ============================================================
// Trang chi tiết bài viết — /posts/[id]
//
// Dùng chung cho bài tự động lẫn bài soạn tay. Đây là nơi người dùng
// xem trước chính xác bài sẽ trông thế nào trên Facebook, sửa nội dung,
// đổi ảnh, đổi giờ đăng trước khi bài được đăng.
// ============================================================

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireCurrentUser();
  const { id } = await params;

  const post = await prisma.post.findFirst({
    where: { id, userId: user.id },
    include: {
      page: { select: { id: true, name: true } },
      media: { orderBy: { position: "asc" } },
    },
  });

  // Không tiết lộ bài của người khác có tồn tại hay không
  if (!post) notFound();

  const { apiKey } = await getPexelsConfig();

  return (
    <div>
      <div className="mb-4">
        <Link
          href="/autopilot"
          className="text-sm text-gray-500 hover:text-gray-700"
          data-testid="post-back"
        >
          ← Quay lại
        </Link>
      </div>

      <PostEditor
        post={{
          id: post.id,
          content: post.content,
          hook: post.hook,
          hashtags: post.hashtags,
          status: post.status,
          scheduledAt: post.scheduledAt?.toISOString() ?? null,
          publishedAt: post.publishedAt?.toISOString() ?? null,
          origin: post.origin,
          pillarName: post.pillarName,
          topic: post.topic,
          errorMessage: post.errorMessage,
          attempts: post.attempts,
          fbPostId: post.fbPostId,
          pageName: post.page?.name ?? null,
        }}
        media={post.media.map((m) => ({
          remoteUrl: m.remoteUrl,
          previewUrl: m.previewUrl ?? undefined,
          type: m.type === "VIDEO" ? "VIDEO" : "IMAGE",
          source: (m.source === "UPLOAD" || m.source === "URL" ? m.source : "PEXELS") as
            | "PEXELS"
            | "URL"
            | "UPLOAD",
          providerId: m.providerId ?? undefined,
          photographer: m.photographer ?? undefined,
          photographerUrl: m.photographerUrl ?? undefined,
          sourcePageUrl: m.sourcePageUrl ?? undefined,
          alt: m.alt ?? undefined,
          width: m.width ?? undefined,
          height: m.height ?? undefined,
          duration: m.duration ?? undefined,
          storageKey: m.storageKey ?? undefined,
          mimeType: m.mimeType ?? undefined,
          sizeBytes: m.sizeBytes ?? undefined,
        }))}
        pexelsReady={Boolean(apiKey)}
      />
    </div>
  );
}
