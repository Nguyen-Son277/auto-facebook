import type { Metadata } from "next";
import Link from "next/link";
import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import PageHeader from "@/components/page-header";
import { firstLine } from "@/lib/markdown";
import DocsQuestions from "@/components/docs-questions";

export const metadata: Metadata = {
  title: "Hướng dẫn sử dụng | FB Marketing Auto",
};

export const dynamic = "force-dynamic";

/**
 * Trang Hướng dẫn — mọi user đọc được.
 *
 * Gồm 2 phần:
 * 1. Các tài liệu hướng dẫn admin ban hành (chỉ hiện doc published).
 * 2. Câu hỏi tương tác từ đội ngũ phát triển — user trả lời để góp ý.
 */
export default async function DocsPage() {
  const user = await requireCurrentUser();

  const docs = await prisma.doc.findMany({
    where: { published: true },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, slug: true, bodyMarkdown: true, updatedAt: true },
  });

  const questions = await prisma.feedbackQuestion.findMany({
    where: { active: true },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      question: true,
      createdAt: true,
      answers: { select: { id: true, userId: true, body: true, updatedAt: true } },
    },
  });

  return (
    <div>
      <PageHeader
        title="📚 Hướng dẫn sử dụng"
        description="Tài liệu hướng dẫn chi tiết từng tính năng — đọc trước khi bắt đầu để dùng hiệu quả"
      />

      {/* Danh sách docs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {docs.length === 0 && (
          <p className="col-span-full rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
            Chưa có tài liệu hướng dẫn nào.
          </p>
        )}
        {docs.map((doc) => (
          <Link
            key={doc.id}
            href={`/docs/${doc.slug}`}
            data-testid={`doc-card-${doc.slug}`}
            className="group flex flex-col rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md"
          >
            <h2 className="font-semibold text-gray-900 group-hover:text-blue-600">
              {doc.title}
            </h2>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-gray-600">
              {firstLine(doc.bodyMarkdown)}
            </p>
            <p className="mt-3 text-xs text-gray-400">
              Cập nhật {new Date(doc.updatedAt).toLocaleDateString("vi-VN")}
            </p>
          </Link>
        ))}
      </div>

      {/* Câu hỏi tương tác */}
      <div className="mt-10">
        <h2 className="text-lg font-semibold text-gray-900">
          💬 Câu hỏi từ đội ngũ phát triển
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Trả lời để giúp chúng tôi xây dựng sản phẩm phù hợp hơn với bạn
        </p>
        <DocsQuestions
          currentUserId={user.id}
          questions={questions.map((q) => ({
            id: q.id,
            question: q.question,
            createdAt: q.createdAt.toISOString(),
            answers: q.answers.map((a) => ({
              id: a.id,
              userId: a.userId,
              body: a.body,
              updatedAt: a.updatedAt.toISOString(),
            })),
          }))}
        />
      </div>
    </div>
  );
}
