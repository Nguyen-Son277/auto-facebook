"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { dismissOnboarding } from "@/app/actions/settings";

// ============================================================
// Hướng dẫn ban đầu (onboarding) — hiện cho user lần đầu đăng nhập.
//
// Card checklist 5 bước đơn giản, mỗi bước dẫn thẳng tới trang tương
// ứng. Bấm "Hoàn thành" đặt cờ app.onboardingDone → không hiện lại.
// Đã tắt rồi thì có thể đọc lại mọi lúc ở trang /docs.
// ============================================================

const STEPS = [
  {
    n: 1,
    icon: "🔗",
    title: "Thêm Facebook App",
    desc: "Nhập App ID + App Secret của bạn để cấp quyền đăng bài",
    href: "/facebook-apps",
    cta: "Thêm App",
  },
  {
    n: 2,
    icon: "📄",
    title: "Đồng bộ Pages",
    desc: "Dán User Access Token để nhập các trang Facebook bạn quản lý",
    href: "/facebook-apps",
    cta: "Đồng bộ",
  },
  {
    n: 3,
    icon: "🔑",
    title: "Cấu hình AI & Pexels",
    desc: "Kết nối AI viết nội dung và kho ảnh Pexels",
    href: "/settings",
    cta: "Cấu hình",
  },
  {
    n: 4,
    icon: "🏷️",
    title: "Tạo thương hiệu",
    desc: "Mô tả doanh nghiệp một lần — AI viết đúng chất bạn mãi mãi",
    href: "/brand",
    cta: "Tạo thương hiệu",
  },
  {
    n: 5,
    icon: "✍️",
    title: "Soạn bài đầu tiên",
    desc: "AI gợi ý 2–3 phương án, bạn chọn rồi đăng ngay hoặc hẹn giờ",
    href: "/composer",
    cta: "Soạn bài",
  },
];

export default function OnboardingGuide() {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [openStep, setOpenStep] = useState<number>(1);

  if (dismissed) return null;

  function onDismiss() {
    if (
      !window.confirm(
        "Ẩn hướng dẫn này? Bạn vẫn có thể đọc lại mọi lúc ở trang 📚 Hướng dẫn."
      )
    ) {
      return;
    }
    setDismissed(true);
    startTransition(async () => {
      await dismissOnboarding();
      router.refresh();
    });
  }

  return (
    <section
      className="mb-6 rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-5"
      data-testid="onboarding-guide"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-gray-900">
            🚀 Chào mừng bạn! Bắt đầu trong 5 bước
          </h2>
          <p className="mt-0.5 text-sm text-gray-600">
            Làm theo thứ tự dưới đây — mỗi bước chỉ mất vài phút
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          disabled={pending}
          className="rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 transition hover:bg-blue-100 disabled:opacity-50"
          data-testid="onboarding-dismiss"
        >
          {pending ? "Đang lưu..." : "✓ Hoàn thành — không hiện lại"}
        </button>
      </div>

      <ol className="mt-4 space-y-2">
        {STEPS.map((step) => {
          const open = openStep === step.n;
          return (
            <li
              key={step.n}
              className="rounded-xl border border-blue-100 bg-white/80"
              data-testid={`onboarding-step-${step.n}`}
            >
              <button
                type="button"
                onClick={() => setOpenStep(open ? 0 : step.n)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
                  {step.n}
                </span>
                <span className="text-xl">{step.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-900">
                    {step.title}
                  </span>
                  {!open && (
                    <span className="block truncate text-xs text-gray-500">{step.desc}</span>
                  )}
                </span>
                <span className="text-xs text-gray-400">{open ? "▲" : "▼"}</span>
              </button>
              {open && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-blue-100 px-4 py-3 pl-15">
                  <p className="text-xs text-gray-600">{step.desc}</p>
                  <Link
                    href={step.href}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-700"
                  >
                    {step.cta} →
                  </Link>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <p className="mt-3 text-xs text-gray-500">
        Cần hướng dẫn chi tiết hơn? Đọc đầy đủ tại{" "}
        <Link href="/docs" className="font-medium text-blue-600 hover:underline">
          📚 Hướng dẫn sử dụng
        </Link>
      </p>
    </section>
  );
}
