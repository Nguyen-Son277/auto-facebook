"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login } from "@/app/actions/auth";
import PasswordInput from "@/components/password-input";
import { LEGAL_LINKS } from "@/lib/legal";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, null);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-lg">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-3xl">
          🚀
        </div>
        <h1 className="text-2xl font-bold text-gray-900">
          FB Marketing Auto
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          AI viết nội dung · Đăng bài tự động lên Facebook
        </p>
      </div>

      <form action={formAction} className="space-y-4">
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
          autoComplete="current-password"
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
          {pending ? "Đang đăng nhập..." : "Đăng nhập"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-500">
        Chưa có tài khoản?{" "}
        <Link href="/register" className="font-medium text-blue-600 hover:underline">
          Đăng ký
        </Link>{" "}
        — quản trị viên sẽ duyệt trước khi bạn vào được.
      </p>

      {/* Trang pháp lý phải truy cập được ngay cả khi chưa đăng nhập
          (yêu cầu của Meta App Review). */}
      <p className="mt-4 text-center text-xs text-gray-500">
        <Link href="/" className="hover:underline">
          Trang chủ
        </Link>
        {LEGAL_LINKS.map((item) => (
          <span key={item.href}>
            {" · "}
            <Link href={item.href} className="hover:underline">
              {item.label}
            </Link>
          </span>
        ))}
      </p>
    </div>
  );
}
