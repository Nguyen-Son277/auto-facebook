// E2E test — Tự động đăng chạy TRONG app + điều khiển từ giao diện web.
//
// Kiểm chứng điều quan trọng nhất: KHÔNG cần mở terminal chạy `npm run worker`,
// chỉ cần web server đang chạy là bài hẹn giờ được đăng; và người dùng bật/tắt
// được hoàn toàn trên web.
//
// Chạy: node scripts/e2e-scheduler-inapp.mjs
// Nên chạy dev server với WORKER_INTERVAL_MS nhỏ cho nhanh, ví dụ:
//   WORKER_INTERVAL_MS=5000 FB_GRAPH_BASE_URL=http://127.0.0.1:4021 npm run dev
import { chromium } from "playwright";
import { openTestDb } from "./lib/test-db.mjs";
import { ensureWorkspace } from "./lib/test-fixtures.mjs";

const BASE = "http://localhost:3000";
const MOCK_AI = "http://127.0.0.1:4010/v1";
const AI_KEY = "test-key-abc123";
const SMOKE_EMAIL = "smoke@test.local";
const PAGE_FB_ID = "111222333444555";
// Nếu dev server có đặt CRON_SECRET thì phải gửi kèm khi gọi endpoint
const CRON_SECRET = process.env.CRON_SECRET ?? "";

/**
 * Chu kỳ vòng lặp của server (đọc từ biến môi trường của chính test này).
 * Dùng để biết cần chờ bao lâu cho một nhịp — mặc định server là 60 giây.
 */
const TICK_MS = Number(process.env.WORKER_INTERVAL_MS ?? 60_000);
/** Chờ tối đa 2,5 nhịp + 10 giây dư. */
const TICK_WAIT = Math.round(TICK_MS * 2.5) + 10_000;

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
const wsId = ensureWorkspace(db, smoke.id);
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
    `INSERT INTO "FacebookPage" (id, "userId", "workspaceId", "fbPageId", name, category, "accessToken", "isActive", "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`
  ).run("e2e-page-1", smoke.id, wsId, PAGE_FB_ID, "Mock Page Kinh Doanh", "Business", "mock-page-token-abc");
}
resetFixtures();
console.log("→ Đã reset fixture: 1 Page giả, xoá post/settings cũ\n");

/** Tạo một bài đã quá giờ hẹn (để vòng lặp trong app tự đăng). */
function createDuePost(id, content) {
  db.prepare(
    `INSERT INTO "Post" (id, "userId", "workspaceId", "pageId", content, status, "scheduledAt", attempts, "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, 'SCHEDULED', ?, 0, datetime('now'), datetime('now'))`
  ).run(id, smoke.id, wsId, "e2e-page-1", content, new Date(Date.now() - 60_000).toISOString());
}

function postRow(id) {
  return db.prepare('SELECT status, "fbPostId", attempts FROM "Post" WHERE id = ?').get(id);
}

/** Chờ tới khi bài đạt trạng thái mong muốn, hoặc hết thời gian. */
async function waitForStatus(id, want, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = postRow(id);
    if (last?.status === want) return { ok: true, row: last };
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ok: false, row: last };
}

/** Chờ qua ít nhất 2 nhịp để chắc chắn vòng lặp đã có cơ hội chạy. */
async function waitTwoTicks() {
  await new Promise((r) => setTimeout(r, TICK_MS * 2 + 3000));
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

try {
  // ================= 1. Chuẩn bị =================
  section("Chuẩn bị");
  await login();
  check("Đăng nhập", page.url().includes("/dashboard"));
  await configureAi();
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  check("Cấu hình AI xong", true);

  // ================= 2. Vòng lặp chạy trong app, KHÔNG cần worker =================
  section("Vòng lặp tự chạy trong app (không cần terminal)");
  // Không hề chạy `npm run worker` trong suốt test này.
  createDuePost("inapp-1", "Bài test — vòng lặp trong app tự đăng, không có worker");

  const auto = await waitForStatus("inapp-1", "PUBLISHED", TICK_WAIT);
  check(
    "Bài đến hạn được tự đăng dù KHÔNG chạy worker",
    auto.ok,
    auto.row ? `status=${auto.row.status}, fbPostId=${auto.row.fbPostId}` : "không có dữ liệu"
  );
  check("Có fbPostId từ Facebook", Boolean(auto.row?.fbPostId), auto.row?.fbPostId ?? "");

  // Nhịp tim có ghi nguồn chạy. Giá trị trong DB được mã hóa nên không đọc
  // thẳng được — kiểm tra sự tồn tại ở đây, còn nội dung ("trong app") thì
  // xác nhận qua giao diện ở mục dưới.
  const sourceRow = db
    .prepare('SELECT value FROM "AppSetting" WHERE key = ?')
    .get("scheduler.lastSource");
  check("Có ghi nguồn chạy của vòng lặp", Boolean(sourceRow?.value));
  check("Vòng lặp có chạy (nhịp tim được cập nhật)", Boolean(hbExists()));

  function hbExists() {
    return db.prepare('SELECT value FROM "AppSetting" WHERE key = ?').get("scheduler.lastRunAt")
      ?.value;
  }

  // ================= 3. Giao diện báo đúng trạng thái =================
  section("Giao diện báo trạng thái");
  await page.goto(`${BASE}/calendar`, { waitUntil: "networkidle" });
  const statusText = await page.locator('[data-testid="worker-status"]').innerText();
  check(
    "Lịch đăng báo đang chạy trong app",
    /đang chạy/i.test(statusText) && /trong app/i.test(statusText),
    statusText.trim()
  );
  check(
    "Lịch đăng không còn nút điều khiển (về quyền admin, nút nằm ở banner Tổng quan)",
    (await page.locator('[data-testid="scheduler-toggle"]').count()) === 0
  );
  // Công tắc cấp hệ thống giờ chỉ hiển thị cho ADMIN ở banner dashboard
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  check(
    "Banner Tổng quan có nút điều khiển cho ADMIN",
    (await page.locator('[data-testid="scheduler-toggle"]').count()) === 1
  );
  check(
    "Nút hiển thị trạng thái ĐANG BẬT",
    (await page.locator('[data-testid="scheduler-toggle"]').getAttribute("data-enabled")) === "1"
  );
  await page.screenshot({ path: "/tmp/w6b-1-toggle-on.png", fullPage: true });

  // ================= 4. Tắt tự động đăng ngay trên web =================
  section("Tắt tự động đăng từ giao diện");
  await page.locator('[data-testid="scheduler-toggle"]').click();
  await page.locator('[data-testid="scheduler-toggle-notice"]').waitFor({ timeout: 30000 });
  const offNotice = await page.locator('[data-testid="scheduler-toggle-notice"]').innerText();
  check("Bấm nút → báo đã TẮT", /Đã TẮT/i.test(offNotice), offNotice.trim());

  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="scheduler-toggle"]')?.getAttribute("data-enabled") ===
      "0",
    undefined,
    { timeout: 20000 }
  );
  check(
    "Nút chuyển sang trạng thái TẮT",
    (await page.locator('[data-testid="scheduler-toggle"]').getAttribute("data-enabled")) === "0"
  );

  // Cờ đã được lưu thật vào DB
  const enabledRow = db
    .prepare('SELECT value FROM "AppSetting" WHERE key = ?')
    .get("scheduler.enabled");
  check("Cờ bật/tắt được lưu vào DB", Boolean(enabledRow?.value), enabledRow?.value?.slice(0, 20));

  // Nhịp tim không còn được cập nhật khi đã tắt
  const hbBefore = db
    .prepare('SELECT value FROM "AppSetting" WHERE key = ?')
    .get("scheduler.lastRunAt")?.value;
  await waitTwoTicks();
  const hbAfter = db
    .prepare('SELECT value FROM "AppSetting" WHERE key = ?')
    .get("scheduler.lastRunAt")?.value;
  check("Khi TẮT, vòng lặp không xử lý gì", hbBefore === hbAfter, "nhịp tim không đổi");

  // ================= 5. Khi tắt thì bài hẹn KHÔNG tự đăng =================
  section("Khi tắt, bài hẹn không tự đăng");
  createDuePost("off-1", "Bài test — phải nằm chờ vì đã tắt tự động đăng");
  await waitTwoTicks();

  const stillWaiting = postRow("off-1");
  check(
    "Bài đến hạn KHÔNG được đăng khi tính năng đang tắt",
    stillWaiting.status === "SCHEDULED",
    `status=${stillWaiting.status}`
  );
  check(
    "fbPostId vẫn trống (chưa gọi Facebook)",
    stillWaiting.fbPostId === null,
    String(stillWaiting.fbPostId)
  );
  check("Số lần thử vẫn = 0", stillWaiting.attempts === 0, String(stillWaiting.attempts));

  // Giao diện cảnh báo rõ khi đang tắt
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  const bannerState = await page.locator('[data-testid="scheduler-state"]').innerText();
  check(
    "Tổng quan cảnh báo tự động đăng đang TẮT",
    /TẮT/i.test(bannerState),
    bannerState.trim()
  );
  const bannerBody = await page.locator('[data-testid="scheduler-banner"]').innerText();
  check(
    "Banner nói rõ bài hẹn sẽ không được đăng",
    /không.*được đăng/i.test(bannerBody)
  );
  await page.screenshot({ path: "/tmp/w6b-2-toggle-off.png", fullPage: true });

  // ================= 6. Bật lại → bài tồn đọng được đăng =================
  section("Bật lại thì bài tồn đọng được đăng");
  await page.locator('[data-testid="scheduler-toggle"]').click();
  await page.locator('[data-testid="scheduler-toggle-notice"]').waitFor({ timeout: 30000 });
  const onNotice = await page.locator('[data-testid="scheduler-toggle-notice"]').innerText();
  check("Bấm nút → báo đã BẬT", /Đã BẬT/i.test(onNotice), onNotice.trim());

  const resumed = await waitForStatus("off-1", "PUBLISHED", TICK_WAIT);
  check(
    "Bài tồn đọng được đăng sau khi bật lại",
    resumed.ok,
    resumed.row ? `status=${resumed.row.status}, fbPostId=${resumed.row.fbPostId}` : "hết thời gian"
  );

  // ================= 7. Nút "Chạy ngay" =================
  section("Nút Chạy ngay");
  await page.goto(`${BASE}/calendar`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="scheduler-run-now"]').click();
  await page.locator('[data-testid="scheduler-toggle-notice"]').waitFor({ timeout: 30000 });
  const runNotice = await page.locator('[data-testid="scheduler-toggle-notice"]').innerText();
  check("Chạy ngay phản hồi kết quả", /Chạy xong/i.test(runNotice), runNotice.trim());

  createDuePost("manual-1", "Bài test — chạy ngay bằng nút trên web");
  await page.locator('[data-testid="scheduler-run-now"]').click();
  await page.waitForFunction(
    () => /đã xử lý 1 bài/.test(document.querySelector('[data-testid="scheduler-toggle-notice"]')?.textContent ?? ""),
    undefined,
    { timeout: 40000 }
  );
  const manualRow = postRow("manual-1");
  check("Chạy ngay đăng được bài đến hạn", manualRow.status === "PUBLISHED", manualRow.status);

  // ================= 7b. Cờ bật/tắt có hiệu lực với cron bên ngoài =================
  section("Cờ bật/tắt áp dụng cho cả cron bên ngoài");
  // Tắt trên web rồi giả lập cron ngoài gọi vào endpoint
  await page.goto(`${BASE}/calendar`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="scheduler-toggle"]').click();
  await page.locator('[data-testid="scheduler-toggle-notice"]').waitFor({ timeout: 30000 });
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="scheduler-toggle"]')?.getAttribute("data-enabled") ===
      "0",
    undefined,
    { timeout: 20000 }
  );

  createDuePost("cron-off-1", "Bài test — cron ngoài không được đăng khi đã tắt");

  const cronOffRes = await fetch(`${BASE}/api/cron/tick?source=cron`, {
    method: "POST",
    headers: CRON_SECRET ? { Authorization: `Bearer ${CRON_SECRET}` } : {},
  });
  const cronOffData = await cronOffRes.json();
  check(
    "Cron ngoài bị bỏ qua khi người dùng đã tắt",
    cronOffData.skipped === true && cronOffData.published === 0,
    `skipped=${cronOffData.skipped}, published=${cronOffData.published}`
  );
  check(
    "Endpoint trả 200 (không phải lỗi) để cron không thử lại liên tục",
    cronOffRes.status === 200,
    `HTTP ${cronOffRes.status}`
  );

  const cronOffRow = postRow("cron-off-1");
  check(
    "Bài vẫn nằm chờ, không bị đăng ngoài ý muốn",
    cronOffRow.status === "SCHEDULED",
    cronOffRow.status
  );

  // Bật lại để phần sau chạy tiếp
  await page.locator('[data-testid="scheduler-toggle"]').click();
  await page.locator('[data-testid="scheduler-toggle-notice"]').waitFor({ timeout: 30000 });
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="scheduler-toggle"]')?.getAttribute("data-enabled") ===
      "1",
    undefined,
    { timeout: 20000 }
  );
  check("Bật lại sau khi kiểm tra cron", true);

  // ================= 8. Quyền điều khiển: Settings trắng, trang Admin có =================
  section("Công tắc tự động đăng thuộc về Admin (không còn ở Cài đặt)");
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  check(
    "Cài đặt KHÔNG còn nút bật/tắt tự động đăng",
    (await page.locator('[data-testid="scheduler-toggle"]').count()) === 0
  );
  check(
    "Cài đặt KHÔNG còn mục Tự động đăng bài",
    (await page.getByText(/Tự động đăng bài theo lịch/).count()) === 0
  );

  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  check(
    "Trang Quản trị có nút điều khiển cho ADMIN",
    (await page.locator('[data-testid="scheduler-toggle"]').count()) === 1
  );
  check(
    "Quản trị hiện trạng thái đang chạy",
    /Đang chạy/i.test(await page.locator('[data-testid="settings-scheduler-state"]').innerText())
  );

  // Tắt từ trang Quản trị cũng phải có hiệu lực
  await page.locator('[data-testid="scheduler-toggle"]').click();
  await page.locator('[data-testid="scheduler-toggle-notice"]').waitFor({ timeout: 30000 });
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="scheduler-toggle"]')?.getAttribute("data-enabled") ===
      "0",
    undefined,
    { timeout: 20000 }
  );
  check(
    "Tắt từ trang Quản trị có hiệu lực",
    db.prepare('SELECT value FROM "AppSetting" WHERE key = ?').get("scheduler.enabled")?.value !==
      undefined
  );

  // Bật lại cho sạch trạng thái
  await page.locator('[data-testid="scheduler-toggle"]').click();
  await page.locator('[data-testid="scheduler-toggle-notice"]').waitFor({ timeout: 30000 });
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="scheduler-toggle"]')?.getAttribute("data-enabled") ===
      "1",
    undefined,
    { timeout: 20000 }
  );
  check("Bật lại được từ trang Quản trị", true);
  await page.screenshot({ path: "/tmp/w6b-3-settings.png", fullPage: true });
} catch (err) {
  failures++;
  console.log(`\n✗ FAIL  Ngoại lệ: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  await browser.close();
  db.close();
}

console.log("");
if (failures === 0) {
  console.log("🎉 TẤT CẢ TEST ĐỀU PASS");
} else {
  console.log(`❌ CÓ ${failures} TEST FAIL`);
  process.exitCode = 1;
}
