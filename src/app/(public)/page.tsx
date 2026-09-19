import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/dal";
import { APP_NAME, LEGAL_LINKS } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Trang chủ",
  description:
    "FB Marketing Auto — tự động viết nội dung bằng AI, tìm ảnh/video từ Pexels và Google Drive, hẹn giờ và đăng bài lên nhiều Facebook Page.",
};

const FEATURES = [
  {
    icon: "✍️",
    title: "AI viết nội dung theo thương hiệu",
    description:
      "Mô tả doanh nghiệp một lần trong hồ sơ thương hiệu; AI dùng hồ sơ đó, trụ cột nội dung và kho tài liệu để viết bài đúng ngành hàng, đúng giọng điệu.",
  },
  {
    icon: "🖼️",
    title: "Ảnh & video từ nhiều nguồn",
    description:
      "Tìm ảnh/video stock trên Pexels, tải file từ máy lên, hoặc dùng thư mục Google Drive riêng của bạn — ảnh Pexels tự kèm thông tin ghi công tác giả.",
  },
  {
    icon: "🤖",
    title: "Tự động đăng theo kế hoạch",
    description:
      "Bật AutoPilot để hệ thống tự lên kế hoạch, tự viết và tự hẹn lịch bài mới; mọi bài đều nằm trong lịch để bạn xem lại và duyệt.",
  },
  {
    icon: "📅",
    title: "Lịch đăng đúng múi giờ",
    description:
      "Hẹn giờ đăng chính xác theo múi giờ của từng workspace — không bị lệch giờ, xem toàn bộ bài đã hẹn trên một lịch duy nhất.",
  },
  {
    icon: "🔗",
    title: "Nhiều Facebook App, nhiều Page",
    description:
      "Mỗi khu làm việc thêm được nhiều Facebook Graph API App để lấy token cho các nhóm Page khác nhau; lỗi một App không ảnh hưởng các App còn lại.",
  },
  {
    icon: "🏷️",
    title: "Nhiều workspace, nhiều thương hiệu",
    description:
      "Tách dữ liệu theo từng khu làm việc: Page, thương hiệu, bài viết, media và lịch đăng được quản lý riêng, không lẫn nhau.",
  },
  {
    icon: "🕘",
    title: "Lịch sử & thông báo",
    description:
      "Tra cứu lại bài đã đăng, xem chi tiết lỗi khi đăng thất bại và nhận thông báo ngay trong ứng dụng khi có sự cố.",
  },
  {
    icon: "🔒",
    title: "Token được mã hoá",
    description:
      "App Secret, access token Facebook, API key và refresh token Drive đều được mã hoá AES-256-GCM; mật khẩu băm bằng bcrypt.",
  },
] as const;

const STEPS = [
  {
    step: "01",
    title: "Kết nối Page",
    description:
      "Thêm Facebook App, đồng bộ danh sách Page và chọn Page muốn đăng bài.",
  },
  {
    step: "02",
    title: "Tạo hồ sơ thương hiệu",
    description:
      "Điền thông tin doanh nghiệp, khách hàng mục tiêu, giọng điệu và trụ cột nội dung.",
  },
  {
    step: "03",
    title: "Soạn hoặc để AutoPilot chạy",
    description:
      "Viết bài thủ công cùng AI rồi hẹn giờ, hoặc bật chế độ tự động để hệ thống tự lên lịch.",
  },
] as const;

/** Trang chủ công khai: người đã đăng nhập vào thẳng dashboard. */
export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <>
      {/* ---------- Hero ---------- */}
      <section className="border-b border-gray-200 bg-gradient-to-br from-blue-50 via-white to-indigo-100">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 md:grid-cols-2 md:px-6 md:py-20">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-medium text-blue-700">
              🚀 AI Content · Auto Post
            </span>
            <h1 className="mt-4 text-3xl font-bold text-gray-900 md:text-4xl">
              Đăng bài Facebook Page đều đặn mà không cần ngồi viết mỗi ngày
            </h1>
            <p className="mt-4 text-base text-gray-600">
              {APP_NAME} giúp bạn viết nội dung bằng AI theo đúng hồ sơ thương
              hiệu, tìm ảnh/video phù hợp, hẹn giờ và đăng bài lên nhiều
              Facebook Page trong cùng một chỗ.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/login"
                className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
              >
                Đăng nhập
              </Link>
              <Link
                href="/register"
                className="rounded-xl border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
              >
                Đăng ký tài khoản
              </Link>
            </div>

            <p className="mt-4 text-xs text-gray-500">
              Hệ thống vận hành riêng tư: tài khoản mới cần quản trị viên duyệt
              trước khi sử dụng.
            </p>
          </div>

          {/* Minh hoạ giao diện — dựng bằng HTML/CSS, không cần ảnh chụp */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-lg">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-900">
                Tổng quan hoạt động
              </p>
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                Đang chạy
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              {[
                { label: "Page đã kết nối", value: "3" },
                { label: "Đã đăng", value: "48" },
                { label: "Đang chờ lịch", value: "12" },
                { label: "Bản nháp", value: "5" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-gray-200 p-3"
                >
                  <p className="text-2xl font-bold text-gray-900">
                    {item.value}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">{item.label}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-3">
              {[
                {
                  icon: "✅",
                  badge: "Đã đăng",
                  badgeClass: "bg-emerald-100 text-emerald-700",
                  text: "Ưu đãi cuối tuần cho khách hàng thân thiết…",
                },
                {
                  icon: "⏰",
                  badge: "Đã lên lịch",
                  badgeClass: "bg-amber-100 text-amber-700",
                  text: "3 lý do nên chọn sản phẩm của chúng tôi…",
                },
                {
                  icon: "📝",
                  badge: "Nháp",
                  badgeClass: "bg-gray-100 text-gray-600",
                  text: "Câu chuyện thương hiệu trong 5 năm…",
                },
              ].map((row) => (
                <div
                  key={row.text}
                  className="flex items-center gap-3 rounded-xl border border-gray-200 px-3 py-2.5"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100 text-base">
                    {row.icon}
                  </span>
                  <p className="min-w-0 flex-1 truncate text-xs text-gray-600">
                    {row.text}
                  </p>
                  <span
                    className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-medium ${row.badgeClass}`}
                  >
                    {row.badge}
                  </span>
                </div>
              ))}
            </div>

            <p className="mt-4 text-center text-[11px] text-gray-400">
              Hình minh hoạ giao diện quản lý bài đăng
            </p>
          </div>
        </div>
      </section>

      {/* ---------- Tính năng ---------- */}
      <section id="tinh-nang" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14 md:px-6 md:py-16">
        <h2 className="text-2xl font-bold text-gray-900 md:text-3xl">
          Một nơi cho toàn bộ việc đăng bài Page
        </h2>
        <p className="mt-3 max-w-2xl text-sm text-gray-600">
          Từ ý tưởng nội dung đến bài đăng đã lên sóng: viết, chọn media, hẹn
          giờ, đăng và tra cứu lại lịch sử.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-blue-300 hover:shadow-sm"
            >
              <span className="text-2xl" aria-hidden>
                {feature.icon}
              </span>
              <h3 className="mt-3 font-semibold text-gray-900">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm text-gray-500">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Quy trình ---------- */}
      <section className="border-y border-gray-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-14 md:px-6 md:py-16">
          <h2 className="text-2xl font-bold text-gray-900 md:text-3xl">
            Bắt đầu trong 3 bước
          </h2>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {STEPS.map((item) => (
              <div
                key={item.step}
                className="rounded-2xl border border-gray-200 bg-gray-50 p-5"
              >
                <span className="text-sm font-bold text-blue-600">
                  {item.step}
                </span>
                <h3 className="mt-2 font-semibold text-gray-900">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm text-gray-500">
                  {item.description}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-10 rounded-2xl border border-blue-200 bg-blue-50 p-6 md:flex md:items-center md:justify-between md:gap-6">
            <div>
              <p className="font-semibold text-blue-900">
                Đã có tài khoản?
              </p>
              <p className="mt-1 text-sm text-blue-700">
                Đăng nhập để kết nối Page đầu tiên và tạo bài viết bằng AI.
              </p>
            </div>
            <div className="mt-4 flex flex-wrap gap-3 md:mt-0">
              <Link
                href="/login"
                className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                Đăng nhập
              </Link>
              <Link
                href="/register"
                className="rounded-xl border border-blue-300 bg-white px-5 py-2.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
              >
                Đăng ký
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Pháp lý ---------- */}
      <section className="mx-auto max-w-6xl px-4 py-10 md:px-6">
        <p className="text-xs text-gray-500">
          Khi sử dụng dịch vụ, bạn đồng ý với{" "}
          {LEGAL_LINKS.map((item, index) => (
            <span key={item.href}>
              {index > 0 && " và "}
              <Link
                href={item.href}
                className="font-medium text-blue-600 hover:underline"
              >
                {item.label.toLowerCase()}
              </Link>
            </span>
          ))}{" "}
          của chúng tôi.
        </p>
      </section>
    </>
  );
}
