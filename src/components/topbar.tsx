import Link from "next/link";
import Breadcrumb from "@/components/breadcrumb";
import ThemeToggle from "@/components/theme-toggle";
import NotificationBell from "@/components/notification-bell";

// ============================================================
// Thanh trên cùng (desktop) — breadcrumb + thao tác thường dùng.
// Nằm trên nền mờ có backdrop-blur nên nội dung trôi qua vẫn đọc được.
// ============================================================

export default function Topbar({
  role,
  unread,
}: {
  role: string;
  unread: number;
}) {
  return (
    <header className="sticky top-0 z-30 hidden border-b border-gray-200 bg-topbar backdrop-blur-md md:block">
      <div className="mx-auto flex h-14 w-full max-w-[1440px] items-center gap-3 px-6 lg:px-8">
        <Breadcrumb role={role} />

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/composer"
            className="ui-btn ui-btn-primary ui-btn-sm"
            title="Soạn bài mới với AI"
          >
            <span aria-hidden>✍️</span>
            Soạn bài
          </Link>
          <ThemeToggle />
          <NotificationBell initialUnread={unread} testIdSuffix="-desktop" />
        </div>
      </div>
    </header>
  );
}
