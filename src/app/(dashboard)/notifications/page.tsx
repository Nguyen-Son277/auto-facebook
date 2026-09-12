import type { Metadata } from "next";
import { requireCurrentUser } from "@/lib/dal";
import { countUnread, listNotifications } from "@/lib/notify";
import PageHeader from "@/components/page-header";
import NotificationsClient from "@/components/notifications-client";

export const metadata: Metadata = {
  title: "Thông báo | FB Marketing Auto",
};

export const dynamic = "force-dynamic";

/**
 * Hộp thư đầy đủ của user: sự kiện bài viết, tin từ admin, cảnh báo hệ thống.
 * Mặc định hiện Chưa đọc trước — bấm "Tất cả" để xem lịch sử.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireCurrentUser();
  const params = await searchParams;
  const showAll = params.filter === "all";

  const [unread, items] = await Promise.all([
    countUnread(user.id),
    listNotifications(user.id, {
      limit: 100,
      unreadOnly: !showAll,
    }),
  ]);

  return (
    <div>
      <PageHeader
        title="Thông báo"
        description="Mọi hoạt động liên quan đến tài khoản của bạn: bài đăng, nhắc từ quản trị viên và cảnh báo hệ thống"
      />
      <div className="mt-5">
        <NotificationsClient
          initialUnread={unread}
          showAll={showAll}
          items={items.map((n) => ({
            id: n.id,
            type: n.type,
            title: n.title,
            body: n.body,
            link: n.link,
            read: n.read,
            createdAt: n.createdAt.toISOString(),
          }))}
        />
      </div>
    </div>
  );
}
