"use client";

import { formatDateTime } from "@/lib/format-date";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  deleteDoc,
  deleteQuestion,
  saveDoc,
  saveQuestion,
  toggleQuestionActive,
  type DocState,
} from "@/app/actions/docs";

// ============================================================
// Giao diện admin: CRUD Docs + CRUD Câu hỏi tương tác.
// Dùng useTransition gọi trực tiếp server action (không cần form
// action vì mọi thao tác đều qua confirm/inline).
// ============================================================

export type DocRow = {
  id: string;
  title: string;
  slug: string;
  bodyMarkdown: string;
  published: boolean;
  notifyOnPublish: boolean;
  updatedAt: string;
};

export type QuestionRow = {
  id: string;
  question: string;
  active: boolean;
  createdAt: string;
  answers: {
    id: string;
    body: string;
    updatedAt: string;
    userEmail: string;
    userName: string | null;
  }[];
};

export default function DocsAdminClient({
  docs,
  questions,
}: {
  docs: DocRow[];
  questions: QuestionRow[];
}) {
  const [notice, setNotice] = useState<DocState>(null);
  const [busy, startBusy] = useTransition();

  // Editor docs: null = đóng; "new" = tạo mới; DocRow = sửa
  const [editing, setEditing] = useState<DocRow | "new" | null>(null);
  const [editingQ, setEditingQ] = useState<QuestionRow | "new" | null>(null);

  async function run(fn: () => Promise<DocState>): Promise<DocState> {
    let res: DocState = null;
    await new Promise<void>((resolve) => {
      startBusy(async () => {
        res = await fn();
        setNotice(res);
        resolve();
      });
    });
    return res;
  }

  return (
    <div className="space-y-6">
      {notice?.error && (
        <p className="ui-alert ui-alert-error">✗ {notice.error}</p>
      )}
      {notice?.ok && notice.message && (
        <p className="ui-alert ui-alert-success">
          ✓ {notice.message}
        </p>
      )}

      {/* ================= DOCS ================= */}
      <section className="ui-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-gray-900">Tài liệu hướng dẫn ({docs.length})</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Hiển thị ở trang /docs — chỉ doc <b>published</b> mới hiện cho user
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="ui-btn ui-btn-primary transition"
          >
            ＋ Tạo doc
          </button>
        </div>

        <div className="mt-4 divide-y divide-gray-100">
          {docs.length === 0 && (
            <p className="py-6 text-center text-sm text-gray-500">Chưa có tài liệu nào.</p>
          )}
          {docs.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-3 py-3" data-testid={`doc-row-${d.slug}`}>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium text-gray-900">
                  {d.title}
                  {d.published ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                      Published
                    </span>
                  ) : (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                      Nháp
                    </span>
                  )}
                  {d.published && d.notifyOnPublish && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] text-blue-700">
                      🔔 thông báo khi publish
                    </span>
                  )}
                </p>
                <p className="text-xs text-gray-400">/docs/{d.slug}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Link
                  href={`/docs/${d.slug}`}
                  className="ui-btn ui-btn-ghost ui-btn-sm"
                >
                  👁 Xem
                </Link>
                <button
                  type="button"
                  onClick={() => setEditing(d)}
                  className="ui-btn ui-btn-soft ui-btn-sm"
                >
                  ✏️ Sửa
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Xoá hẳn doc "${d.title}"?`)) {
                      run(() => deleteDoc(d.id));
                    }
                  }}
                  className="ui-btn ui-btn-danger ui-btn-sm disabled:opacity-50"
                >
                  🗑 Xoá
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ================= CÂU HỎI ================= */}
      <section className="ui-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-gray-900">Câu hỏi tương tác ({questions.length})</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Hiện ở /docs — user trả lời để góp ý phát triển sản phẩm
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEditingQ("new")}
            className="ui-btn ui-btn-primary transition"
          >
            ＋ Tạo câu hỏi
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {questions.length === 0 && (
            <p className="py-6 text-center text-sm text-gray-500">Chưa có câu hỏi nào.</p>
          )}
          {questions.map((q) => (
            <div key={q.id} className="rounded-xl border border-gray-200 bg-sunken p-4" data-testid={`question-row-${q.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 flex-1 font-medium text-gray-900">
                  ❓ {q.question}
                  {!q.active && (
                    <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-[10px] text-gray-600">
                      Đang ẩn
                    </span>
                  )}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => toggleQuestionActive(q.id))}
                    className="ui-btn ui-btn-ghost ui-btn-sm disabled:opacity-50"
                  >
                    {q.active ? "🙈 Ẩn" : "👁 Hiện"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingQ(q)}
                    className="ui-btn ui-btn-soft ui-btn-sm"
                  >
                    ✏️ Sửa
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm("Xoá câu hỏi này cùng MỌI câu trả lời?")) {
                        run(() => deleteQuestion(q.id));
                      }
                    }}
                    className="ui-btn ui-btn-danger ui-btn-sm disabled:opacity-50"
                  >
                    🗑 Xoá
                  </button>
                </div>
              </div>

              {/* Câu trả lời */}
              {q.answers.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-medium text-blue-600">
                    {q.answers.length} câu trả lời của user
                  </summary>
                  <ul className="mt-2 space-y-2">
                    {q.answers.map((a) => (
                      <li key={a.id} className="rounded-xl border border-gray-200 bg-surface px-3 py-2 text-xs text-gray-700">
                        <span className="font-medium text-gray-900">{a.userName || a.userEmail}</span>
                        <span className="ml-1 text-gray-400">
                          ({formatDateTime(a.updatedAt)})
                        </span>
                        : {a.body}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ============ Modal tạo/sửa doc ============ */}
      {editing && (
        <ModalBackdrop onClose={() => setEditing(null)}>
          <DocForm
            doc={editing === "new" ? null : editing}
            busy={busy}
            onCancel={() => setEditing(null)}
            onSubmit={async (fd) => {
              const res = await run(() => saveDoc(null, fd));
              if (res?.ok) setEditing(null);
            }}
          />
        </ModalBackdrop>
      )}

      {/* ============ Modal tạo/sửa câu hỏi ============ */}
      {editingQ && (
        <ModalBackdrop onClose={() => setEditingQ(null)}>
          <QuestionForm
            q={editingQ === "new" ? null : editingQ}
            busy={busy}
            onCancel={() => setEditingQ(null)}
            onSubmit={async (fd) => {
              const res = await run(() => saveQuestion(null, fd));
              if (res?.ok) setEditingQ(null);
            }}
          />
        </ModalBackdrop>
      )}
    </div>
  );
}

function DocForm({
  doc,
  busy,
  onCancel,
  onSubmit,
}: {
  doc: DocRow | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (fd: FormData) => Promise<void>;
}) {
  return (
    <form
      action={onSubmit}
      className="space-y-3"
    >
      <h3 className="text-lg font-bold text-gray-900">
        {doc ? `Sửa doc: ${doc.title}` : "Tạo doc mới"}
      </h3>
      {doc && <input type="hidden" name="id" value={doc.id} />}

      <label className="block text-sm">
        <span className="ui-label">Tiêu đề *</span>
        <input
          name="title"
          required
          defaultValue={doc?.title ?? ""}
          placeholder="Ví dụ: Hướng dẫn kết nối Facebook"
          className="ui-input"
        />
      </label>

      <label className="block text-sm">
        <span className="ui-label">
          Nội dung markdown * <em className="text-gray-400">(hỗ trợ # tiêu đề, **đậm**, - danh sách, link...)</em>
        </span>
        <textarea
          name="bodyMarkdown"
          required
          rows={12}
          defaultValue={doc?.bodyMarkdown ?? ""}
          className="ui-input font-mono text-xs"
        />
      </label>

      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="published"
            value="1"
            defaultChecked={doc?.published ?? false}
            className="h-4 w-4"
          />
          <span className="font-medium text-gray-700">Publish (hiện cho user)</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="notifyOnPublish"
            value="1"
            defaultChecked={doc?.notifyOnPublish ?? false}
            className="h-4 w-4"
          />
          <span className="font-medium text-gray-700">Gửi thông báo khi publish</span>
        </label>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="ui-btn ui-btn-ghost"
        >
          Huỷ
        </button>
        <button
          type="submit"
          disabled={busy}
          className="ui-btn ui-btn-primary disabled:opacity-60"
        >
          {busy ? "Đang lưu..." : "💾 Lưu"}
        </button>
      </div>
    </form>
  );
}

function QuestionForm({
  q,
  busy,
  onCancel,
  onSubmit,
}: {
  q: QuestionRow | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (fd: FormData) => Promise<void>;
}) {
  return (
    <form action={onSubmit} className="space-y-3">
      <h3 className="text-lg font-bold text-gray-900">
        {q ? "Sửa câu hỏi" : "Tạo câu hỏi tương tác"}
      </h3>
      {q && <input type="hidden" name="id" value={q.id} />}
      <textarea
        name="question"
        required
        rows={3}
        defaultValue={q?.question ?? ""}
        placeholder="Câu hỏi dành cho người dùng — ví dụ: Bạn muốn thêm tính năng gì?"
        className="ui-input"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="ui-btn ui-btn-ghost"
        >
          Huỷ
        </button>
        <button
          type="submit"
          disabled={busy}
          className="ui-btn ui-btn-primary disabled:opacity-60"
        >
          {busy ? "Đang lưu..." : "💾 Lưu"}
        </button>
      </div>
    </form>
  );
}

function ModalBackdrop({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="ui-card my-8 max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto bg-surface p-6 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
