import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "session";

/**
 * Trang public: không yêu cầu đăng nhập.
 * - "/" là trang chủ giới thiệu (người đã đăng nhập sẽ được trang tự chuyển
 *   vào /dashboard).
 * - 2 trang pháp lý BẮT BUỘC phải công khai: Meta App Review và người dùng
 *   đều cần đọc được chính sách bảo mật / điều khoản dịch vụ khi chưa có
 *   tài khoản.
 */
const PUBLIC_PATHS = [
  "/",
  "/login",
  "/setup",
  "/register",
  "/chinh-sach-bao-mat",
  "/dieu-khoan-dich-vu",
];

/**
 * So khớp đường dẫn public: "/" chỉ khớp đúng gốc, các mục còn lại khớp cả
 * tuyến con (ví dụ "/login/abc"). So khớp "/" bằng startsWith sẽ mở toàn bộ
 * website nên phải xử lý riêng.
 */
function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`)
  );
}

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
  const isPublic = isPublicPath(pathname);

  if (!hasSessionCookie && !isPublic) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Đã đăng nhập thì không cần xem lại trang đăng nhập / đăng ký / thiết lập.
  // Riêng trang chủ "/" để trang tự quyết định (server component đã kiểm tra
  // session thật trong DB rồi mới chuyển vào /dashboard).
  if (
    hasSessionCookie &&
    (pathname === "/login" || pathname === "/setup" || pathname === "/register")
  ) {
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
