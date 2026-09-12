import { requireCurrentUser, requireNoPendingPasswordChange } from "@/lib/dal";
import { countUnread } from "@/lib/notify";
import { logout } from "@/app/actions/auth";
import SidebarNav from "@/components/sidebar-nav";
import NotificationBell from "@/components/notification-bell";

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

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar — desktop */}
      <aside className="hidden w-64 flex-col border-r border-gray-200 bg-white md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-xl">
            🚀
          </span>
          <div>
            <p className="text-sm font-bold text-gray-900">FB Marketing Auto</p>
            <p className="text-xs text-gray-400">AI Content · Auto Post</p>
          </div>
        </div>

        <div className="flex-1 py-2">
          <SidebarNav orientation="vertical" role={user.role} />
        </div>

        <div className="border-t border-gray-200 p-4">
          <p className="truncate text-sm font-medium text-gray-900">
            {user.name ?? user.email}
          </p>
          <p className="truncate text-xs text-gray-500">{user.email}</p>
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1">
              <form action={logout}>
                <button
                  type="submit"
                  className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50"
                >
                  Đăng xuất
                </button>
              </form>
            </div>
            <NotificationBell initialUnread={unread} />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar — mobile */}
        <header className="border-b border-gray-200 bg-white md:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
                🚀
              </span>
              <p className="text-sm font-bold text-gray-900">FB Marketing Auto</p>
            </div>
            <div className="flex items-center gap-2">
              <NotificationBell initialUnread={unread} testIdSuffix="-mobile" />
              <form action={logout}>
                <button
                  type="submit"
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700"
                >
                  Thoát
                </button>
              </form>
            </div>
          </div>
          <SidebarNav orientation="horizontal" role={user.role} />
        </header>

        <main className="flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
