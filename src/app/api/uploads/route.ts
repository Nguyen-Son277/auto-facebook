import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/dal";
import { saveUpload } from "@/lib/uploads";

// ============================================================
// POST /api/uploads — nhận file video từ máy người dùng.
//
// Dùng Route Handler (không phải Server Action) vì Server Action bị giới
// hạn body 1MB mặc định; Route Handler stream được file lớn.
// ============================================================

export async function POST(request: Request) {
  const user = await requireCurrentUser();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Không đọc được dữ liệu upload." },
      { status: 400 }
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "Thiếu file trong request." },
      { status: 400 }
    );
  }

  const result = await saveUpload(user.id, file);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: true,
    storageKey: result.storageKey,
    size: result.size,
    mimeType: result.mimeType,
    // URL nội bộ để xem trước trong trình soạn thảo
    previewUrl: `/api/uploads/${result.storageKey}`,
  });
}
