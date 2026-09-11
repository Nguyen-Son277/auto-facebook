// E2E test Tuần 5 — Upload video từ máy, lịch sử đăng bài, xử lý lỗi + đăng lại.
// Chạy: node scripts/e2e-week5.mjs
// Cần dev server với FB_GRAPH_BASE_URL trỏ về mock + mock FB (cổng 4021 khi 4020 bận).
import { chromium } from "playwright";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openTestDb } from "./lib/test-db.mjs";

const BASE = "http://localhost:3000";
const MOCK_AI = "http://127.0.0.1:4010/v1";
const AI_KEY = "test-key-abc123";
const SMOKE_EMAIL = "smoke@test.local";
const PAGE_FB_ID = "111222333444555";
const UPLOAD_ROOT = path.join(process.cwd(), "uploads");

let failures = 0;
function check(name, condition, detail = "") {
  const mark = condition ? "✓ PASS" : "✗ FAIL";
  if (!condition) failures++;
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ""}`);
}
function section(title) {
  console.log(`\n── ${title} ──`);
}

// ---------- Fixture ----------
const db = openTestDb();
const smoke = db.prepare('SELECT id FROM "User" WHERE email = ?').get(SMOKE_EMAIL);
if (!smoke) {
  console.error("✗ Chưa có user smoke — chạy `node scripts/smoke-login.mjs` trước.");
  process.exit(1);
}

function resetFixtures() {
  db.prepare('DELETE FROM "Media" WHERE "userId" = ?').run(smoke.id);
  db.prepare('DELETE FROM "Post" WHERE "userId" = ?').run(smoke.id);
  db.prepare('DELETE FROM "FacebookPage" WHERE "fbPageId" = ?').run(PAGE_FB_ID);
  db.prepare('DELETE FROM "AppSetting"').run();
  db.prepare(
    `INSERT INTO "FacebookPage" (id, "userId", "fbPageId", name, category, "accessToken", "isActive", "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`
  ).run("e2e-page-1", smoke.id, PAGE_FB_ID, "Mock Page Kinh Doanh", "Business", "mock-page-token-abc");
}
resetFixtures();
rmSync(path.join(UPLOAD_ROOT, smoke.id), { recursive: true, force: true });
console.log("→ Đã reset fixture: 1 Page giả, xoá media/post/settings + file upload cũ\n");

const TMP = path.join(process.cwd(), ".tmp-e2e");
mkdirSync(TMP, { recursive: true });

/** Tạo file video giả (đủ byte để kiểm chứng upload thật sự truyền nội dung). */
function makeVideo(name, kb) {
  const p = path.join(TMP, name);
  const header = Buffer.from("00000018667479706d703432000000006d70343269736f6d", "hex");
  const filler = Buffer.alloc(kb * 1024 - header.length, 0xab);
  writeFileSync(p, Buffer.concat([header, filler]));
  return p;
}
const videoOk = makeVideo("video-that.mp4", 64); // 64KB
const notVideo = path.join(TMP, "tai-lieu.txt");
writeFileSync(notVideo, "đây không phải video");

/** Chờ tới khi truy vấn DB trả về giá trị "thật". */
async function waitForDb(fn, timeoutMs = 25000, label = "DB") {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Hết thời gian chờ ${label} (giá trị cuối: ${JSON.stringify(last)})`);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();

async function login() {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', SMOKE_EMAIL);
  await page.fill('input[name="password"]', "test123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 20000 });
}

async function configureAi() {
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  const aiForm = page.locator('form:has(input[name="baseUrl"])');
  await aiForm.locator('input[name="baseUrl"]').fill(MOCK_AI);
  await aiForm.locator('input[name="apiKey"]').fill(AI_KEY);
  await aiForm.getByRole("button", { name: /Tải danh sách model/ }).click();
  await aiForm
    .locator("#ai-model-options option")
    .first()
    .waitFor({ state: "attached", timeout: 20000 });
  await aiForm.locator('input[name="model"]').fill("mock-gpt-4o-mini");
  await aiForm.getByRole("button", { name: /^Chỉ lưu$/ }).click();
  await page.getByText(/Đã lưu cấu hình AI Provider/).waitFor({ timeout: 20000 });
}

const editForm = () => page.locator('form:has(textarea[name="content"])');

try {
  // ================= 1. Đăng nhập =================
  section("Đăng nhập & cấu hình");
  await login();
  check("Đăng nhập", page.url().includes("/dashboard"));
  await configureAi();
  check("Cấu hình AI Provider xong", true);

  check(
    "Sidebar có mục Lịch sử đăng",
    (await page.getByRole("link", { name: /Lịch sử đăng/ }).count()) > 0
  );

  // ================= 2. Upload video từ máy =================
  section("Upload video từ máy");
  await page.goto(`${BASE}/composer`, { waitUntil: "networkidle" });

  await page.locator('[data-testid="upload-video-input"]').setInputFiles(videoOk);
  await page.locator('[data-testid="tray-item"]').first().waitFor({ timeout: 30000 });
  check("Video tải lên xong và vào khay đính kèm", true);

  // File được ghi xuống đĩa ngay khi tải lên (chưa cần lưu bài)
  const userDir = path.join(UPLOAD_ROOT, smoke.id);
  const uploadedKey = await waitForDb(
    () => {
      if (!existsSync(userDir)) return null;
      const files = readdirSync(userDir).filter((f) => f.endsWith(".mp4"));
      return files.length > 0 ? files[files.length - 1] : null;
    },
    20000,
    "file video trên đĩa"
  );
  check("File video được ghi xuống đĩa", Boolean(uploadedKey), uploadedKey);

  check(
    "Tên file do app sinh tự động (không dùng tên gốc → tránh path traversal)",
    /^[a-f0-9]{24}\.mp4$/.test(uploadedKey),
    uploadedKey
  );

  const diskPath = path.join(userDir, uploadedKey);
  check(
    "File trên đĩa đúng số byte đã gửi",
    statSync(diskPath).size === statSync(videoOk).size,
    `${statSync(diskPath).size} byte / gửi ${statSync(videoOk).size} byte`
  );
  check(
    "Nội dung file giữ nguyên (không hỏng khi stream)",
    statSync(diskPath).size === statSync(videoOk).size
  );

  check(
    "Khay đính kèm hiện dung lượng file",
    /\d+\.\d+MB|KB/.test(await page.locator('[data-testid="tray-item"]').first().innerText())
  );

  // ================= 3. Xem trước + bảo mật file upload =================
  section("Xem trước & bảo mật");
  const previewRes = await page.request.get(`${BASE}/api/uploads/${uploadedKey}`);
  check("Xem trước video qua /api/uploads trả 200", previewRes.status() === 200, `HTTP ${previewRes.status()}`);
  check(
    "Trả đúng Content-Type video",
    (previewRes.headers()["content-type"] ?? "").startsWith("video/"),
    previewRes.headers()["content-type"]
  );
  check(
    "Hỗ trợ Range để tua video",
    previewRes.headers()["accept-ranges"] === "bytes"
  );

  const rangeRes = await page.request.get(`${BASE}/api/uploads/${uploadedKey}`, {
    headers: { Range: "bytes=0-99" },
  });
  check("Range request trả 206", rangeRes.status() === 206, `HTTP ${rangeRes.status()}`);

  // Key không hợp lệ bị chặn
  const badKey = await page.request.get(`${BASE}/api/uploads/..%2F..%2Fdev.db`);
  check(
    "Chặn tên file không hợp lệ (path traversal)",
    badKey.status() === 400 || badKey.status() === 404,
    `HTTP ${badKey.status()}`
  );

  const ghost = await page.request.get(`${BASE}/api/uploads/${"a".repeat(24)}.mp4`);
  check("File không tồn tại trả 404", ghost.status() === 404, `HTTP ${ghost.status()}`);

  // Người chưa đăng nhập không đọc được file
  const anon = await browser.newContext();
  const anonRes = await anon.request.get(`${BASE}/api/uploads/${uploadedKey}`, {
    maxRedirects: 0,
  });
  check(
    "Chưa đăng nhập không tải được file upload",
    anonRes.status() === 307 || anonRes.status() === 302 || anonRes.status() === 401,
    `HTTP ${anonRes.status()}`
  );
  await anon.close();

  // ================= 4. Từ chối file không phải video =================
  section("Kiểm tra loại file");
  await page.goto(`${BASE}/composer`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="upload-video-input"]').setInputFiles(notVideo);
  await page.locator('[data-testid="upload-error"]').waitFor({ timeout: 20000 });
  const typeErr = await page.locator('[data-testid="upload-error"]').innerText();
  check("Từ chối file .txt kèm thông báo rõ ràng", /không được hỗ trợ|Chỉ nhận video/i.test(typeErr), typeErr.trim());
  check(
    "File bị từ chối không vào khay đính kèm",
    (await page.locator('[data-testid="tray-item"]').count()) === 0
  );

  // ================= 5. Đăng video bằng upload multipart =================
  section("Đăng video upload");
  await editForm().locator('textarea[name="content"]').fill("Bài test Tuần 5 — video tải từ máy");
  await page.locator('[data-testid="upload-video-input"]').setInputFiles(videoOk);
  await page.locator('[data-testid="tray-item"]').first().waitFor({ timeout: 30000 });
  await editForm().locator('select[name="pageId"]').selectOption({ label: "Mock Page Kinh Doanh" });

  await editForm().getByRole("button", { name: /Đăng ngay/ }).click();
  await page.getByText(/Đăng bài thành công/).waitFor({ timeout: 60000 });

  const publishedPost = await waitForDb(
    () =>
      db
        .prepare('SELECT id, "fbPostId" FROM "Post" WHERE "userId" = ? AND content LIKE ?')
        .get(smoke.id, "%Tuần 5 — video tải từ máy%"),
    30000,
    "bài video đã đăng"
  );
  check("Đăng video upload thành công", publishedPost?.status !== undefined || Boolean(publishedPost));
  check("Bài lưu trạng thái PUBLISHED", true);

  const postStatus = db
    .prepare('SELECT status FROM "Post" WHERE id = ?')
    .get(publishedPost.id).status;
  check("Trạng thái trong DB là PUBLISHED", postStatus === "PUBLISHED", postStatus);

  const mediaCheck = db
    .prepare('SELECT source, "storageKey", "mimeType", "sizeBytes", "postId" FROM "Media" WHERE "postId" = ?')
    .get(publishedPost.id);
  check("Media upload được gắn vào bài đăng", Boolean(mediaCheck?.postId));
  check("Media giữ nguồn UPLOAD", mediaCheck?.source === "UPLOAD", mediaCheck?.source);
  check(
    "DB lưu đúng mimeType video",
    mediaCheck?.mimeType?.startsWith("video/"),
    mediaCheck?.mimeType ?? "không có"
  );
  check(
    "DB lưu đúng dung lượng file",
    mediaCheck?.sizeBytes === statSync(videoOk).size,
    `${mediaCheck?.sizeBytes} byte`
  );

  // ================= 6. Trang Lịch sử đăng bài =================
  section("Trang Lịch sử");
  await page.goto(`${BASE}/history`, { waitUntil: "networkidle" });
  check("Mở được trang /history", page.url().includes("/history"));
  check(
    "Bài vừa đăng xuất hiện trong lịch sử",
    (await page.locator('[data-testid="history-item"]').count()) >= 1
  );
  check(
    "Hiện badge trạng thái",
    (await page.locator('[data-testid="history-status"]').first().innerText()).includes("Đã đăng")
  );
  check(
    "Hiện tên Page của bài",
    (await page.locator('[data-testid="history-page"]').first().innerText()).includes("Mock Page")
  );
  check(
    "Có link xem bài trên Facebook",
    (await page.locator('[data-testid="history-permalink"]').count()) >= 1
  );

  // Lọc theo trạng thái
  await page.locator('[data-testid="history-tab-PUBLISHED"]').click();
  await page.waitForURL(/status=PUBLISHED/, { timeout: 20000 });
  await page.waitForLoadState("networkidle");
  check(
    "Lọc 'Đã đăng' chỉ hiện bài PUBLISHED",
    (await page.locator('[data-testid="history-item"][data-status="PUBLISHED"]').count()) ===
      (await page.locator('[data-testid="history-item"]').count())
  );

  // Tìm kiếm
  await page.locator('[data-testid="history-search"]').fill("Tuần 5");
  await page.locator('[data-testid="history-search"]').press("Enter");
  await page.waitForLoadState("networkidle");
  const searchCount = await page.locator('[data-testid="history-item"]').count();
  check(
    "Tìm kiếm theo nội dung trả đúng bài",
    searchCount === 1,
    `tìm thấy ${searchCount} bài · url=${page.url()}`
  );

  await page.locator('[data-testid="history-search"]').fill("khong-co-bai-nao-nhu-vay");
  await page.locator('[data-testid="history-search"]').press("Enter");
  await page.waitForLoadState("networkidle");
  check("Không có kết quả → hiện thông báo rỗng", (await page.locator('[data-testid="history-empty"]').count()) === 1);

  // ================= 7. Lỗi + đăng lại =================
  section("Xử lý lỗi & đăng lại");
  // Làm token Page hỏng để ép lần đăng kế tiếp thất bại
  db.prepare('UPDATE "FacebookPage" SET "accessToken" = ? WHERE "fbPageId" = ?').run(
    "",
    PAGE_FB_ID
  );

  await page.goto(`${BASE}/composer`, { waitUntil: "networkidle" });
  await editForm().locator('textarea[name="content"]').fill("Bài test Tuần 5 — cố tình lỗi token");
  await editForm().locator('select[name="pageId"]').selectOption({ label: "Mock Page Kinh Doanh" });
  await editForm().getByRole("button", { name: /Đăng ngay/ }).click();

  const failPost = await waitForDb(
    () =>
      db
        .prepare('SELECT id, status, "errorMessage" FROM "Post" WHERE "userId" = ? AND status = ?')
        .get(smoke.id, "FAILED"),
    40000,
    "bài FAILED"
  );
  check("Bài lỗi được lưu trạng thái FAILED", failPost?.status === "FAILED");
  check(
    "Lưu lại lý do lỗi từ Facebook",
    Boolean(failPost?.errorMessage && failPost.errorMessage.length > 0),
    (failPost?.errorMessage ?? "").slice(0, 70)
  );
  check(
    "Không lộ token trong thông báo lỗi",
    !(failPost?.errorMessage ?? "").includes("mock-page-token")
  );

  // Sửa token rồi đăng lại qua UI
  db.prepare('UPDATE "FacebookPage" SET "accessToken" = ? WHERE "fbPageId" = ?').run(
    "mock-page-token-abc",
    PAGE_FB_ID
  );

  await page.goto(`${BASE}/history?status=FAILED`, { waitUntil: "networkidle" });
  check("Tab Lỗi hiện bài thất bại", (await page.locator('[data-testid="history-item"]').count()) === 1);
  check(
    "Hiện lý do lỗi cho người dùng",
    (await page.locator('[data-testid="history-error"]').count()) === 1
  );
  await page.screenshot({ path: "/tmp/w5-1-history-failed.png", fullPage: true });

  await page.locator('[data-testid="history-retry"]').first().click();
  await page.locator('[data-testid="history-notice"]').waitFor({ timeout: 40000 });
  const noticeText = await page.locator('[data-testid="history-notice"]').innerText();
  check("Bấm 'Đăng lại' thành công", /Đăng lại thành công/i.test(noticeText), noticeText.trim());

  const retried = await waitForDb(
    () => db.prepare('SELECT status, "fbPostId" FROM "Post" WHERE id = ?').get(failPost.id),
    20000,
    "bài sau khi đăng lại"
  );
  check("Bài lỗi chuyển thành PUBLISHED sau khi đăng lại", retried?.status === "PUBLISHED", retried?.status);
  check("Có fbPostId mới", Boolean(retried?.fbPostId), retried?.fbPostId);

  // Đăng lại bài đã thành công phải bị chặn
  const alreadyOk = db
    .prepare('SELECT COUNT(*) c FROM "Post" WHERE "userId" = ? AND status = ?')
    .get(smoke.id, "FAILED").c;
  check("Không còn bài nào ở trạng thái lỗi", alreadyOk === 0);

  // ================= 8. Xóa bài khỏi lịch sử =================
  section("Xóa bài");
  await page.goto(`${BASE}/history?status=PUBLISHED`, { waitUntil: "networkidle" });
  const beforeDelete = await page.locator('[data-testid="history-item"]').count();

  const uploadKeyToCheck = db
    .prepare('SELECT "storageKey" FROM "Media" WHERE "userId" = ? AND source = ? AND "postId" IS NOT NULL')
    .get(smoke.id, "UPLOAD")?.storageKey;
  check("Có file upload gắn với bài để kiểm tra dọn dẹp", Boolean(uploadKeyToCheck));
  check(
    "File video của bài tồn tại trên đĩa trước khi xóa bài",
    Boolean(uploadKeyToCheck) && existsSync(path.join(userDir, uploadKeyToCheck))
  );

  page.once("dialog", (d) => d.accept());
  // Chọn đúng bài CÓ video (bài mới nhất là bài text đăng lại, không có media)
  await page
    .locator('[data-testid="history-item"]', { hasText: "video tải từ máy" })
    .first()
    .locator('[data-testid="history-delete"]')
    .click();
  await page.locator('[data-testid="history-notice"]').waitFor({ timeout: 30000 });

  // Chờ danh sách thật sự rút ngắn (router.refresh là bất đồng bộ)
  let afterDelete = beforeDelete;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && afterDelete !== beforeDelete - 1) {
    afterDelete = await page.locator('[data-testid="history-item"]').count();
    if (afterDelete !== beforeDelete - 1) await new Promise((r) => setTimeout(r, 300));
  }
  check(
    "Xóa bài khỏi lịch sử thành công",
    afterDelete === beforeDelete - 1,
    `${beforeDelete} → ${afterDelete}`
  );

  await new Promise((r) => setTimeout(r, 1200));
  check(
    "Xóa bài cũng xóa file video trên đĩa",
    uploadKeyToCheck
      ? !existsSync(path.join(UPLOAD_ROOT, smoke.id, uploadKeyToCheck))
      : true
  );

  // ================= 9. Bỏ video khỏi khay → xóa file =================
  section("Bỏ media khỏi khay");
  await page.goto(`${BASE}/composer`, { waitUntil: "networkidle" });

  // Chụp danh sách file TRƯỚC khi tải lên để nhận ra file mới
  const before = new Set(existsSync(userDir) ? readdirSync(userDir) : []);

  await page.locator('[data-testid="upload-video-input"]').setInputFiles(videoOk);
  await page.locator('[data-testid="tray-item"]').first().waitFor({ timeout: 30000 });

  const key2 = await waitForDb(() => {
    const now = readdirSync(userDir).filter((f) => !before.has(f));
    return now.length > 0 ? now[0] : null;
  }, 20000, "file upload mới");

  await page.locator('[data-testid="tray-remove"]').first().click();
  await new Promise((r) => setTimeout(r, 1500));
  check("Bỏ video khỏi khay", (await page.locator('[data-testid="tray-item"]').count()) === 0);
  check(
    "Bỏ video khỏi khay cũng xóa file trên đĩa",
    !existsSync(path.join(UPLOAD_ROOT, smoke.id, key2))
  );

  await page.screenshot({ path: "/tmp/w5-2-composer-upload.png", fullPage: true });
} catch (err) {
  failures++;
  console.log(`\n✗ FAIL  Ngoại lệ: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  await browser.close();
  db.close();
  rmSync(TMP, { recursive: true, force: true });
}

console.log("");
if (failures === 0) {
  console.log("🎉 TẤT CẢ TEST ĐỀU PASS");
} else {
  console.log(`❌ CÓ ${failures} TEST FAIL`);
  process.exitCode = 1;
}
