"use client";

import { useActionState } from "react";
import { changePassword } from "@/app/actions/auth";

export default function ChangePasswordForm({
  email,
  forced,
}: {
  email: string;
  /** Đổi do admin cấp mật khẩu tạm — không cho thoát ra app cho đến khi đổi */
  forced: boolean;
}) {
  const [state, formAction, pending] = useActionState(changePassword, null);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-lg">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-3xl">
          🔑
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Đổi mật khẩu</h1>
        <p className="mt-1 text-sm text-gray-500">{email}</p>
      </div>

      {forced && (
        <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Quản trị viên vừa cấp mật khẩu tạm cho bạn. Hãy đặt mật khẩu mới để tiếp
          tục sử dụng hệ thống.
        </p>
      )}

      <form action={formAction} className="space-y-4">
        <div>
          <label
            htmlFor="currentPassword"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            Mật khẩu hiện tại
          </label>
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
            placeholder="••••••••"
          />
        </div>

        <div>
          <label
            htmlFor="newPassword"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            Mật khẩu mới
          </label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
            placeholder="Ít nhất 8 ký tự, có chữ và số"
          />
        </div>

        <div>
          <label
            htmlFor="confirm"
            className="mb-1 block text-sm font-medium text-gray-700"
          >
            Xác nhận mật khẩu mới
          </label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
            placeholder="••••••••"
          />
        </div>

        {state?.error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {state.error}
          </p>
        )}
        {state?.ok && (
          <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            ✓ {state.message}{" "}
            <a href="/dashboard" className="font-semibold underline">
              Về trang chính
            </a>
          </div>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-blue-600 py-2.5 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Đang lưu..." : "Đổi mật khẩu"}
        </button>
      </form>
    </div>
  );
}
