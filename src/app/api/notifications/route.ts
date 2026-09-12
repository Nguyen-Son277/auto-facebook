import { requireCurrentUser } from "@/lib/dal";
import { countUnread, listNotifications } from "@/lib/notify";

// ============================================================
// Hộp thư thông báo cho chuông trên header.
// GET: unread + n tin mới nhất CỦA CHÍNH user (theo session).
// ============================================================

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  // requireCurrentUser tự đọc session, chặn PENDING/REJECTED/buộc đổi MK
  const user = await requireCurrentUser();

  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 8), 1), 50);

  const [unread, items] = await Promise.all([
    countUnread(user.id),
    listNotifications(user.id, { limit }),
  ]);

  return Response.json(
    {
      unread,
      items: items.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        link: n.link,
        read: n.read,
        createdAt: n.createdAt.toISOString(),
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
