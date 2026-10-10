import { requireCurrentUser, requireNoPendingPasswordChange } from "@/lib/dal";
import { countUnread } from "@/lib/notify";
import { logout } from "@/app/actions/auth";
import SidebarNav from "@/components/sidebar-nav";
import Topbar from "@/components/topbar";
import NotificationBell from "@/components/notification-bell";
import NotificationToast from "@/components/notification-toast";
import { ToastHost } from "@/components/toast-provider";

/** Chữ cái đầu của tên/email — dùng làm avatar tròn. */
function initialsOf(name: string | null, email: string): string {
  const source = (name?.trim() || email).split(/[\s@._-]+/).filter(Boolean);
  return source
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireCurrentUser();
  // Mật khẩu tạm do admin cấp → phải đổi trước khi dùng bất kỳ trang nào
  await requireNoPendingPasswordChange();

  // Số chưa đọc render sẵn từ server — chuông chỉ việc poll để cập nhật
  const unread = await countUnread(user.id);
  const displayName = user.name ?? user.email;

  return (
    <div className="flex min-h-screen bg-background bg-[image:var(--app-glow)]">
      {/* ===== Sidebar desktop — sticky full-height, cuộn riêng phần menu ===== */}
      <aside className="hidden w-[272px] shrink-0 flex-col border-r border-gray-200/80 bg-sidebar shadow-[8px_0_30px_-28px_rgb(15_23_42/0.35)] md:sticky md:top-0 md:flex md:h-screen">
        {/* Thương hiệu */}
        <div className="px-4 pb-4 pt-4">
          <div className="flex items-center gap-3 rounded-2xl border border-blue-100/70 bg-gradient-to-br from-blue-50/80 via-surface to-violet-50/60 px-3 py-3">
            <span className="ui-logo h-10 w-10 text-xl shadow-raised" aria-hidden>
              🚀
            </span>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-bold tracking-tight text-gray-900">
                FB Marketing Auto
              </p>
              <p className="mt-0.5 truncate text-[11px] text-gray-400">
                AI Content · Auto Post
              </p>
            </div>
          </div>
        </div>

        {/* Menu — cuộn độc lập để footer luôn nằm trong viewport */}
        <div className="min-h-0 flex-1 overflow-y-auto pt-0.5 pb-1">
          <SidebarNav orientation="vertical" role={user.role} />
        </div>

        {/* Tài khoản — một hàng cho gọn: avatar · tên · đăng xuất */}
        <div className="border-t border-gray-200/80 p-3">
          <div className="flex items-center gap-2.5 rounded-2xl border border-gray-200/80 bg-sunken px-2.5 py-2.5 shadow-card">
            <span className="ui-avatar h-9 w-9 text-xs" aria-hidden>
              {initialsOf(user.name, user.email)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-gray-900">
                <span className="truncate">{displayName}</span>
                {user.role === "ADMIN" && (
                  <span className="ui-chip shrink-0 bg-violet-100 text-[10px] text-violet-700">
                    Admin
                  </span>
                )}
              </p>
              <p className="truncate text-xs text-gray-500">{user.email}</p>
            </div>
            <form action={logout}>
              <button
                type="submit"
                aria-label="Đăng xuất"
                title="Đăng xuất khỏi tài khoản"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-surface text-sm text-gray-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
              >
                <span aria-hidden>⎋</span>
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* ===== Cột nội dung ===== */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar desktop: breadcrumb + Soạn bài + theme + chuông */}
        <Topbar role={user.role} unread={unread} />

        {/* Header mobile */}
        <header className="sticky top-0 z-30 border-b border-gray-200/80 bg-topbar shadow-card backdrop-blur-xl md:hidden">
          <div className="flex items-center gap-2 px-4 py-2.5">
            <span className="ui-logo h-8 w-8 text-base" aria-hidden>
              🚀
            </span>
            <p className="min-w-0 flex-1 truncate text-sm font-bold tracking-tight text-gray-900">
              FB Marketing Auto
            </p>
            <NotificationBell initialUnread={unread} testIdSuffix="-mobile" />
            <form action={logout}>
              <button
                type="submit"
                className="ui-btn ui-btn-ghost ui-btn-sm"
                title="Đăng xuất"
              >
                Thoát
              </button>
            </form>
          </div>
          <div className="border-t border-gray-200/70">
            <SidebarNav orientation="horizontal" role={user.role} />
          </div>
        </header>

        <main className="flex-1 bg-transparent">
          <div className="mx-auto w-full max-w-[1440px] px-4 py-6 md:px-6 md:py-8 lg:px-8">
            {children}
          </div>
        </main>
      </div>

      {/* Toast dùng chung — popup góc dưới phải, mọi trang dashboard.
          NotificationToast chỉ là producer (poll DB), ToastHost lo hiển thị. */}
      <ToastHost />
      <NotificationToast />
    </div>
  );
}
