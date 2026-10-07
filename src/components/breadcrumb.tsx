"use client";

import { usePathname } from "next/navigation";
import { activeNavPath } from "@/components/nav-items";

// ============================================================
// Đường dẫn trang ở topbar — tự biết đang ở nhóm/mục nào theo URL.
// Giúp định vị khi vào trang sâu (vd: /admin/docs, /posts/<id>).
// ============================================================

export default function Breadcrumb({ role }: { role?: string }) {
  const pathname = usePathname();
  const hit = activeNavPath(pathname, role);

  if (!hit) {
    return (
      <p className="ui-kicker truncate">
        {pathname.startsWith("/posts") ? "Bài đăng" : "FB Marketing Auto"}
      </p>
    );
  }

  return (
    <nav aria-label="Đường dẫn trang" className="flex min-w-0 items-center gap-2">
      <span className="ui-kicker hidden truncate sm:inline">{hit.group.label}</span>
      <span aria-hidden className="hidden text-gray-300 sm:inline">
        /
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-gray-900">
        <span aria-hidden>{hit.item.icon}</span>
        <span className="truncate">{hit.item.label}</span>
      </span>
    </nav>
  );
}
