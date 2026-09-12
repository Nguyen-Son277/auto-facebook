import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import PageHeader from "@/components/page-header";
import DocsAdminClient from "@/components/docs-admin-client";

export const metadata: Metadata = {
  title: "Quản lý Docs & Câu hỏi | FB Marketing Auto",
};

export const dynamic = "force-dynamic";

/** Quản trị Docs (hướng dẫn) + Câu hỏi tương tác — chỉ ADMIN. */
export default async function AdminDocsPage() {
  const me = await requireCurrentUser();
  if (me.role !== "ADMIN") {
    redirect("/dashboard");
  }

  const docs = await prisma.doc.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      slug: true,
      bodyMarkdown: true,
      published: true,
      notifyOnPublish: true,
      updatedAt: true,
    },
  });

  const questions = await prisma.feedbackQuestion.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      question: true,
      active: true,
      createdAt: true,
      answers: {
        select: {
          id: true,
          body: true,
          updatedAt: true,
          user: { select: { email: true, name: true } },
        },
      },
    },
  });

  return (
    <div>
      <PageHeader
        title="📚 Docs & Câu hỏi"
        description="Tạo, sửa, xoá tài liệu hướng dẫn hiển thị ở /docs và các câu hỏi tương tác người dùng"
      />
      <DocsAdminClient
        docs={docs.map((d) => ({
          id: d.id,
          title: d.title,
          slug: d.slug,
          bodyMarkdown: d.bodyMarkdown,
          published: d.published,
          notifyOnPublish: d.notifyOnPublish,
          updatedAt: d.updatedAt.toISOString(),
        }))}
        questions={questions.map((q) => ({
          id: q.id,
          question: q.question,
          active: q.active,
          createdAt: q.createdAt.toISOString(),
          answers: q.answers.map((a) => ({
            id: a.id,
            body: a.body,
            updatedAt: a.updatedAt.toISOString(),
            userEmail: a.user.email,
            userName: a.user.name,
          })),
        }))}
      />
    </div>
  );
}
