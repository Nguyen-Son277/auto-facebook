// ============================================================
// Mock Google Drive + OAuth — dùng cho test E2E luồng ảnh Drive.
//
// Chạy: node scripts/mock-drive-server.mjs   (mặc định cổng 4040)
// Trỏ app về đây bằng biến môi trường:
//   GOOGLE_OAUTH_AUTH_URL=http://127.0.0.1:4040/o/oauth2/v2/auth
//   GOOGLE_OAUTH_TOKEN_URL=http://127.0.0.1:4040/token
//   GOOGLE_DRIVE_API_URL=http://127.0.0.1:4040/drive/v3
//   GOOGLE_USERINFO_URL=http://127.0.0.1:4040/oauth2/v3/userinfo
//
// Endpoint điều khiển (dùng trong test):
//   GET  /__control                  → trạng thái hiện tại
//   POST /__control?variant=<tên>    → đổi kịch bản dữ liệu
//   DELETE /__control                → về mặc định
//
// Kịch bản: IMAGES (mặc định) | MIXED | EMPTY | REVOKED | QUOTA
// ============================================================
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 4040);
const BASE = `http://127.0.0.1:${PORT}`;

const VALID_CLIENT = process.env.GOOGLE_CLIENT_ID ?? "mock-client-id";
const VALID_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "mock-client-secret";
const AUTHORIZED_ACCESS = "mock-drive-access-token";
const REFRESHED_ACCESS = "mock-drive-access-token-refreshed";
const USER_EMAIL = process.env.MOCK_DRIVE_EMAIL ?? "smoke@test.local";

/** Thư mục do "người dùng chọn qua Picker" trong test. */
const FOLDER_ID = "mock-folder-1";
const FOLDER_NAME = "Ảnh thương hiệu (mock)";

/** Ảnh JPEG 1x1 — đủ để trình duyệt/preview render. */
const PIXEL = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
    "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64"
);

const IMAGE_FILES = [
  {
    id: "file-anh-1",
    name: "Áo thun nam trắng.jpg",
    mimeType: "image/jpeg",
    size: "2451234",
    imageMediaMetadata: { width: 1600, height: 1200 },
    thumbnailLink: `${BASE}/thumb/file-anh-1`,
    modifiedTime: "2026-09-19T04:00:00.000Z",
  },
  {
    id: "file-anh-2",
    name: "Áo thun nam đen.jpg",
    mimeType: "image/jpeg",
    size: "1987654",
    imageMediaMetadata: { width: 1600, height: 1200 },
    thumbnailLink: `${BASE}/thumb/file-anh-2`,
    modifiedTime: "2026-09-19T04:01:00.000Z",
  },
];

const VIDEO_FILES = [
  {
    id: "file-video-1",
    name: "clip-gioi-thieu.mp4",
    mimeType: "video/mp4",
    size: "10485760",
    videoMediaMetadata: { durationMillis: 12500 },
    thumbnailLink: `${BASE}/thumb/file-video-1`,
    modifiedTime: "2026-09-19T04:02:00.000Z",
  },
];

/** Tệp không dùng được — phải bị lọc bỏ (PDF, Google Docs). */
const JUNK_FILES = [
  { id: "file-pdf-1", name: "bảng giá.pdf", mimeType: "application/pdf", size: "1000" },
  {
    id: "file-doc-1",
    name: "Chính sách",
    mimeType: "application/vnd.google-apps.document",
    size: "0",
  },
];

let variant = "IMAGES";
const log = [];

/**
 * Tệp trả về cho một truy vấn `q`.
 *
 * Mock này TÔN TRỌNG bộ lọc MIME trong `q` giống Drive thật — nhờ vậy e2e
 * kiểm được rằng app không tự lọc lại (nếu app lọc lại thì đây là lớp dư
 * thừa, còn nếu Drive trả thừa mà app không lọc thì PDF sẽ lọt vào bài đăng).
 */
function filesForVariant(q = "") {
  let files;
  switch (variant) {
    case "EMPTY":
      files = [];
      break;
    case "MIXED":
      files = [...IMAGE_FILES, ...VIDEO_FILES, ...JUNK_FILES];
      break;
    case "IMAGES":
    default:
      files = [...IMAGE_FILES, ...JUNK_FILES];
      break;
  }

  const wanted = [];
  if (q.includes("image/jpeg")) wanted.push("image/jpeg");
  if (q.includes("image/png")) wanted.push("image/png");
  if (q.includes("image/webp")) wanted.push("image/webp");
  if (q.includes("image/gif")) wanted.push("image/gif");
  if (q.includes("video/mp4")) wanted.push("video/mp4");
  if (q.includes("video/quicktime")) wanted.push("video/quicktime");
  if (q.includes("video/webm")) wanted.push("video/webm");

  if (wanted.length === 0) return files; // truy vấn không giới hạn MIME
  return files.filter((f) => wanted.includes(f.mimeType));
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function tokenResponse(accessToken, withRefresh = true) {
  return {
    access_token: accessToken,
    ...(withRefresh ? { refresh_token: "mock-refresh-token" } : {}),
    expires_in: 3600,
    scope: "openid email profile https://www.googleapis.com/auth/drive.file",
    token_type: "Bearer",
    // id_token giả: header.payload.signature — payload chứa email
    id_token: [
      Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
      Buffer.from(JSON.stringify({ email: USER_EMAIL, email_verified: true })).toString("base64url"),
      "sig",
    ].join("."),
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

createServer(async (req, res) => {
  const url = new URL(req.url, BASE);
  const path = url.pathname;

  // ---------- Endpoint điều khiển của test ----------
  if (path === "/__control") {
    if (req.method === "DELETE") {
      variant = "IMAGES";
      log.length = 0;
      console.log("→ reset mock Drive: variant=IMAGES");
      return json(res, 200, { ok: true, variant });
    }
    if (req.method === "POST") {
      const next = url.searchParams.get("variant");
      if (!["IMAGES", "MIXED", "EMPTY", "REVOKED", "QUOTA"].includes(next ?? "")) {
        return json(res, 400, { ok: false, error: "variant không hợp lệ" });
      }
      variant = next;
      console.log(`→ đổi mock Drive: variant=${variant}`);
      return json(res, 200, { ok: true, variant });
    }
    return json(res, 200, { variant, calls: log });
  }

  // ---------- Thumbnail (Google phục vụ ảnh nhỏ) ----------
  if (path.startsWith("/thumb/")) {
    res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=60" });
    return res.end(PIXEL);
  }

  // ---------- OAuth: màn hình đồng ý ----------
  if (path === "/o/oauth2/v2/auth") {
    const redirect = url.searchParams.get("redirect_uri") ?? "";
    const state = url.searchParams.get("state") ?? "";
    if (!redirect) return json(res, 400, { error: "missing redirect_uri" });
    log.push({ path, at: Date.now() });
    const target = new URL(redirect);
    target.searchParams.set("code", "mock-auth-code");
    target.searchParams.set("state", state);
    console.log(`auth: chuyển hướng callback (state=${state.slice(0, 12)}…)`);
    res.writeHead(302, { Location: target.toString() });
    return res.end();
  }

  // ---------- OAuth: đổi token ----------
  if (path === "/token" && req.method === "POST") {
    const body = new URLSearchParams(await readBody(req));
    const grant = body.get("grant_type");
    log.push({ path, grant, at: Date.now() });

    if (body.get("client_id") !== VALID_CLIENT || body.get("client_secret") !== VALID_SECRET) {
      console.log("token: 401 sai client id/secret");
      return json(res, 401, { error: "invalid_client" });
    }
    if (variant === "REVOKED") {
      console.log("token: 400 invalid_grant (giả lập token bị thu hồi)");
      return json(res, 400, { error: "invalid_grant" });
    }

    if (grant === "authorization_code") {
      console.log("token: cấp access + refresh token");
      return json(res, 200, tokenResponse(AUTHORIZED_ACCESS, true));
    }
    if (grant === "refresh_token") {
      console.log("token: làm mới access token (không trả refresh token mới)");
      return json(res, 200, tokenResponse(REFRESHED_ACCESS, false));
    }
    return json(res, 400, { error: "unsupported_grant_type" });
  }

  // ---------- Userinfo ----------
  if (path === "/oauth2/v3/userinfo") {
    return json(res, 200, { email: USER_EMAIL, email_verified: true });
  }

  // ---------- Drive API ----------
  if (path.startsWith("/drive/v3/")) {
    const auth = req.headers.authorization ?? "";
    log.push({ path, at: Date.now() });

    if (variant === "REVOKED") {
      return json(res, 401, { error: { code: 401, message: "Invalid Credentials" } });
    }
    if (!auth.startsWith("Bearer ") || !auth.includes("mock-drive-access-token")) {
      console.log(`drive: 401 token không hợp lệ (${auth || "thiếu header"})`);
      return json(res, 401, { error: { code: 401, message: "Invalid Credentials" } });
    }

    // GET /drive/v3/files/{id}?alt=media  → nội dung tệp
    const mediaMatch = path.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (mediaMatch && url.searchParams.get("alt") === "media") {
      if (variant === "QUOTA") {
        // Giống Google thật: reason nằm trong errors[].reason, message chỉ là
        // văn bản cho người đọc — app phải bắt được CẢ HAI.
        return json(res, 403, {
          error: {
            code: 403,
            message: "The user's Drive storage quota has been exceeded.",
            errors: [{ domain: "usageLimits", reason: "storageQuotaExceeded" }],
          },
        });
      }
      console.log(`drive: tải nội dung ${mediaMatch[1]}`);
      res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": String(PIXEL.length) });
      return res.end(PIXEL);
    }

    // GET /drive/v3/files/{id}  → metadata (cũng là bước kích hoạt quyền sau Picker)
    if (mediaMatch) {
      const id = decodeURIComponent(mediaMatch[1]);
      const all = [...IMAGE_FILES, ...VIDEO_FILES, ...JUNK_FILES];
      const found = all.find((f) => f.id === id);
      if (!found) {
        if (id === FOLDER_ID) {
          return json(res, 200, {
            id: FOLDER_ID,
            name: FOLDER_NAME,
            mimeType: "application/vnd.google-apps.folder",
          });
        }
        return json(res, 404, { error: { code: 404, message: "File not found" } });
      }
      return json(res, 200, found);
    }

    // GET /drive/v3/files?q='<folder>' in parents ...  → danh sách trong thư mục
    if (path === "/drive/v3/files") {
      const q = url.searchParams.get("q") ?? "";
      if (!q.includes(FOLDER_ID)) {
        console.log("drive: 403 thư mục không được cấp quyền");
        return json(res, 403, {
          error: { code: 403, message: "The user has not granted the app access" },
        });
      }
      const files = filesForVariant(q);
      console.log(`drive: liệt kê thư mục → ${files.length} tệp (variant=${variant})`);
      return json(res, 200, { files });
    }
  }

  return json(res, 404, { error: `Unknown endpoint ${path}` });
})
  .on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `✗ Cổng ${PORT} đang bị chiếm — có thể một mock server cũ vẫn đang chạy.\n` +
          "  Hãy tắt tiến trình cũ, hoặc chạy lại với cổng khác: PORT=<cổng-mới> node <script>"
      );
      process.exit(1);
    }
    throw err;
  })
  .listen(PORT, () =>
    console.log(
      `Mock Google Drive: ${BASE} (client: ${VALID_CLIENT}, thư mục: ${FOLDER_ID}, dùng GOOGLE_DRIVE_API_URL)`
    )
  );
