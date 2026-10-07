// ============================================================
// Danh mục điều hướng DUY NHẤT cho toàn bộ app shell.
//
// Sidebar (desktop), thanh cuộn ngang (mobile) và breadcrumb ở topbar
// đều đọc từ đây → không bao giờ lệch nhãn / thứ tự / trang activve.
// ============================================================

export type NavItem = {
  href: string;
  label: string;
  icon: string;
  /** Mô tả ngắn hiện khi rê chuột (title attribute). */
  hint?: string;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Bảng điều khiển",
    items: [
      { href: "/dashboard", label: "Tổng quan", icon: "📊", hint: "Số liệu & việc cần làm hôm nay" },
      { href: "/insights", label: "Số liệu", icon: "📈", hint: "Đọc số liệu thật và tự tối ưu" },
    ],
  },
  {
    label: "Nội dung",
    items: [
      { href: "/composer", label: "Soạn bài", icon: "✍️", hint: "AI viết nội dung + tìm media" },
      { href: "/autopilot", label: "Tự động đăng", icon: "🤖", hint: "Chế độ tự động theo lịch" },
      { href: "/calendar", label: "Lịch đăng", icon: "📅", hint: "Xem bài theo tháng" },
      { href: "/history", label: "Lịch sử đăng", icon: "🕘", hint: "Tất cả bài đã đăng" },
      { href: "/media", label: "Thư viện Media", icon: "🖼️", hint: "Ảnh · video · Google Drive" },
      { href: "/brand", label: "Thương hiệu", icon: "🏷️", hint: "Hồ sơ để AI viết đúng chất bạn" },
    ],
  },
  {
    label: "Kết nối",
    items: [
      { href: "/facebook-apps", label: "Facebook Apps", icon: "🔗", hint: "App ID · Access Token" },
      { href: "/pages", label: "Facebook Pages", icon: "📄", hint: "Trang sẽ nhận bài đăng" },
    ],
  },
  {
    label: "Hỗ trợ",
    items: [
      { href: "/docs", label: "Hướng dẫn", icon: "📚", hint: "Tài liệu & câu hỏi" },
      { href: "/settings", label: "Cài đặt", icon: "⚙️", hint: "AI · Pexels · giao diện" },
    ],
  },
];

export const ADMIN_GROUP: NavGroup = {
  label: "Quản trị",
  items: [
    { href: "/admin", label: "Quản trị", icon: "🛡️", hint: "Tài khoản & hệ thống" },
    { href: "/admin/docs", label: "Docs & Câu hỏi", icon: "📁", hint: "Ban hành tài liệu" },
    { href: "/admin/notifications", label: "Thông báo", icon: "📣", hint: "Soạn thông báo gửi đi" },
  ],
};

/** Danh sách nhóm theo quyền — ADMIN thấy thêm nhóm Quản trị. */
export function navGroupsFor(role?: string): NavGroup[] {
  return role === "ADMIN" ? [...NAV_GROUPS, ADMIN_GROUP] : NAV_GROUPS;
}

/** Mọi mục (phẳng) — dùng cho thanh điều hướng ngang trên mobile. */
export function navItemsFor(role?: string): NavItem[] {
  return navGroupsFor(role).flatMap((g) => g.items);
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Mục đang mở theo URL — dùng breadcrumb ở topbar. */
export function activeNavItem(pathname: string, role?: string): NavItem | undefined {
  return activeNavPath(pathname, role)?.item;
}

/** Nhóm + mục đang mở theo URL (khớp dài nhất để /admin/docs không bị /docs giành). */
export function activeNavPath(
  pathname: string,
  role?: string
): { group: NavGroup; item: NavItem } | null {
  const pairs = navGroupsFor(role).flatMap((group) =>
    group.items.map((item) => ({ group, item }))
  );
  const hit = pairs
    .sort((a, b) => b.item.href.length - a.item.href.length)
    .find(({ item }) => isNavItemActive(item, pathname));
  return hit ?? null;
}
