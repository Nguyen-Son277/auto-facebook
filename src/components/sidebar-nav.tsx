"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Tổng quan", icon: "📊" },
  { href: "/composer", label: "Soạn bài", icon: "✍️" },
  { href: "/autopilot", label: "Tự động đăng", icon: "🤖" },
  { href: "/brand", label: "Thương hiệu", icon: "🏷️" },
  { href: "/media", label: "Thư viện Media", icon: "🖼️" },
  { href: "/history", label: "Lịch sử đăng", icon: "🕘" },
  { href: "/calendar", label: "Lịch đăng", icon: "📅" },
  { href: "/facebook-apps", label: "Facebook Apps", icon: "🔗" },
  { href: "/pages", label: "Facebook Pages", icon: "📄" },
  { href: "/settings", label: "Cài đặt", icon: "⚙️" },
];

export default function SidebarNav({ orientation }: { orientation: "vertical" | "horizontal" }) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      className={
        orientation === "vertical"
          ? "flex flex-col gap-1 px-3"
          : "flex flex-row gap-1 overflow-x-auto px-3"
      }
    >
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
            orientation === "vertical" ? "" : "shrink-0"
          } ${
            isActive(item.href)
              ? "bg-blue-50 text-blue-700"
              : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
          }`}
        >
          <span aria-hidden>{item.icon}</span>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
