import Link from "next/link";
import { APP_NAME, LEGAL_LINKS } from "@/lib/legal";

/** Thanh điều hướng dùng chung cho các trang công khai (trang chủ + pháp lý). */
export default function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-xl">
            🚀
          </span>
          <span className="text-sm font-bold text-gray-900 md:text-base">
            {APP_NAME}
          </span>
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          <Link
            href="/#tinh-nang"
            className="text-sm font-medium text-gray-600 transition hover:text-gray-900"
          >
            Tính năng
          </Link>
          {LEGAL_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm font-medium text-gray-600 transition hover:text-gray-900"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/register"
            className="hidden rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 sm:block"
          >
            Đăng ký
          </Link>
          <Link
            href="/login"
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Đăng nhập
          </Link>
        </div>
      </div>
    </header>
  );
}
