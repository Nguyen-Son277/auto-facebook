// E2E test Tuần 6 — Hẹn giờ đăng, worker tự đăng, retry, content calendar.
// Chạy: node scripts/e2e-week6.mjs
// Cần dev server với FB_GRAPH_BASE_URL trỏ về mock + mock FB.
import { chromium } from "playwright";
import { openTestDb } from "./lib/test-db.mjs";

const BASE = "http://localhost:3000";
const MOCK_AI = "http://127.0.0.1:4010/v1";
const AI_KEY = "test-key-abc123";
const SMOKE_EMAIL = "smoke@test.local";
const PAGE_FB_ID = "111222333444555";
// Nếu dev server có đặt CRON_SECRET thì test phải gửi kèm — giống worker thật
const CRON_SECRET = process.env.CRON_SECRET ?? "";

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
console.log("→ Đã reset fixture: 1 Page giả, xoá media/post/settings cũ\n");

/**
 * Chạy một vòng scheduler qua endpoint cron (giống hệt cách worker làm).
 * Dùng fetch trực tiếp để test độc lập với vòng lặp của worker.
 */
async function tick() {
  const headers = CRON_SECRET ? { Authorization: `Bearer ${CRON_SECRET}` } : {};
  const res = await fetch(`${BASE}/api/cron/tick`, { method: "POST", headers });
  if (!res.ok) {
    throw new Error(`Tick thất bại: HTTP ${res.status} — ${await res.text()}`);
  }
  return res.json();
}

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
const editForm = () => page.locator('form:has(textarea[name="content"])');

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

/** Nhập thời gian hẹn vào input datetime-local. */
async function setScheduleTime(date) {
  const p = (n) => String(n).padStart(2, "0");
  const value = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(
    date.getHours()
  )}:${p(date.getMinutes())}`;
  await page.locator('[data-testid="schedule-input"]').fill(value);
  return value;
}

try {
  // ================= 1. Đăng nhập =================
  section("Đăng nhập & cấu hình");
  await login();
  check("Đăng nhập", page.url().includes("/dashboard"));
  await configureAi();
  check("Cấu hình AI Provider xong", true);

  // ================= 2. Trang Lịch đăng thật =================
  section("Trang Lịch đăng");
  await page.goto(`${BASE}/calendar`, { waitUntil: "networkidle" });
  check(
    "Trang /calendar không còn placeholder",
    (await page.getByText(/Sắp ra mắt ở Tuần/).count()) === 0
  );
  check(
    "Hiện lưới lịch theo tháng",
    (await page.locator('[data-testid="calendar-day"]').count()) >= 28
  );
  check(
    "Hiện trạng thái worker",
    (await page.locator('[data-testid="worker-status"]').count()) === 1
  );
  await page.screenshot({ path: "/tmp/w6-1-calendar-empty.png", fullPage: true });

  // ================= 3. Hẹn giờ từ Composer =================
  section("Hẹn giờ đăng");
  await page.goto(`${BASE}/composer`, { waitUntil: "networkidle" });

  await editForm()
    .locator('textarea[name="content"]')
    .fill("Bài test Tuần 6 — hẹn giờ tự động đăng");
  await editForm().locator('select[name="pageId"]').selectOption({ label: "Mock Page Kinh Doanh" });

  // Hẹn 2 giờ tới (cùng ngày nếu còn kịp, không thì ngày mai)
  const target = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const inputValue = await setScheduleTime(target);
  check("Nhập được thời gian hẹn", Boolean(inputValue), inputValue);

  await page.locator('[data-testid="schedule-submit"]').click();
  await page.getByText(/Đã hẹn đăng lúc/).waitFor({ timeout: 30000 });
  check("Hẹn giờ thành công", true);

  const scheduled = await waitForDb(
    () =>
      db
        .prepare('SELECT id, status, "scheduledAt", attempts FROM "Post" WHERE "userId" = ? AND status = ?')
        .get(smoke.id, "SCHEDULED"),
    20000,
    "bài SCHEDULED"
  );
  check("DB lưu trạng thái SCHEDULED", scheduled?.status === "SCHEDULED");
  check("Có lưu thời gian hẹn", Boolean(scheduled?.scheduledAt));
  check("Chưa gọi Facebook khi mới hẹn (fbPostId còn trống)", true);

  const noFbId = db
    .prepare('SELECT "fbPostId" FROM "Post" WHERE id = ?')
    .get(scheduled.id).fbPostId;
  check("Bài hẹn chưa có fbPostId", noFbId === null, String(noFbId));

  // Hẹn vào quá khứ phải bị chặn
  await page.goto(`${BASE}/composer`, { waitUntil: "networkidle" });
  await editForm()
    .locator('textarea[name="content"]')
    .fill("Bài test Tuần 6 — hẹn vào quá khứ");
  await editForm().locator('select[name="pageId"]').selectOption({ label: "Mock Page Kinh Doanh" });
  const past = new Date(Date.now() - 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  await page
    .locator('[data-testid="schedule-input"]')
    .fill(
      `${past.getFullYear()}-${p(past.getMonth() + 1)}-${p(past.getDate())}T${p(
        past.getHours()
      )}:${p(past.getMinutes())}`
    );
  await page.locator('[data-testid="schedule-submit"]').click();
  await page.getByText(/phải ở tương lai/).waitFor({ timeout: 20000 });
  check("Chặn hẹn giờ vào quá khứ", true);

  const pastCount = db
    .prepare('SELECT COUNT(*) c FROM "Post" WHERE "userId" = ? AND content LIKE ?')
    .get(smoke.id, "%hẹn vào quá khứ%").c;
  check("Bài hẹn sai giờ không được lưu", pastCount === 0);

  // ================= 4. Bài chưa đến giờ KHÔNG được đăng =================
  section("Worker bỏ qua bài chưa đến giờ");
  const tick1 = await tick();
  check("Tick chạy được", tick1.ok === true);
  check(
    "Không đăng bài chưa đến giờ",
    tick1.published === 0,
    `đã đăng ${tick1.published}, đã giành ${tick1.claimed}`
  );

  const stillScheduled = db
    .prepare('SELECT status FROM "Post" WHERE id = ?')
    .get(scheduled.id).status;
  check("Bài vẫn ở trạng thái SCHEDULED", stillScheduled === "SCHEDULED", stillScheduled);

  // Ghi nhịp tim worker
  await new Promise((r) => setTimeout(r, 800));
  const heartbeat = db
    .prepare('SELECT value FROM "AppSetting" WHERE key = ?')
    .get("scheduler.lastRunAt");
  check("Worker ghi nhịp tim vào DB", Boolean(heartbeat?.value));

  // ================= 5. Worker tự đăng khi tới giờ =================
  section("Worker tự đăng khi tới giờ");
  // Đẩy thời gian hẹn về quá khứ để mô phỏng "đã tới giờ"
  db.prepare('UPDATE "Post" SET "scheduledAt" = ? WHERE id = ?').run(
    new Date(Date.now() - 60 * 1000).toISOString(),
    scheduled.id
  );

  const tick2 = await tick();
  check("Worker giành được bài đến hạn", tick2.claimed === 1, `claimed=${tick2.claimed}`);
  check("Worker đăng thành công", tick2.published === 1, `published=${tick2.published}`);

  const publishedRow = await waitForDb(
    () => db.prepare('SELECT status, "fbPostId", "publishedAt", attempts FROM "Post" WHERE id = ?').get(scheduled.id),
    15000,
    "bài đã đăng"
  );
  check("Bài chuyển thành PUBLISHED", publishedRow.status === "PUBLISHED", publishedRow.status);
  check("Có fbPostId từ Facebook", Boolean(publishedRow.fbPostId), publishedRow.fbPostId);
  check("Có publishedAt", Boolean(publishedRow.publishedAt));
  check("Đếm số lần thử = 1", publishedRow.attempts === 1, String(publishedRow.attempts));

  // Chạy tick lần nữa: bài đã đăng không được đăng lại
  const tick3 = await tick();
  check(
    "Tick sau không đăng lại bài đã đăng",
    tick3.claimed === 0 && tick3.published === 0,
    `claimed=${tick3.claimed}`
  );
  const sameFbId = db.prepare('SELECT "fbPostId" FROM "Post" WHERE id = ?').get(scheduled.id).fbPostId;
  check("fbPostId không đổi (không đăng trùng)", sameFbId === publishedRow.fbPostId);

  // ================= 6. Chống 2 worker đăng trùng =================
  section("Chống đăng trùng khi 2 worker chạy song song");
  db.prepare(
    `INSERT INTO "Post" (id, "userId", "pageId", content, status, "scheduledAt", attempts, "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, 'SCHEDULED', ?, 0, datetime('now'), datetime('now'))`
  ).run("race-post-1", smoke.id, "e2e-page-1", "Bài test Tuần 6 — chống đăng trùng", new Date(Date.now() - 60000).toISOString());

  // Gọi 3 tick ĐỒNG THỜI — chỉ một được phép giành bài
  const parallel = await Promise.all([tick(), tick(), tick()]);
  const totalClaimed = parallel.reduce((s, r) => s + r.claimed, 0);
  const totalPublished = parallel.reduce((s, r) => s + r.published, 0);
  check(
    "Chỉ MỘT worker giành được bài (updateMany có điều kiện)",
    totalClaimed === 1,
    `tổng claimed=${totalClaimed}`
  );
  check("Chỉ đăng đúng 1 lần", totalPublished === 1, `tổng published=${totalPublished}`);

  const raceRow = db.prepare('SELECT status, "fbPostId" FROM "Post" WHERE id = ?').get("race-post-1");
  check("Bài chống trùng đã PUBLISHED", raceRow.status === "PUBLISHED", raceRow.status);

  // ================= 7. Lỗi + retry tự động =================
  section("Retry tự động khi lỗi");
  db.prepare(
    `INSERT INTO "Post" (id, "userId", "pageId", content, status, "scheduledAt", attempts, "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, 'SCHEDULED', ?, 0, datetime('now'), datetime('now'))`
  ).run("retry-post-1", smoke.id, "e2e-page-1", "Bài test Tuần 6 — retry", new Date(Date.now() - 60000).toISOString());

  // Làm token hỏng để lần đăng đầu thất bại
  db.prepare('UPDATE "FacebookPage" SET "accessToken" = ? WHERE "fbPageId" = ?').run("", PAGE_FB_ID);

  const tickFail = await tick();
  check("Lần đăng đầu thất bại", tickFail.retrying + tickFail.failed === 1, `retrying=${tickFail.retrying} failed=${tickFail.failed}`);

  const afterFail = db
    .prepare('SELECT status, attempts, "nextAttemptAt", "errorMessage" FROM "Post" WHERE id = ?')
    .get("retry-post-1");
  check("Bài lỗi quay lại SCHEDULED để thử lại", afterFail.status === "SCHEDULED", afterFail.status);
  check("Đếm số lần thử = 1", afterFail.attempts === 1, String(afterFail.attempts));
  check("Có đặt thời điểm thử lại", Boolean(afterFail.nextAttemptAt));
  check(
    "Thông báo lỗi nói rõ sẽ thử lại",
    /thử lại/i.test(afterFail.errorMessage ?? ""),
    (afterFail.errorMessage ?? "").slice(0, 80)
  );

  // Chưa tới giờ thử lại → worker phải bỏ qua
  const tickTooEarly = await tick();
  check(
    "Chưa tới giờ thử lại thì không đăng",
    tickTooEarly.claimed === 0,
    `claimed=${tickTooEarly.claimed}`
  );

  // Sửa token + đẩy giờ thử lại về quá khứ → lần này thành công
  db.prepare('UPDATE "FacebookPage" SET "accessToken" = ? WHERE "fbPageId" = ?').run(
    "mock-page-token-abc",
    PAGE_FB_ID
  );
  db.prepare('UPDATE "Post" SET "nextAttemptAt" = ? WHERE id = ?').run(
    new Date(Date.now() - 1000).toISOString(),
    "retry-post-1"
  );

  const tickOk = await tick();
  check("Thử lại thành công sau khi sửa lỗi", tickOk.published === 1, `published=${tickOk.published}`);

  const retried = db.prepare('SELECT status, attempts FROM "Post" WHERE id = ?').get("retry-post-1");
  check("Bài chuyển thành PUBLISHED", retried.status === "PUBLISHED", retried.status);
  check("Số lần thử = 2", retried.attempts === 2, String(retried.attempts));

  // ================= 8. Hết lượt thử → FAILED vĩnh viễn =================
  section("Hết lượt thử thì dừng");
  db.prepare(
    `INSERT INTO "Post" (id, "userId", "pageId", content, status, "scheduledAt", attempts, "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, 'SCHEDULED', ?, 2, datetime('now'), datetime('now'))`
  ).run("giveup-post-1", smoke.id, "e2e-page-1", "Bài test Tuần 6 — hết lượt thử", new Date(Date.now() - 60000).toISOString());
  db.prepare('UPDATE "FacebookPage" SET "accessToken" = ? WHERE "fbPageId" = ?').run("", PAGE_FB_ID);

  const tickGiveUp = await tick();
  check("Lần thử cuối thất bại", tickGiveUp.failed === 1, `failed=${tickGiveUp.failed}`);

  const gaveUp = db
    .prepare('SELECT status, "nextAttemptAt", "errorMessage" FROM "Post" WHERE id = ?')
    .get("giveup-post-1");
  check("Chuyển thành FAILED (không thử nữa)", gaveUp.status === "FAILED", gaveUp.status);
  check("Xóa thời điểm thử lại", gaveUp.nextAttemptAt === null);
  check(
    "Thông báo nói đã thử đủ số lần",
    /không thử lại nữa/i.test(gaveUp.errorMessage ?? ""),
    (gaveUp.errorMessage ?? "").slice(0, 80)
  );

  db.prepare('UPDATE "FacebookPage" SET "accessToken" = ? WHERE "fbPageId" = ?').run(
    "mock-page-token-abc",
    PAGE_FB_ID
  );

  // ================= 8b. Gỡ bài kẹt do worker chết giữa chừng =================
  section("Gỡ bài kẹt (worker tắt đột ngột)");
  db.prepare(
    `INSERT INTO "Post" (id, "userId", "pageId", content, status, "scheduledAt", attempts, "lockedAt", "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, 'PUBLISHING', ?, 1, ?, datetime('now'), datetime('now'))`
  ).run(
    "stale-post-1",
    smoke.id,
    "e2e-page-1",
    "Bài test Tuần 6 — kẹt do worker chết",
    new Date(Date.now() - 3600000).toISOString(),
    new Date(Date.now() - 20 * 60 * 1000).toISOString()
  );

  const tickRecover = await tick();
  check("Tick gỡ được bài kẹt", tickRecover.recovered === 1, `recovered=${tickRecover.recovered}`);

  const staleRow = db
    .prepare('SELECT status, "lockedAt", "errorMessage" FROM "Post" WHERE id = ?')
    .get("stale-post-1");
  check("Bài kẹt chuyển thành FAILED", staleRow.status === "FAILED", staleRow.status);
  check("Mở khóa bài (lockedAt = null)", staleRow.lockedAt === null);
  check(
    "Cảnh báo người dùng kiểm tra tránh đăng trùng",
    /kiểm tra trên Facebook/i.test(staleRow.errorMessage ?? ""),
    (staleRow.errorMessage ?? "").slice(0, 70)
  );

  // Bài đang đăng bình thường (khóa mới) KHÔNG bị gỡ
  db.prepare(
    `INSERT INTO "Post" (id, "userId", "pageId", content, status, "scheduledAt", attempts, "lockedAt", "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, 'PUBLISHING', ?, 1, ?, datetime('now'), datetime('now'))`
  ).run(
    "fresh-lock-1",
    smoke.id,
    "e2e-page-1",
    "Bài test Tuần 6 — đang đăng bình thường",
    new Date(Date.now() - 3600000).toISOString(),
    new Date().toISOString()
  );
  const tickFresh = await tick();
  const freshRow = db.prepare('SELECT status FROM "Post" WHERE id = ?').get("fresh-lock-1");
  check(
    "KHÔNG gỡ bài đang được worker khác đăng",
    tickFresh.recovered === 0 && freshRow.status === "PUBLISHING",
    `recovered=${tickFresh.recovered}, status=${freshRow.status}`
  );
  db.prepare('DELETE FROM "Post" WHERE id = ?').run("fresh-lock-1");

  // ================= 8c. Page bị xóa → báo lỗi rõ, không kẹt im lặng =================
  section("Page bị xóa thì báo lỗi rõ ràng");
  db.prepare(
    `INSERT INTO "Post" (id, "userId", "pageId", content, status, "scheduledAt", attempts, "createdAt", "updatedAt")
     VALUES (?, ?, NULL, ?, 'SCHEDULED', ?, 0, datetime('now'), datetime('now'))`
  ).run(
    "orphan-post-1",
    smoke.id,
    "Bài test Tuần 6 — Page đã bị xóa",
    new Date(Date.now() - 60000).toISOString()
  );

  await tick();
  const orphanRow = db
    .prepare('SELECT status, "errorMessage" FROM "Post" WHERE id = ?')
    .get("orphan-post-1");
  check(
    "Bài mất Page KHÔNG kẹt im lặng ở SCHEDULED",
    orphanRow.status === "FAILED",
    orphanRow.status
  );
  check(
    "Thông báo nói rõ Page không còn tồn tại",
    /không còn tồn tại/i.test(orphanRow.errorMessage ?? ""),
    (orphanRow.errorMessage ?? "").slice(0, 70)
  );

  // ================= 9. Bảo mật endpoint cron =================
  section("Bảo mật endpoint cron");
  if (CRON_SECRET) {
    // Đã đặt CRON_SECRET → mọi request thiếu/sai secret đều bị từ chối
    const noSecret = await fetch(`${BASE}/api/cron/tick`, { method: "POST" });
    check(
      "Có CRON_SECRET: thiếu secret bị từ chối 401",
      noSecret.status === 401,
      `HTTP ${noSecret.status}`
    );

    const wrongSecret = await fetch(`${BASE}/api/cron/tick`, {
      method: "POST",
      headers: { Authorization: "Bearer secret-sai-hoan-toan" },
    });
    check(
      "Có CRON_SECRET: secret sai bị từ chối 401",
      wrongSecret.status === 401,
      `HTTP ${wrongSecret.status}`
    );

    const rightSecret = await fetch(`${BASE}/api/cron/tick`, {
      method: "POST",
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    check(
      "Có CRON_SECRET: secret đúng được phép 200",
      rightSecret.status === 200,
      `HTTP ${rightSecret.status}`
    );

    const wrongQuery = await fetch(`${BASE}/api/cron/tick?secret=doan-sai`, { method: "POST" });
    check(
      "Có CRON_SECRET: secret sai qua query cũng bị chặn",
      wrongQuery.status === 401,
      `HTTP ${wrongQuery.status}`
    );
  } else {
    // Chưa đặt CRON_SECRET → chỉ cho phép gọi từ máy cục bộ
    const loopback = await fetch(`${BASE}/api/cron/tick`, { method: "POST" });
    check(
      "Chưa đặt CRON_SECRET: loopback được phép 200",
      loopback.status === 200,
      `HTTP ${loopback.status}`
    );
  }

  // ================= 10. Content calendar =================
  section("Content calendar");
  await page.goto(`${BASE}/calendar`, { waitUntil: "networkidle" });

  const monthLabel = await page.locator('[data-testid="calendar-month"]').innerText();
  check("Hiện tên tháng", /Tháng \d+\/\d{4}/.test(monthLabel), monthLabel.trim());

  const dayWithPosts = page.locator('[data-testid="calendar-day"]:not([data-count="0"])');
  const dayCountWithPosts = await dayWithPosts.count();
  const totalShown = await dayWithPosts.evaluateAll((els) =>
    els.reduce((sum, el) => sum + Number(el.getAttribute("data-count") ?? 0), 0)
  );
  check(
    "Có ngày hiển thị bài đã hẹn/đã đăng",
    dayCountWithPosts > 0 && totalShown >= 4,
    `${dayCountWithPosts} ngày · ${totalShown} bài`
  );

  check(
    "Hiện số bài đang chờ đăng",
    (await page.getByText(/Chờ đăng:/).count()) > 0
  );

  // Mở chi tiết một ngày có bài
  const busyDay = dayWithPosts.first();
  await busyDay.click();
  await page.locator('[data-testid="calendar-detail"]').waitFor({ timeout: 15000 });
  check("Mở được chi tiết ngày", true);
  check(
    "Chi tiết ngày hiện bài",
    (await page.locator('[data-testid="calendar-post"]').count()) >= 1
  );
  await page.screenshot({ path: "/tmp/w6-2-calendar-with-posts.png", fullPage: true });

  // Điều hướng tháng
  const beforeMonth = monthLabel;
  await page.locator('[data-testid="calendar-next"]').click();
  await page.waitForURL(/month=/, { timeout: 20000 });
  await page.waitForLoadState("networkidle");
  const afterMonth = await page.locator('[data-testid="calendar-month"]').innerText();
  check("Chuyển sang tháng sau", afterMonth !== beforeMonth, `${beforeMonth.trim()} → ${afterMonth.trim()}`);

  await page.locator('[data-testid="calendar-prev"]').click();
  await page.waitForFunction(
    (expected) =>
      document.querySelector('[data-testid="calendar-month"]')?.textContent?.trim() === expected,
    beforeMonth.trim(),
    { timeout: 20000 }
  );
  check(
    "Quay lại tháng trước đó",
    (await page.locator('[data-testid="calendar-month"]').innerText()).trim() === beforeMonth.trim()
  );

  // ================= 11. Đổi lịch / hủy lịch / đăng ngay =================
  section("Đổi lịch, hủy lịch, đăng ngay");
  db.prepare(
    `INSERT INTO "Post" (id, "userId", "pageId", content, status, "scheduledAt", attempts, "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, 'SCHEDULED', ?, 0, datetime('now'), datetime('now'))`
  ).run(
    "ui-post-1",
    smoke.id,
    "e2e-page-1",
    "Bài test Tuần 6 — đổi lịch qua UI",
    new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString()
  );

  const uiDay = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const uiMonth = `${uiDay.getFullYear()}-${String(uiDay.getMonth() + 1).padStart(2, "0")}`;
  await page.goto(`${BASE}/calendar?month=${uiMonth}`, { waitUntil: "networkidle" });

  const pp = (n) => String(n).padStart(2, "0");
  const uiDayKey = `${uiDay.getFullYear()}-${pp(uiDay.getMonth() + 1)}-${pp(uiDay.getDate())}`;
  await page.locator(`[data-testid="calendar-day"][data-day="${uiDayKey}"]`).click();
  await page.locator('[data-testid="calendar-detail"]').waitFor({ timeout: 15000 });

  // --- Đổi lịch ---
  const targetPost = page.locator('[data-testid="calendar-post"]', { hasText: "đổi lịch qua UI" });
  await targetPost.locator('[data-testid="calendar-reschedule"]').click();
  await page.locator('[data-testid="reschedule-input"]').waitFor({ timeout: 10000 });

  const newTime = new Date(Date.now() + 26 * 60 * 60 * 1000);
  await page
    .locator('[data-testid="reschedule-input"]')
    .fill(
      `${newTime.getFullYear()}-${pp(newTime.getMonth() + 1)}-${pp(newTime.getDate())}T${pp(
        newTime.getHours()
      )}:${pp(newTime.getMinutes())}`
    );
  await page.locator('[data-testid="reschedule-save"]').click();
  await page.locator('[data-testid="calendar-notice"]').waitFor({ timeout: 25000 });
  const rsNotice = await page.locator('[data-testid="calendar-notice"]').innerText();
  check("Đổi lịch thành công", /Đã đổi lịch sang/.test(rsNotice), rsNotice.trim());

  const rescheduled = db
    .prepare('SELECT "scheduledAt" FROM "Post" WHERE id = ?')
    .get("ui-post-1");
  const driftMin = Math.abs(new Date(rescheduled.scheduledAt).getTime() - newTime.getTime()) / 60000;
  check("Lịch mới được lưu đúng", driftMin < 2, `lệch ${driftMin.toFixed(1)} phút`);

  // --- Hủy lịch ---
  await page.goto(`${BASE}/calendar?month=${uiMonth}`, { waitUntil: "networkidle" });
  const newDayKey = `${newTime.getFullYear()}-${pp(newTime.getMonth() + 1)}-${pp(newTime.getDate())}`;
  await page.locator(`[data-testid="calendar-day"][data-day="${newDayKey}"]`).click();
  await page.locator('[data-testid="calendar-detail"]').waitFor({ timeout: 15000 });
  const cancelTarget = page.locator('[data-testid="calendar-post"]', { hasText: "đổi lịch qua UI" });
  await cancelTarget.locator('[data-testid="calendar-cancel"]').click();
  await page.locator('[data-testid="calendar-notice"]').waitFor({ timeout: 25000 });
  const cancelNotice = await page.locator('[data-testid="calendar-notice"]').innerText();
  check("Hủy lịch thành công", /hủy lịch/i.test(cancelNotice), cancelNotice.trim());

  const cancelled = db
    .prepare('SELECT status, "scheduledAt" FROM "Post" WHERE id = ?')
    .get("ui-post-1");
  check("Bài hủy lịch chuyển về DRAFT", cancelled.status === "DRAFT", cancelled.status);
  check("Xóa thời gian hẹn khi hủy", cancelled.scheduledAt === null);

  // --- Đăng ngay từ calendar ---
  db.prepare(
    `INSERT INTO "Post" (id, "userId", "pageId", content, status, "scheduledAt", attempts, "createdAt", "updatedAt")
     VALUES (?, ?, ?, ?, 'SCHEDULED', ?, 0, datetime('now'), datetime('now'))`
  ).run(
    "now-post-1",
    smoke.id,
    "e2e-page-1",
    "Bài test Tuần 6 — đăng ngay từ lịch",
    new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString()
  );

  const nowDay = new Date(Date.now() + 5 * 60 * 60 * 1000);
  const nowMonth = `${nowDay.getFullYear()}-${String(nowDay.getMonth() + 1).padStart(2, "0")}`;
  await page.goto(`${BASE}/calendar?month=${nowMonth}`, { waitUntil: "networkidle" });
  const nowDayKey = `${nowDay.getFullYear()}-${pp(nowDay.getMonth() + 1)}-${pp(nowDay.getDate())}`;
  await page.locator(`[data-testid="calendar-day"][data-day="${nowDayKey}"]`).click();
  await page.locator('[data-testid="calendar-detail"]').waitFor({ timeout: 15000 });

  const nowTarget = page.locator('[data-testid="calendar-post"]', { hasText: "đăng ngay từ lịch" });
  await nowTarget.locator('[data-testid="calendar-publish-now"]').click();
  await page.locator('[data-testid="calendar-notice"]').waitFor({ timeout: 30000 });
  const nowNotice = await page.locator('[data-testid="calendar-notice"]').innerText();
  check("Đăng ngay từ lịch thành công", /Đã đăng ngay thành công/.test(nowNotice), nowNotice.trim());

  const nowRow = db.prepare('SELECT status, "fbPostId" FROM "Post" WHERE id = ?').get("now-post-1");
  check("Bài đăng ngay chuyển thành PUBLISHED", nowRow.status === "PUBLISHED", nowRow.status);
  check("Có fbPostId", Boolean(nowRow.fbPostId), nowRow.fbPostId);

  // ================= 12. Nhịp tim + trạng thái hiển thị =================
  section("Nhịp tim worker hiển thị");
  await page.goto(`${BASE}/calendar`, { waitUntil: "networkidle" });
  const workerText = await page.locator('[data-testid="worker-status"]').innerText();
  check(
    "Sau khi tick, UI báo worker đang chạy",
    /đang chạy/i.test(workerText),
    workerText.trim()
  );
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
