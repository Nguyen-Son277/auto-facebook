"use client";

import { useActionState } from "react";
import Link from "next/link";
import { register } from "@/app/actions/auth";
import PasswordInput from "@/components/password-input";

export default function RegisterPage() {
  const [state, formAction, pending] = useActionState(register, null);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-lg">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-3xl">
          📝
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Đăng ký tài khoản</h1>
        <p className="mt-1 text-sm text-gray-500">
          Hệ thống riêng tư — quản trị viên duyệt trước khi bạn vào được
        </p>
      </div>

      {state?.ok ? (
        <div className="space-y-4">
          <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            ✓ {state.message}
          </p>
          <Link
            href="/login"
            className="block w-full rounded-lg bg-blue-600 py-2.5 text-center font-semibold text-white transition hover:bg-blue-700"
          >
            Về trang đăng nhập
          </Link>
        </div>
      ) : (
        <form action={formAction} className="space-y-4">
          <div>
            <label
              htmlFor="name"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Tên hiển thị <span className="text-gray-400">(tùy chọn)</span>
            </label>
            <input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
              placeholder="Nguyễn Văn A"
            />
          </div>

          <div>
            <label
              htmlFor="email"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none"
              placeholder="ban@example.com"
            />
          </div>

          <PasswordInput
            id="password"
            name="password"
            label="Mật khẩu"
            autoComplete="new-password"
            minLength={8}
            placeholder="Ít nhất 8 ký tự, có chữ và số"
          />

          <PasswordInput
            id="confirm"
            name="confirm"
            label="Xác nhận mật khẩu"
            autoComplete="new-password"
            minLength={8}
          />

          {state?.error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-blue-600 py-2.5 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Đang gửi đăng ký..." : "Gửi đăng ký"}
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-gray-500">
        Đã có tài khoản?{" "}
        <Link href="/login" className="font-medium text-blue-600 hover:underline">
          Đăng nhập
        </Link>
      </p>
    </div>
  );
}
