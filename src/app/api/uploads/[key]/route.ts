import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/dal";
import { deleteUpload, signedReadUrl, uploadSize } from "@/lib/uploads";

// ============================================================
// GET    /api/uploads/[key] — chuyển hướng sang URL có chữ ký của Storage.
// DELETE /api/uploads/[key] — xóa file khi người dùng bỏ khỏi khay.
//
// key chỉ được là tên file do app sinh ra; object luôn nằm trong thư mục
// của user đang đăng nhập (xem lib/uploads.ts + lib/storage.ts).
//
// GET không stream file qua Function vì Vercel giới hạn response 4.5MB —
// thay vào đó trả 302 để trình duyệt tải trực tiếp từ Supabase Storage
// (Storage hỗ trợ Range nên video vẫn tua được).
// ============================================================

type Ctx = { params: Promise<{ key: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const user = await requireCurrentUser();
  const { key } = await params;

  const size = await uploadSize(user.id, key);
  if (size === null) {
    return NextResponse.json({ error: "Không tìm thấy file." }, { status: 404 });
  }

  let url: string;
  try {
    url = await signedReadUrl(user.id, key);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Không tạo được liên kết xem file." },
      { status: 500 }
    );
  }

  return NextResponse.redirect(url, {
    status: 302,
    headers: {
      // Signed URL hết hạn sau 1 giờ — không để trình duyệt/CDN giữ lâu hơn.
      "Cache-Control": "private, max-age=1800",
    },
  });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const user = await requireCurrentUser();
  const { key } = await params;
  await deleteUpload(user.id, key);
  return NextResponse.json({ ok: true });
}
