// ============================================================
// E2E: luồng Google Drive (mock server) — KHÔNG cần trình duyệt.
//
// Chạy: npm run test:e2e:drive
//
// VÌ SAO CẦN, DÙ ĐÃ CÓ TEST UNIT
// test-drive.mjs chỉ kiểm hàm thuần (lọc MIME, đọc metadata). Còn chuỗi thật
// sự gồm: URL đồng ý quyền → đổi code lấy token → đọc thư mục → tải tệp. Sai
// ở bất kỳ mắt nào thì tính năng Drive hỏng im lặng. Script này chạy cả chuỗi
// đó trên mock, kiểm đúng cách app gọi Google (tham số, header, xử lý lỗi).
//
// KHÔNG cần database, KHÔNG cần app đang chạy.
// ============================================================

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = Number(process.env.MOCK_DRIVE_PORT ?? 4040);
const BASE = `http://127.0.0.1:${PORT}`;
const CLIENT_ID = "mock-client-id";
const CLIENT_SECRET = "mock-client-secret";
const FOLDER_ID = "mock-folder-1";
const REDIRECT = "http://localhost:3000/api/drive/callback";
const SCOPE = "https://www.googleapis.com/auth/drive.file";

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ✔ ${name}`);
  } else {
    failed++;
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n▸ ${title}`);
}

async function json(res) {
  return res.json().catch(() => null);
}

/** Đổi kịch bản dữ liệu của mock. */
async function setVariant(variant) {
  const res = await fetch(`${BASE}/__control?variant=${variant}`, { method: "POST" });
  if (!res.ok) throw new Error(`Không đổi được variant sang ${variant}`);
}

// ============================================================
// Khởi động mock server
// ============================================================

const child = spawn(process.execPath, ["scripts/mock-drive-server.mjs"], {
  cwd: new URL("..", import.meta.url).pathname,
  env: {
    ...process.env,
    PORT: String(PORT),
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GOOGLE_CLIENT_SECRET: CLIENT_SECRET,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

child.stdout.on("data", (b) => process.stdout.write(`   [mock] ${b}`));
child.stderr.on("data", (b) => process.stderr.write(`   [mock] ${b}`));

function stopMock() {
  if (!child.killed) child.kill("SIGTERM");
}

process.on("exit", stopMock);
process.on("SIGINT", () => {
  stopMock();
  process.exit(130);
});

// Chờ mock sẵn sàng
let up = false;
for (let i = 0; i < 40; i++) {
  try {
    const res = await fetch(`${BASE}/__control`);
    if (res.ok) {
      up = true;
      break;
    }
  } catch {
    // chưa lên
  }
  await sleep(250);
}
if (!up) {
  console.error(`✗ Mock Drive không khởi động được ở cổng ${PORT}.`);
  stopMock();
  process.exit(1);
}
console.log(`→ Mock Google Drive đã sẵn sàng ở ${BASE}`);

try {
  await fetch(`${BASE}/__control`, { method: "DELETE" });

  // ============================================================
  section("1. Bước 'Kết nối' — tham số gửi Google");
  // ============================================================

  const state = "state-test-abc123";
  const authUrl = new URL(`${BASE}/o/oauth2/v2/auth`);
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", `openid email profile ${SCOPE}`);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  // Google thật chuyển hướng về redirect_uri kèm code + state
  const authRes = await fetch(authUrl.toString(), { redirect: "manual" });
  check("màn hình đồng ý quyền trả về 302", authRes.status === 302, `HTTP ${authRes.status}`);

  const location = authRes.headers.get("location") ?? "";
  const back = new URL(location);
  check("chuyển hướng về đúng redirect_uri của app", back.origin + back.pathname === REDIRECT, location);
  check("có trả authorization code", back.searchParams.get("code") === "mock-auth-code");
  check("state được giữ nguyên (chống CSRF)", back.searchParams.get("state") === state);

  // ============================================================
  section("2. Bước callback — đổi code lấy token");
  // ============================================================

  const tokenRes = await fetch(`${BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: "mock-auth-code",
      redirect_uri: REDIRECT,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  const tokens = await json(tokenRes);

  check("đổi code thành công (HTTP 200)", tokenRes.ok, `HTTP ${tokenRes.status}`);
  check("có access_token", typeof tokens?.access_token === "string");
  check("CÓ refresh_token (bắt buộc cho access_type=offline)", typeof tokens?.refresh_token === "string");
  check("có id_token để đọc email", typeof tokens?.id_token === "string");

  // App đọc email từ payload id_token — kiểm đúng cách đó
  const payload = JSON.parse(
    Buffer.from(tokens.id_token.split(".")[1], "base64url").toString("utf8")
  );
  check("email đọc được từ id_token", payload.email === "smoke@test.local", String(payload.email));

  // ============================================================
  section("3. Làm mới access token (refresh_token grant)");
  // ============================================================

  const refreshRes = await fetch(`${BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: "mock-refresh-token",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  const refreshed = await json(refreshRes);
  check("làm mới token thành công", refreshRes.ok);
  check("access token mới KHÁC token cũ", refreshed?.access_token !== tokens.access_token);

  const badClient = await fetch(`${BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: "mock-refresh-token",
      client_id: CLIENT_ID,
      client_secret: "sai-secret",
    }),
  });
  check("sai client secret → 401", badClient.status === 401, `HTTP ${badClient.status}`);

  // ============================================================
  section("4. Kích hoạt quyền thư mục sau Picker (getFile)");
  // ============================================================

  const auth = { Authorization: "Bearer mock-drive-access-token" };

  const noAuth = await fetch(`${BASE}/drive/v3/files/${FOLDER_ID}`, { headers: {} });
  check("gọi Drive không có token → 401", noAuth.status === 401, `HTTP ${noAuth.status}`);

  const badToken = await fetch(`${BASE}/drive/v3/files/${FOLDER_ID}`, {
    headers: { Authorization: "Bearer token-sai" },
  });
  check("token sai → 401", badToken.status === 401, `HTTP ${badToken.status}`);

  const folderMetaRes = await fetch(`${BASE}/drive/v3/files/${FOLDER_ID}`, { headers: auth });
  const folderMeta = await json(folderMetaRes);
  check("đọc metadata thư mục thành công", folderMetaRes.ok);
  check(
    "mimeType đúng là thư mục Google",
    folderMeta?.mimeType === "application/vnd.google-apps.folder",
    String(folderMeta?.mimeType)
  );

  // ============================================================
  section("5. Liệt kê thư mục — lọc tệp dùng được");
  // ============================================================

  const listUrl = new URL(`${BASE}/drive/v3/files`);
  listUrl.searchParams.set(
    "q",
    `'${FOLDER_ID}' in parents and trashed = false and (mimeType = 'image/jpeg')`
  );
  listUrl.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,size)");
  listUrl.searchParams.set("orderBy", "name_natural");

  const listRes = await fetch(listUrl.toString(), { headers: auth });
  const list = await json(listRes);
  check("liệt kê thư mục thành công", listRes.ok);
  check("trả về đúng 2 ảnh (bỏ PDF và Google Docs)", (list?.files ?? []).length === 2, JSON.stringify(list?.files?.map((f) => f.id)));
  check(
    "size vẫn là chuỗi trong JSON của Drive (app phải tự ép Number)",
    typeof list?.files?.[0]?.size === "string",
    typeof list?.files?.[0]?.size
  );

  const wrongFolder = await fetch(
    `${BASE}/drive/v3/files?q='thu-muc-khac' in parents`,
    { headers: auth }
  );
  check(
    "thư mục chưa được cấp quyền → 403 (không rò dữ liệu)",
    wrongFolder.status === 403,
    `HTTP ${wrongFolder.status}`
  );

  // ============================================================
  section("6. Tải nội dung tệp (đăng bài dùng binary)");
  // ============================================================

  const dlRes = await fetch(`${BASE}/drive/v3/files/file-anh-1?alt=media`, { headers: auth });
  check("tải tệp thành công", dlRes.ok, `HTTP ${dlRes.status}`);
  check(
    "Content-Type ảnh đúng",
    (dlRes.headers.get("content-type") ?? "").startsWith("image/jpeg"),
    String(dlRes.headers.get("content-type"))
  );
  const bytes = new Uint8Array(await dlRes.arrayBuffer());
  check("nhận được byte thật (không rỗng)", bytes.length > 0, `${bytes.length} byte`);

  // ============================================================
  section("7. Kịch bản lỗi: Drive hết dung lượng");
  // ============================================================

  await setVariant("QUOTA");
  const quotaRes = await fetch(`${BASE}/drive/v3/files/file-anh-1?alt=media`, { headers: auth });
  const quotaBody = await json(quotaRes);
  check("hết dung lượng → 403", quotaRes.status === 403, `HTTP ${quotaRes.status}`);
  check(
    "thông điệp Google có storageQuotaExceeded (app nhận diện thành lỗi QUOTA)",
    JSON.stringify(quotaBody).includes("storageQuotaExceeded"),
    JSON.stringify(quotaBody)
  );

  // ============================================================
  section("8. Kịch bản lỗi: refresh token bị thu hồi");
  // ============================================================

  await setVariant("REVOKED");

  const revokedToken = await fetch(`${BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: "mock-refresh-token",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  const revokedBody = await json(revokedToken);
  check(
    "token bị thu hồi → invalid_grant (app chuyển connection sang NEEDS_REAUTH)",
    revokedBody?.error === "invalid_grant",
    JSON.stringify(revokedBody)
  );

  const revokedList = await fetch(listUrl.toString(), { headers: auth });
  check("Drive API cũng trả 401 khi token bị thu hồi", revokedList.status === 401);

  // ============================================================
  section("9. Kịch bản: thư mục trống (AutoPilot phải fallback)");
  // ============================================================

  await setVariant("EMPTY");
  const emptyList = await json(await fetch(listUrl.toString(), { headers: auth }));
  check("thư mục trống trả danh sách rỗng", (emptyList?.files ?? []).length === 0);

  await setVariant("MIXED");
  const videoListUrl = new URL(`${BASE}/drive/v3/files`);
  videoListUrl.searchParams.set(
    "q",
    `'${FOLDER_ID}' in parents and trashed = false and (mimeType = 'video/mp4' or mimeType = 'video/quicktime' or mimeType = 'video/webm')`
  );
  const mixedList = await json(await fetch(videoListUrl.toString(), { headers: auth }));
  check("kịch bản MIXED có 1 video", (mixedList?.files ?? []).length === 1, JSON.stringify(mixedList?.files?.map((f) => f.id)));
  check(
    "truy vấn video KHÔNG trả ảnh",
    (mixedList?.files ?? []).every((f) => f.mimeType.startsWith("video/")),
    JSON.stringify(mixedList?.files?.map((f) => f.mimeType))
  );

  // ============================================================
  section("10. Cùng một thư mục: có tệp vs bị chặn nội dung (ca '0 tệp')");
  // ============================================================

  // Kịch bản A: Drive trả tệp cho truy vấn `in parents` → app phải thấy ảnh
  await setVariant("IMAGES");
  const okList = await json(await fetch(listUrl.toString(), { headers: auth }));
  check("kịch bản bình thường: thư mục trả về 2 ảnh", (okList?.files ?? []).length === 2);

  // Kịch bản B (ca người dùng gặp): Drive trả RỖNG cho `in parents`, nhưng
  // truy vấn toàn Drive vẫn có tệp → chẩn đoán phải phân biệt được.
  await setVariant("NO_FOLDER_ACCESS");
  const blockedList = await json(await fetch(listUrl.toString(), { headers: auth }));
  check(
    "khi bị chặn nội dung thư mục: `in parents` trả RỖNG (không throw)",
    (blockedList?.files ?? []).length === 0,
    JSON.stringify(blockedList)
  );

  // Truy vấn toàn Drive (không `in parents`) — app dùng cho chẩn đoán
  const wideUrl = new URL(`${BASE}/drive/v3/files`);
  wideUrl.searchParams.set("q", "trashed = false and (mimeType = 'image/jpeg' or mimeType = 'image/png')");
  wideUrl.searchParams.set("fields", "files(id,name,mimeType,parents)");
  const wideRes = await json(await fetch(wideUrl.toString(), { headers: auth }));
  check(
    "truy vấn toàn Drive VẪN thấy tệp (đây là dấu hiệu phân biệt với thư mục trống)",
    (wideRes?.files ?? []).length === 2,
    JSON.stringify(wideRes?.files?.map((f) => f.id))
  );

  // Kịch bản C: thư mục thật sự trống → cả hai truy vấn đều 0
  await setVariant("EMPTY");
  const emptyBoth = await json(await fetch(listUrl.toString(), { headers: auth }));
  const emptyWide = await json(await fetch(wideUrl.toString(), { headers: auth }));
  check("thư mục trống thật: `in parents` = 0", (emptyBoth?.files ?? []).length === 0);
  check("thư mục trống thật: toàn Drive cũng = 0", (emptyWide?.files ?? []).length === 0);

  await setVariant("IMAGES");
  const restored = await json(await fetch(listUrl.toString(), { headers: auth }));
  check("đổi lại IMAGES thì thư mục có ảnh trở lại", (restored?.files ?? []).length === 2);

  await fetch(`${BASE}/__control`, { method: "DELETE" });
} finally {
  stopMock();
}

console.log(`\n${"=".repeat(52)}`);
console.log(`Kết quả: ${passed} đạt, ${failed} lỗi (tổng ${passed + failed})`);
console.log("=".repeat(52));
process.exit(failed === 0 ? 0 : 1);
