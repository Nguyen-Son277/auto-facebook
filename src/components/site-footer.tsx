import Link from "next/link";
import { APP_NAME, LEGAL, LEGAL_LINKS } from "@/lib/legal";

/** Chân trang công khai — nơi Meta/người dùng luôn tìm thấy 2 trang pháp lý. */
export default function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-gray-200 bg-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-3 md:px-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-lg">
              🚀
            </span>
            <p className="text-sm font-bold text-gray-900">{APP_NAME}</p>
          </div>
          <p className="mt-3 text-sm text-gray-500">
            AI viết nội dung · Tìm media · Đăng bài tự động lên Facebook Page.
          </p>
        </div>

        <div>
          <p className="text-sm font-semibold text-gray-900">Sản phẩm</p>
          <ul className="mt-3 space-y-2 text-sm text-gray-500">
            <li>
              <Link href="/#tinh-nang" className="transition hover:text-gray-900">
                Tính năng
              </Link>
            </li>
            <li>
              <Link href="/login" className="transition hover:text-gray-900">
                Đăng nhập
              </Link>
            </li>
            <li>
              <Link href="/register" className="transition hover:text-gray-900">
                Đăng ký
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <p className="text-sm font-semibold text-gray-900">Pháp lý &amp; hỗ trợ</p>
          <ul className="mt-3 space-y-2 text-sm text-gray-500">
            {LEGAL_LINKS.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="transition hover:text-gray-900">
                  {item.label}
                </Link>
              </li>
            ))}
            <li>
              <a
                href={`mailto:${LEGAL.supportEmail}`}
                className="transition hover:text-gray-900"
              >
                {LEGAL.supportEmail}
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-gray-200 px-4 py-5 md:px-6">
        <p className="mx-auto max-w-6xl text-xs text-gray-500">
          © {year} {APP_NAME} · Vận hành bởi {LEGAL.companyName}. Không liên kết,
          không được Meta xác nhận và không đại diện cho Meta Platforms, Inc.
        </p>
      </div>
    </footer>
  );
}
