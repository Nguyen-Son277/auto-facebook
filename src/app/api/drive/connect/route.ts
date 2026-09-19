import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireCurrentUser } from "@/lib/dal";
import { buildDriveAuthUrl, hasDriveRedirect, isDriveConfigured } from "@/lib/drive";
import { STATE_COOKIE, STATE_TTL_MS, createState } from "@/lib/drive-state";

// ============================================================
// GET /api/drive/connect — bắt đầu luồng cấp quyền Google Drive.
//
// 1. Chỉ người đã đăng nhập mới bắt đầu được.
// 2. Sinh state ký HMAC gắn với userId, lưu vào cookie httpOnly để bước
//    callback đối chiếu (chống CSRF).
// 3. Chuyển hướng sang màn hình đồng ý của Google.
//
// `access_type=offline` + `prompt=consent` là BẮT BUỘC: thiếu chúng Google
// không trả refresh token, và người dùng sẽ phải cấp quyền lại mỗi ngày.
// ============================================================

export async function GET(request: Request) {
  const user = await requireCurrentUser();

  if (!isDriveConfigured()) {
    return NextResponse.redirect(
      new URL("/settings?drive=not_configured", request.url),
      { status: 302 }
    );
  }

  const state = createState(user.id);
  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(STATE_TTL_MS / 1000),
  });

  const origin = new URL(request.url).origin;

  // Kiểm tra redirect_uri TRƯỚC khi sang Google: nếu thiếu, Google chỉ hiện
  // màn hình "redirect_uri_mismatch" rất khó đoán nguyên nhân.
  if (!hasDriveRedirect(origin)) {
    return NextResponse.redirect(
      new URL("/settings?drive=missing_redirect", request.url),
      { status: 302 }
    );
  }

  return NextResponse.redirect(buildDriveAuthUrl(state, origin), { status: 302 });
}
