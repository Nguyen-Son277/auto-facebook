import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "session";

// Trang public: không yêu cầu đăng nhập
const PUBLIC_PATHS = ["/login", "/setup"];

/**
 * API tự xử lý xác thực riêng nên proxy không được chuyển hướng:
 * - /api/uploads/*  → requireCurrentUser() trong từng route
 * - /api/cron/*     → máy gọi máy, xác thực bằng CRON_SECRET
 * Nếu proxy chuyển hướng các route này về /login thì cron sẽ không bao giờ chạy.
 */
const API_PREFIX = "/api/";

/**
 * Proxy (Next.js 16 thay cho middleware): chặn optimistic ở biên mạng.
 * Đây KHÔNG phải lớp xác thực đầy đủ — mỗi trang/route private vẫn phải
 * gọi requireCurrentUser() để kiểm tra session thật (DAL).
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith(API_PREFIX)) {
    return NextResponse.next();
  }

  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );

  if (!hasSessionCookie && !isPublic) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (hasSessionCookie && (pathname === "/login" || pathname === "/setup")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Tất cả route trừ file tĩnh và API nội bộ của Next
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|txt|xml)$).*)",
  ],
};
