import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { encryptValue } from "@/lib/settings";
import {
  driveErrorMessage,
  emailFromIdToken,
  exchangeDriveCode,
  markConnectionError,
} from "@/lib/drive";
import { STATE_COOKIE, verifyState } from "@/lib/drive-state";

// ============================================================
// GET /api/drive/callback — Google trả authorization code về đây.
//
// Kiểm tra theo thứ tự:
//   1. `error` (người dùng bấm "Từ chối") → báo nhẹ nhàng, không phải lỗi.
//   2. state: chữ ký HMAC + hạn dùng + khớp cookie (chống CSRF).
//   3. state thuộc ĐÚNG người đang đăng nhập — không cho gắn Drive của người
//      khác vào tài khoản mình.
// Sau đó đổi code lấy token, lưu refresh token (đã mã hóa) và quay về Cài đặt.
//
// Mọi nhánh lỗi đều REDIRECT (không trả JSON): người dùng đang ở trình duyệt,
// một trang JSON trắng sẽ khiến họ tưởng app hỏng.
// ============================================================

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const denied = url.searchParams.get("error");

  const cookieStore = await cookies();
  const cookieState = cookieStore.get(STATE_COOKIE)?.value;

  /** Quay về Cài đặt kèm mã trạng thái; luôn xoá cookie state. */
  const back = (params: Record<string, string>) => {
    const target = new URL("/settings", url.origin);
    for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
    const res = NextResponse.redirect(target, { status: 302 });
    res.cookies.delete(STATE_COOKIE);
    return res;
  };

  if (denied) {
    return back({ drive: "denied" });
  }
  if (!code) {
    return back({ drive: "error", msg: "Google không trả về mã uỷ quyền." });
  }

  const verified = verifyState(stateParam, cookieState);
  if (!verified.valid) {
    return back({ drive: "error", msg: verified.reason ?? "State không hợp lệ." });
  }

  // Chỉ được nối Drive cho CHÍNH tài khoản đã bắt đầu luồng.
  // (requireCurrentUser không dùng được ở đây vì cần đọc session để so sánh;
  //  state đã được ký bằng SESSION_SECRET nên userId trong đó là đáng tin.)
  const current = await prisma.user.findUnique({
    where: { id: verified.userId },
    select: { id: true },
  });
  if (!current) {
    return back({ drive: "error", msg: "Tài khoản không còn tồn tại." });
  }

  try {
    const tokens = await exchangeDriveCode(code, url.origin);
    if (!tokens.accessToken) {
      return back({ drive: "error", msg: "Google không trả về access token." });
    }

    const email = emailFromIdToken(tokens.idToken);
    const expiresAt = new Date(
      Date.now() + (tokens.expiresIn > 0 ? tokens.expiresIn : 3600) * 1000
    );

    const existing = await prisma.driveConnection.findUnique({
      where: { userId: current.id },
      select: { id: true, refreshToken: true },
    });

    // Google chỉ trả refresh_token ở lần cấp quyền đầu (hoặc khi prompt=consent).
    // Không có refresh token mới thì GIỮ refresh token cũ, tuyệt đối không ghi đè
    // bằng chuỗi rỗng — làm vậy là tự ngắt kết nối của người dùng.
    const refreshToken = tokens.refreshToken
      ? encryptValue(tokens.refreshToken)
      : existing?.refreshToken;

    if (!refreshToken) {
      return back({
        drive: "error",
        msg: "Google không trả refresh token — hãy thử lại và bấm “Cho phép” ở bước đồng ý quyền.",
      });
    }

    const data = {
      googleEmail: email,
      scope: tokens.scope ?? "",
      refreshToken,
      accessToken: encryptValue(tokens.accessToken),
      accessTokenExpiresAt: expiresAt,
      lastRefreshedAt: new Date(),
      status: "ACTIVE",
      lastError: null,
    };

    await prisma.driveConnection.upsert({
      where: { userId: current.id },
      create: { userId: current.id, ...data },
      update: data,
    });

    return back({ drive: "connected" });
  } catch (err) {
    // Ghi lỗi lên connection (nếu đã có) để card Cài đặt cảnh báo được
    const existing = await prisma.driveConnection.findUnique({
      where: { userId: current.id },
      select: { id: true },
    });
    if (existing) await markConnectionError(existing.id, driveErrorMessage(err), "NEEDS_REAUTH");

    return back({ drive: "error", msg: driveErrorMessage(err) });
  }
}
