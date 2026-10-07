import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Đăng nhập",
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-blue-50 via-surface to-indigo-100 px-4 py-10">
      {/* Hai quầng sáng mờ — nền có chiều sâu thay vì một mảng màu phẳng.
          Dùng biến theo theme nên tối/sáng đều dễ nhìn. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-blue-400/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -right-16 h-80 w-80 rounded-full bg-indigo-500/20 blur-3xl"
      />

      <div className="relative w-full max-w-md">{children}</div>
    </div>
  );
}
