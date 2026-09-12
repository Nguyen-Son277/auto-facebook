"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, requireCurrentUser, type CurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/markdown";
import { notifyAllUsers } from "@/lib/notify";

// ============================================================
// Server actions cho Docs & Câu hỏi tương tác.
//
// - User: đọc docs (SSR ở page), trả lời câu hỏi (1 lần/câu hỏi).
// - Admin: CRUD docs + CRUD câu hỏi — mọi action tự kiểm tra role.
// ============================================================

export type DocState = {
  ok?: boolean;
  error?: string;
  message?: string;
} | null;

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

async function requireAdmin(): Promise<CurrentUser | DocState> {
  const me = await getCurrentUser();
  if (!me || me.role !== "ADMIN") {
    return { ok: false, error: "Bạn không có quyền quản trị." };
  }
  return me;
}

function isUser(v: CurrentUser | DocState): v is CurrentUser {
  return v !== null && "id" in v && typeof v.id === "string";
}

function revalidateDocs() {
  revalidatePath("/docs");
  revalidatePath("/admin/docs");
}

// ============================================================
// ADMIN — CRUD Docs
// ============================================================

export async function saveDoc(_prev: DocState, formData: FormData): Promise<DocState> {
  const me = await requireAdmin();
  if (!isUser(me)) return me as DocState;

  const id = str(formData, "id");
  const title = str(formData, "title");
  const bodyMarkdown = String(formData.get("bodyMarkdown") ?? "").trim();
  const publishNow = str(formData, "published") === "1";
  const notifyOnPublish = str(formData, "notifyOnPublish") === "1";

  if (!title) return { ok: false, error: "Vui lòng nhập tiêu đề." };
  if (!bodyMarkdown) return { ok: false, error: "Vui lòng nhập nội dung." };

  try {
    if (id) {
      const existing = await prisma.doc.findUnique({ where: { id } });
      if (!existing) return { ok: false, error: "Không tìm thấy tài liệu." };

      const wasUnpublished = !existing.published;
      await prisma.doc.update({
        where: { id },
        data: {
          title,
          bodyMarkdown,
          published: publishNow,
          notifyOnPublish,
        },
      });

      // Bật publish lần đầu + có cờ thông báo → báo mọi người
      // (bỏ chính admin ban hành — không nhận lại tin của mình)
      if (wasUnpublished && publishNow && notifyOnPublish) {
        await notifyAllUsers(
          {
            type: "ADMIN",
            title: `📄 Tài liệu mới: ${title}`,
            body: "Hướng dẫn mới vừa được ban hành — bấm để đọc ngay.",
            link: `/docs/${existing.slug}`,
          },
          { includeAdmins: true, excludeUserId: me.id }
        );
      }

      revalidateDocs();
      return { ok: true, message: `Đã cập nhật "${title}".` };
    }

    // Tạo mới — sinh slug unique từ tiêu đề
    let slug = slugify(title);
    for (let i = 2; ; i++) {
      const dup = await prisma.doc.findUnique({ where: { slug } });
      if (!dup) break;
      slug = `${slugify(title)}-${i}`;
    }

    const created = await prisma.doc.create({
      data: {
        title,
        slug,
        bodyMarkdown,
        published: publishNow,
        notifyOnPublish,
        authorId: me.id,
      },
    });

    if (publishNow && notifyOnPublish) {
      await notifyAllUsers(
        {
          type: "ADMIN",
          title: `📄 Tài liệu mới: ${title}`,
          body: "Hướng dẫn mới vừa được ban hành — bấm để đọc ngay.",
          link: `/docs/${created.slug}`,
        },
        { includeAdmins: true, excludeUserId: me.id }
      );
    }

    revalidateDocs();
    return { ok: true, message: `Đã tạo "${title}".` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteDoc(docId: string): Promise<DocState> {
  const me = await requireAdmin();
  if (!isUser(me)) return me as DocState;

  const existing = await prisma.doc.findUnique({ where: { id: docId } });
  if (!existing) return { ok: false, error: "Không tìm thấy tài liệu." };

  await prisma.doc.delete({ where: { id: docId } });
  revalidateDocs();
  return { ok: true, message: `Đã xoá "${existing.title}".` };
}

// ============================================================
// ADMIN — CRUD Câu hỏi tương tác
// ============================================================

export async function saveQuestion(_prev: DocState, formData: FormData): Promise<DocState> {
  const me = await requireAdmin();
  if (!isUser(me)) return me as DocState;

  const id = str(formData, "id");
  const question = str(formData, "question");
  if (!question) return { ok: false, error: "Vui lòng nhập nội dung câu hỏi." };

  if (id) {
    const existing = await prisma.feedbackQuestion.findUnique({ where: { id } });
    if (!existing) return { ok: false, error: "Không tìm thấy câu hỏi." };
    await prisma.feedbackQuestion.update({ where: { id }, data: { question } });
    revalidateDocs();
    return { ok: true, message: "Đã cập nhật câu hỏi." };
  }

  await prisma.feedbackQuestion.create({
    data: { question, authorId: me.id },
  });
  revalidateDocs();
  return { ok: true, message: "Đã tạo câu hỏi." };
}

export async function toggleQuestionActive(questionId: string): Promise<DocState> {
  const me = await requireAdmin();
  if (!isUser(me)) return me as DocState;

  const existing = await prisma.feedbackQuestion.findUnique({ where: { id: questionId } });
  if (!existing) return { ok: false, error: "Không tìm thấy câu hỏi." };

  await prisma.feedbackQuestion.update({
    where: { id: questionId },
    data: { active: !existing.active },
  });
  revalidateDocs();
  return {
    ok: true,
    message: existing.active ? "Đã ẩn câu hỏi." : "Đã hiện lại câu hỏi.",
  };
}

export async function deleteQuestion(questionId: string): Promise<DocState> {
  const me = await requireAdmin();
  if (!isUser(me)) return me as DocState;

  const existing = await prisma.feedbackQuestion.findUnique({ where: { id: questionId } });
  if (!existing) return { ok: false, error: "Không tìm thấy câu hỏi." };

  await prisma.feedbackQuestion.delete({ where: { id: questionId } });
  revalidateDocs();
  return { ok: true, message: "Đã xoá câu hỏi (kèm mọi câu trả lời)." };
}

// ============================================================
// USER — Trả lời câu hỏi (1 câu trả lời / 1 user / 1 câu hỏi)
// ============================================================

export async function answerQuestion(_prev: DocState, formData: FormData): Promise<DocState> {
  const user = await requireCurrentUser();

  const questionId = str(formData, "questionId");
  const body = String(formData.get("body") ?? "").trim();
  if (!questionId) return { ok: false, error: "Câu hỏi không hợp lệ." };
  if (!body) return { ok: false, error: "Vui lòng nhập câu trả lời." };
  if (body.length > 2000) return { ok: false, error: "Câu trả lời tối đa 2000 ký tự." };

  const q = await prisma.feedbackQuestion.findUnique({ where: { id: questionId } });
  if (!q || !q.active) return { ok: false, error: "Câu hỏi không còn hoạt động." };

  await prisma.feedbackAnswer.upsert({
    where: { questionId_userId: { questionId, userId: user.id } },
    update: { body },
    create: { questionId, userId: user.id, body },
  });

  revalidatePath("/docs");
  return { ok: true, message: "Cảm ơn góp ý của bạn!" };
}
