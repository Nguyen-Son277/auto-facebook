import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireCurrentUser } from "@/lib/dal";
import { statusBadgeOf } from "@/lib/posts";
import HistoryTable, { type HistoryRow } from "@/components/history-table";
import HistorySearch from "@/components/history-search";

// ============================================================
// Trang Lịch sử đăng bài — xem toàn bộ bài đã đăng / nháp / lỗi,
// lọc theo trạng thái, tìm theo nội dung, đăng lại bài lỗi.
// ============================================================

const PAGE_SIZE = 20;

/** Trạng thái hợp lệ trên URL — chặn giá trị lạ từ query string. */
const VALID_STATUSES = ["ALL", "PUBLISHED", "FAILED", "DRAFT", "PUBLISHING"] as const;
type StatusFilter = (typeof VALID_STATUSES)[number];

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const user = await requireCurrentUser();
  const sp = await searchParams;

  const statusParam = (sp.status ?? "ALL").toUpperCase();
  const status: StatusFilter = (VALID_STATUSES as readonly string[]).includes(statusParam)
    ? (statusParam as StatusFilter)
    : "ALL";

  const q = (sp.q ?? "").trim().slice(0, 100);
  const pageNum = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const where = {
    userId: user.id,
    ...(status === "ALL" ? { status: { not: "DRAFT" } } : { status }),
    ...(q ? { content: { contains: q } } : {}),
  };

  const [total, posts, counts] = await Promise.all([
    prisma.post.count({ where }),
    prisma.post.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (pageNum - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        page: { select: { name: true, fbPageId: true } },
        _count: { select: { media: true } },
      },
    }),
    // Đếm cho các tab lọc (không tính nháp — nháp nằm ở trang Soạn bài)
    prisma.post.groupBy({
      by: ["status"],
      where: { userId: user.id },
      _count: { _all: true },
    }),
  ]);

  const countOf = (s: string) =>
    counts.find((c) => c.status === s)?._count._all ?? 0;

  const nonDraft = counts
    .filter((c) => c.status !== "DRAFT")
    .reduce((sum, c) => sum + c._count._all, 0);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const rows: HistoryRow[] = posts.map((p) => ({
    id: p.id,
    content: p.content,
    hashtags: p.hashtags,
    status: p.status,
    statusLabel: statusBadgeOf(p.status).label,
    statusCls: statusBadgeOf(p.status).cls,
    pageName: p.page?.name ?? null,
    fbPostId: p.fbPostId,
    errorMessage: p.errorMessage,
    createdAt: p.createdAt.toISOString(),
    publishedAt: p.publishedAt?.toISOString() ?? null,
    mediaCount: p._count.media,
  }));

  const TABS: { key: StatusFilter; label: string; count: number }[] = [
    { key: "ALL", label: "Tất cả", count: nonDraft },
    { key: "PUBLISHED", label: "Đã đăng", count: countOf("PUBLISHED") },
    { key: "FAILED", label: "Lỗi", count: countOf("FAILED") },
    { key: "PUBLISHING", label: "Đang đăng", count: countOf("PUBLISHING") },
  ];

  function tabHref(key: StatusFilter) {
    const params = new URLSearchParams();
    if (key !== "ALL") params.set("status", key);
    if (q) params.set("q", q);
    const qs = params.toString();
    return `/history${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Lịch sử đăng bài</h1>
          <p className="mt-1 text-sm text-gray-500">
            Toàn bộ bài đã đăng, đang đăng và bài lỗi — kèm lý do lỗi và nút đăng lại.
          </p>
        </div>
        <Link
          href="/composer"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          ✍️ Soạn bài mới
        </Link>
      </header>

      {/* Bộ lọc trạng thái + tìm kiếm */}
      <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap gap-2" data-testid="history-tabs">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={tabHref(t.key)}
              data-testid={`history-tab-${t.key}`}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                status === t.key
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {t.label}
              <span className={status === t.key ? "ml-1.5 opacity-80" : "ml-1.5 text-gray-400"}>
                {t.count}
              </span>
            </Link>
          ))}
        </div>

        {/* Ô tìm kiếm là client component để giữ chữ đang gõ khi trang render lại */}
        <HistorySearch
          key={`${status}-${q}`}
          initialQuery={q}
          status={status}
          clearHref={tabHref(status)}
        />
      </div>

      <HistoryTable rows={rows} query={q} />

      {totalPages > 1 && (
        <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm">
          <span className="text-gray-500">
            Trang {pageNum}/{totalPages} · {total} bài
          </span>
          <div className="flex gap-2">
            {pageNum > 1 && (
              <Link
                href={`/history?${new URLSearchParams({
                  ...(status !== "ALL" ? { status } : {}),
                  ...(q ? { q } : {}),
                  page: String(pageNum - 1),
                })}`}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 transition hover:bg-gray-50"
              >
                ← Trang trước
              </Link>
            )}
            {pageNum < totalPages && (
              <Link
                href={`/history?${new URLSearchParams({
                  ...(status !== "ALL" ? { status } : {}),
                  ...(q ? { q } : {}),
                  page: String(pageNum + 1),
                })}`}
                data-testid="history-next"
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-gray-700 transition hover:bg-gray-50"
              >
                Trang sau →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
