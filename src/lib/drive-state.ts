import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// ============================================================
// STATE của luồng OAuth Google Drive — phần THUẦN (chỉ crypto, không DB).
//
// VÌ SAO CẦN
// Endpoint callback là URL công khai: kẻ khác có thể tự bấm "kết nối Drive"
// bằng tài khoản Google của họ rồi lừa trình duyệt nạn nhân mở callback
// (CSRF). State làm hai việc:
//   1. Gắn state với ĐÚNG người đang đăng nhập (ký HMAC bằng SESSION_SECRET).
//   2. Chỉ cho phép quay về một danh sách đường dẫn nội bộ (chống open redirect).
//
// Format: "<payloadB64url>.<hmacB64url>", payload = { u: userId, e: exp(ms), n: nonce }
// ============================================================

/** State sống 10 phút — đủ để người dùng bấm đồng ý trên Google. */
export const STATE_TTL_MS = 10 * 60 * 1000;

/** Cookie giữ state để đối chiếu ở bước callback. */
export const STATE_COOKIE = "drive_oauth_state";

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 16) {
    throw new Error("SESSION_SECRET chưa cấu hình — không thể ký state OAuth.");
  }
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

function b64url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

/** Tạo state mới cho một người dùng. */
export function createState(userId: string, now: number = Date.now()): string {
  const payload = b64url(
    JSON.stringify({ u: userId, e: now + STATE_TTL_MS, n: randomBytes(12).toString("hex") })
  );
  return `${payload}.${sign(payload)}`;
}

export type VerifiedState = { userId: string; valid: boolean; reason?: string };

/**
 * Kiểm tra state: chữ ký, hạn dùng, và (nếu có) khớp với cookie đã phát.
 * Không bao giờ ném lỗi — trả về `valid: false` kèm lý do để route tự quyết.
 */
export function verifyState(
  state: string | null | undefined,
  cookieValue: string | null | undefined,
  now: number = Date.now()
): VerifiedState {
  if (!state) return { userId: "", valid: false, reason: "Thiếu tham số state." };

  const parts = state.split(".");
  if (parts.length !== 2) {
    return { userId: "", valid: false, reason: "State không đúng định dạng." };
  }
  const [payload, signature] = parts;

  let expected: string;
  try {
    expected = sign(payload);
  } catch (err) {
    return { userId: "", valid: false, reason: err instanceof Error ? err.message : "Lỗi ký state." };
  }

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { userId: "", valid: false, reason: "Chữ ký state không hợp lệ." };
  }

  // Cookie phải khớp state trên URL: nếu không, state này do kẻ khác tạo.
  if (!cookieValue || cookieValue !== state) {
    return { userId: "", valid: false, reason: "State không khớp phiên trình duyệt." };
  }

  let parsed: { u?: unknown; e?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      u?: unknown;
      e?: unknown;
    };
  } catch {
    return { userId: "", valid: false, reason: "State không đọc được." };
  }

  const userId = typeof parsed.u === "string" ? parsed.u : "";
  const exp = typeof parsed.e === "number" ? parsed.e : 0;
  if (!userId) return { userId: "", valid: false, reason: "State thiếu người dùng." };
  if (exp < now) return { userId, valid: false, reason: "State đã hết hạn — bấm kết nối lại." };

  return { userId, valid: true };
}

// ============================================================
// Chống open redirect: chỉ cho quay về những đường dẫn của chính app.
// ============================================================

const ALLOWED_REDIRECTS = ["/settings", "/brand", "/autopilot", "/facebook-apps"];

/** Đường dẫn an toàn để redirect sau callback (mặc định /settings). */
export function safeRedirectPath(raw: string | null | undefined): string {
  if (!raw) return "/settings";
  // Bỏ query/hash khi so khớp, và từ chối mọi thứ không bắt đầu bằng "/"
  const path = raw.split("?")[0].split("#")[0];
  if (!path.startsWith("/") || path.startsWith("//")) return "/settings";
  return ALLOWED_REDIRECTS.includes(path) ? path : "/settings";
}
