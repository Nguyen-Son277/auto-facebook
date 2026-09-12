import { formatDate } from "@/lib/format-date";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { renderMarkdown } from "@/lib/markdown";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = await prisma.doc.findUnique({ where: { slug }, select: { title: true } });
  return { title: `${doc?.title ?? "Tài liệu"} | FB Marketing Auto` };
}

/**
 * Chi tiết một tài liệu hướng dẫn — render markdown an toàn
 * (escape toàn bộ HTML trước khi chuyển cú pháp).
 */
export default async function DocDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await requireCurrentUser();
  const { slug } = await params;

  const doc = await prisma.doc.findUnique({
    where: { slug },
    select: { title: true, slug: true, bodyMarkdown: true, published: true, updatedAt: true },
  });
  if (!doc || !doc.published) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/docs"
        className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
      >
        ← Tất cả hướng dẫn
      </Link>

      <article
        className="mt-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8"
        data-testid="doc-detail"
      >
        <h1 className="text-2xl font-bold text-gray-900">{doc.title}</h1>
        <p className="mt-1 text-xs text-gray-400">
          Cập nhật {formatDate(doc.updatedAt)}
        </p>
        <div
          className="prose-docs mt-5 text-sm text-gray-700"
          data-testid="doc-body"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.bodyMarkdown) }}
        />
      </article>

      <Link
        href="/docs"
        className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
      >
        ← Tất cả hướng dẫn
      </Link>
    </div>
  );
}
