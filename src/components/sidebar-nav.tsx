"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  isNavItemActive,
  navGroupsFor,
  navItemsFor,
  type NavItem,
} from "@/components/nav-items";

// ============================================================
// Điều hướng dashboard — MỘT nguồn dữ liệu (nav-items.ts) cho cả
// sidebar desktop lẫn thanh cuộn ngang trên mobile.
//
// Nhóm có nhãn (Bảng điều khiển · Nội dung · Kết nối · Hỗ trợ) giúp
// người dùng định vị nhanh thay vì một danh sách 12 mục phẳng.
// ============================================================

function NavLink({
  item,
  active,
  horizontal,
}: {
  item: NavItem;
  active: boolean;
  horizontal: boolean;
}) {
  return (
    <Link
      href={item.href}
      title={item.hint}
      aria-current={active ? "page" : undefined}
      className={`ui-nav-link ${horizontal ? "ui-nav-pill shrink-0" : ""} ${active ? "is-active" : ""}`}
    >
      <span className="ui-nav-icon" aria-hidden>
        {item.icon}
      </span>
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

export default function SidebarNav({
  orientation,
  role = "USER",
}: {
  orientation: "vertical" | "horizontal";
  role?: string;
}) {
  const pathname = usePathname();

  // Mobile: cuộn ngang, không có nhãn nhóm → gọn trong một hàng
  if (orientation === "horizontal") {
    return (
      <nav
        aria-label="Điều hướng chính"
        className="flex flex-row gap-1.5 overflow-x-auto px-4 py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {navItemsFor(role).map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={isNavItemActive(item, pathname)}
            horizontal
          />
        ))}
      </nav>
    );
  }

  const groups = navGroupsFor(role);

  return (
    <nav aria-label="Điều hướng chính" className="flex flex-col px-3 pb-2">
      {groups.map((group, gi) => (
        <div key={group.label} className={gi > 0 ? "mt-1" : undefined}>
          <p className="ui-nav-group-label">{group.label}</p>
          <div className="flex flex-col gap-[3px]">
            {group.items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={isNavItemActive(item, pathname)}
                horizontal={false}
              />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
