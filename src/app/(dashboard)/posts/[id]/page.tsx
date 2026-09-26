import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { getPexelsKeyForUser } from "@/lib/settings";
import { attachedFromDbMedia } from "@/lib/posts";
import { APP_TIME_ZONE } from "@/lib/format-date";
import PostEditor from "@/components/post-editor";

/**
 * Đọc danh sách metric Facebook từ chối (JSON) — hiển thị để người dùng biết
 * đang thiếu chỉ số nào. Dữ liệu hỏng thì trả mảng rỗng thay vì làm sập trang.
 */
function parseMissingMetrics(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

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
      // Số liệu hiệu quả (nếu đã thu thập) — hiển thị cho bài đã đăng
      insight: true,
    },
  });

  // Không tiết lộ bài của người khác có tồn tại hay không
  if (!post) notFound();

  const apiKey = await getPexelsKeyForUser(user.id);

  // Chỉ bài ĐÃ ĐĂNG mới có số liệu. `distribution` ưu tiên metric mới, lùi về
  // metric cũ khi token thiếu quyền — cùng thứ tự với trang /insights.
  const insight =
    post.status === "PUBLISHED" && post.insight
      ? {
          reactions: post.insight.reactions,
          comments: post.insight.comments,
          shares: post.insight.shares,
          distribution:
            post.insight.mediaView ??
            post.insight.impressions ??
            post.insight.videoViews ??
            null,
          status: post.insight.status,
          fetchedAt: post.insight.fetchedAt.toISOString(),
          missingMetrics: parseMissingMetrics(post.insight.missingMetrics),
        }
      : null;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link
          href="/autopilot"
          className="text-sm text-gray-500 hover:text-gray-700"
          data-testid="post-back"
        >
          ← Quay lại
        </Link>
        {post.page?.id ? (
          <Link
            href={`/insights?page=${post.page.id}`}
            className="text-sm text-blue-600 hover:underline"
            data-testid="post-insights-link"
          >
            📈 Xem số liệu của Page →
          </Link>
        ) : null}
      </div>

      {/* Dải số liệu hiệu quả — chỉ có với bài đã đăng và đã thu thập số liệu */}
      {insight ? (
        <div
          className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4"
          data-testid="post-insight"
        >
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="font-medium text-gray-900">📈 Số liệu bài này</span>
            <span className="text-gray-700">
              Lượt xem/tiếp cận: <strong>{insight.distribution ?? "—"}</strong>
            </span>
            <span className="text-gray-700">
              ❤ {insight.reactions} · 💬 {insight.comments} · ↗ {insight.shares}
            </span>
            <span className="text-gray-700">
              Điểm tương tác:{" "}
              <strong>{insight.reactions + 3 * insight.comments + 5 * insight.shares}</strong>
            </span>
            <span className="text-xs text-gray-500">
              {insight.status === "FRESH"
                ? "Facebook đang tổng hợp (chốt sau ~24h)"
                : `cập nhật ${new Date(insight.fetchedAt).toLocaleString("vi-VN", { timeZone: APP_TIME_ZONE })}`}
            </span>
          </div>
          {insight.missingMetrics.length > 0 ? (
            <p className="mt-1 text-xs text-gray-500">
              Thiếu metric: {insight.missingMetrics.slice(0, 5).join(", ")} — token hiện tại chưa
              có quyền đọc các chỉ số này.
            </p>
          ) : null}
        </div>
      ) : null}

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
        media={post.media.map(attachedFromDbMedia)}
        pexelsReady={Boolean(apiKey)}
      />
    </div>
  );
}
