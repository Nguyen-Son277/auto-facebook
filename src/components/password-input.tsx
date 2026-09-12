"use client";

import { useState } from "react";

/**
 * Ô mật khẩu có nút 👁 hiện/ẩn — dùng chung cho login, register,
 * đổi mật khẩu và các form mật khẩu tạm trong trang quản trị.
 *
 * Giữ input uncontrolled (chỉ đổi `type` khi bấm) nên server actions
 * nhận formData y hệt input thường.
 */
export default function PasswordInput({
  id,
  name,
  label,
  autoComplete = "current-password",
  required = true,
  minLength,
  placeholder = "••••••••",
  defaultValue,
  inputClassName = "w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none",
}: {
  id: string;
  name: string;
  label?: string;
  autoComplete?: "current-password" | "new-password";
  required?: boolean;
  minLength?: number;
  placeholder?: string;
  defaultValue?: string;
  inputClassName?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      {label && (
        <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required={required}
          minLength={minLength}
          placeholder={placeholder}
          defaultValue={defaultValue}
          className={`${inputClassName} pr-11`}
          data-testid={`pw-input-${name}`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
          aria-pressed={visible}
          title={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
          data-testid={`pw-toggle-${name}`}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
        >
          {visible ? "🙈" : "👁"}
        </button>
      </div>
    </div>
  );
}
