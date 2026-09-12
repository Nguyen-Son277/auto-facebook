import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/dal";
import { createUploadTarget } from "@/lib/uploads";

// ============================================================
// POST /api/uploads — cấp signed upload URL cho trình duyệt.
//
// Trên Vercel, Function chỉ nhận body tối đa 4.5MB nên KHÔNG thể nhận file
// video trực tiếp. Vì vậy route này chỉ nhận metadata (tên file, mime, dung
// lượng), kiểm tra hợp lệ rồi trả về URL có chữ ký để browser PUT file thẳng
// lên Supabase Storage.
// ============================================================

type SignBody = {
  fileName?: unknown;
  mimeType?: unknown;
  size?: unknown;
};

export async function POST(request: Request) {
  const user = await requireCurrentUser();

  let body: SignBody;
  try {
    body = (await request.json()) as SignBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Không đọc được dữ liệu yêu cầu tải lên." },
      { status: 400 }
    );
  }

  const fileName = typeof body.fileName === "string" ? body.fileName : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";
  const size = typeof body.size === "number" ? body.size : Number(body.size);

  const result = await createUploadTarget(user.id, fileName, mimeType, size);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    storageKey: result.storageKey,
    uploadUrl: result.uploadUrl,
    size: result.size,
    mimeType: result.mimeType,
    // URL nội bộ để xem trước trong trình soạn thảo (route này redirect sang Storage)
    previewUrl: `/api/uploads/${result.storageKey}`,
  });
}
