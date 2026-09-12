"use client";

import { useActionState } from "react";
import { changePassword } from "@/app/actions/auth";
import PasswordInput from "@/components/password-input";

export default function ChangePasswordForm({
  email,
  forced,
  inline = false,
}: {
  email: string;
  /** Đổi do admin cấp mật khẩu tạm — không cho thoát ra app cho đến khi đổi */
  forced: boolean;
  /** true = render dạng gọn trong trang Cài đặt (không có icon/card lớn) */
  inline?: boolean;
}) {
  const [state, formAction, pending] = useActionState(changePassword, null);

  const form = (
    <form action={formAction} className="space-y-4">
      <PasswordInput
        id="currentPassword"
        name="currentPassword"
        label="Mật khẩu hiện tại"
        autoComplete="current-password"
      />
      <PasswordInput
        id="newPassword"
        name="newPassword"
        label="Mật khẩu mới"
        autoComplete="new-password"
        minLength={8}
        placeholder="Ít nhất 8 ký tự, có chữ và số"
      />
      <PasswordInput
        id="confirm"
        name="confirm"
        label="Xác nhận mật khẩu mới"
        autoComplete="new-password"
        minLength={8}
      />

      {state?.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          ✓ {state.message}
          {!inline && (
            <>
              {" "}
              <a href="/dashboard" className="font-semibold underline">
                Về trang chính
              </a>
            </>
          )}
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
  );

  const banner = forced ? (
    <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
      Quản trị viên vừa cấp mật khẩu tạm cho bạn. Hãy đặt mật khẩu mới để tiếp tục
      sử dụng hệ thống.
    </p>
  ) : null;

  if (inline) {
    return (
      <div className="mt-4 space-y-3" data-testid="settings-change-password">
        <p className="text-sm text-gray-600">
          Đang đăng nhập: <span className="font-medium">{email}</span>
        </p>
        {banner}
        <div className="max-w-md">{form}</div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-lg">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-3xl">
          🔑
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Đổi mật khẩu</h1>
        <p className="mt-1 text-sm text-gray-500">{email}</p>
      </div>
      {banner}
      {form}
    </div>
  );
}
