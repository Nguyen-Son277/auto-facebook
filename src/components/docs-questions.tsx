"use client";

import { useActionState } from "react";
import { answerQuestion, type DocState } from "@/app/actions/docs";

// ============================================================
// Khối câu hỏi tương tác ở trang /docs.
//
// Server truyền kèm answers (để ẩn/hiện ô nhập) + currentUserId;
// user trả lời 1 lần/câu hỏi, được sửa lại (upsert phía server).
// ============================================================

export type QuestionView = {
  id: string;
  question: string;
  createdAt: string;
  answers: { id: string; userId: string; body: string; updatedAt: string }[];
};

export default function DocsQuestions({
  questions,
  currentUserId,
}: {
  questions: QuestionView[];
  currentUserId: string;
}) {
  if (questions.length === 0) return null;

  return (
    <div className="space-y-4">
      {questions.map((q) => (
        <QuestionCard key={q.id} q={q} currentUserId={currentUserId} />
      ))}
    </div>
  );
}

function QuestionCard({
  q,
  currentUserId,
}: {
  q: QuestionView;
  currentUserId: string;
}) {
  const [state, action, pending] = useActionState(answerQuestion, null as DocState);
  const myAnswer = q.answers.find((a) => a.userId === currentUserId) ?? null;

  return (
    <div
      className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
      data-testid={`question-${q.id}`}
    >
      <p className="font-medium text-gray-900">❓ {q.question}</p>

      {myAnswer ? (
        <div className="mt-3" data-testid="my-answer">
          <p className="text-xs font-medium text-emerald-700">
            ✓ Bạn đã trả lời
            <span className="ml-1 font-normal text-gray-400">
              ({new Date(myAnswer.updatedAt).toLocaleString("vi-VN")})
            </span>
          </p>
          <p className="mt-1 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
            {myAnswer.body}
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-medium text-blue-600">
              Sửa câu trả lời
            </summary>
            <AnswerForm questionId={q.id} initial={myAnswer.body} state={state} pending={pending} action={action} />
          </details>
        </div>
      ) : (
        <AnswerForm questionId={q.id} initial="" state={state} pending={pending} action={action} />
      )}
    </div>
  );
}

function AnswerForm({
  questionId,
  initial,
  state,
  pending,
  action,
}: {
  questionId: string;
  initial: string;
  state: DocState;
  pending: boolean;
  action: (fd: FormData) => void;
}) {
  return (
    <form action={action} className="mt-3 space-y-2">
      <input type="hidden" name="questionId" value={questionId} />
      <textarea
        name="body"
        required
        rows={3}
        maxLength={2000}
        defaultValue={initial}
        placeholder="Câu trả lời của bạn..."
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
      />
      {state?.error && <p className="text-xs text-red-600">✗ {state.error}</p>}
      {state?.ok && state.message && (
        <p className="text-xs text-emerald-700">✓ {state.message}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? "Đang gửi..." : initial ? "Cập nhật trả lời" : "Gửi câu trả lời"}
      </button>
    </form>
  );
}
