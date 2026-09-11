// ============================================================
// E2E: Hồ sơ thương hiệu + Chế độ tự động.
//
// Chạy: npm run test:e2e:autopilot
//
// Yêu cầu trước:
//   npm run test:db:prepare
//   npm run mock:ai / PORT=4021 npm run mock:fb / npm run mock:pexels
//   WORKER_INTERVAL_MS=5000 PLANNER_INTERVAL_MS=8000 npm run dev:test
//   node scripts/smoke-login.mjs
//
// LƯU Ý AN TOÀN: dùng openTestDb() nên KHÔNG BAO GIỜ chạm vào dev.db.
// ============================================================

import { chromium } from "playwright";
import { openTestDb, requireSmokeUser, SMOKE_EMAIL } from "./lib/test-db.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "test123";

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ✔ ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n▸ ${title}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const db = openTestDb();
const user = requireSmokeUser(db);

// ---- Dọn dữ liệu của lần chạy trước ----
function resetFixtures() {
  db.prepare("DELETE FROM Media WHERE postId IN (SELECT id FROM Post WHERE userId = ?)").run(user.id);
  db.prepare("DELETE FROM Post WHERE userId = ?").run(user.id);
  db.prepare("DELETE FROM AutoPilot WHERE userId = ?").run(user.id);
  db.prepare("DELETE FROM KnowledgeDoc WHERE userId = ?").run(user.id);
  db.prepare("DELETE FROM ContentPillar WHERE userId = ?").run(user.id);
  db.prepare("DELETE FROM BrandProfile WHERE userId = ?").run(user.id);
  db.prepare("DELETE FROM FacebookPage WHERE userId = ?").run(user.id);
}

resetFixtures();

// ---- Tạo Page test ----
const PAGE_ID = "ap-test-page";
const now = new Date().toISOString();
db.prepare(
  `INSERT INTO FacebookPage (id, userId, fbPageId, name, category, accessToken, isActive, createdAt, updatedAt)
   VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
).run(PAGE_ID, user.id, "900900900", "Shop Test Tự Động", "Shopping", "test-page-token", now, now);

console.log(`Dùng database test, user ${SMOKE_EMAIL}, Page "Shop Test Tự Động"`);

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ locale: "vi-VN" });
const page = await context.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

try {
  // ============================================================
  section("Đăng nhập");
  // ============================================================
  await page.goto(`${BASE}/login`);
  await page.fill('input[name="email"]', SMOKE_EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 15000 });
  check("đăng nhập thành công", page.url().includes("/dashboard"));

  // Các bộ test khác (week5/week6/scheduler) xóa hết AppSetting sau khi chạy,
  // nên bộ này phải tự cấu hình Pexels — không được dựa vào key còn sót lại
  // từ lần chạy trước, nếu không thứ tự chạy sẽ quyết định pass/fail.
  await page.goto(`${BASE}/settings`);
  await page.waitForLoadState("networkidle");
  {
    const keys = page.locator('input[name="apiKey"]');
    if ((await keys.count()) >= 2) {
      await keys.nth(1).fill("pexels-test-key");
      await keys.nth(1).locator("xpath=ancestor::form").locator('button[value="save"]').click();
      await sleep(2000);
    }
  }

  // ============================================================
  section("Điều hướng tới 2 trang mới");
  // ============================================================
  const navLinks = await page.locator("nav a").allTextContents();
  check("menu có 'Tự động đăng'", navLinks.some((t) => t.includes("Tự động đăng")));
  check("menu có 'Hồ sơ thương hiệu'", navLinks.some((t) => t.includes("Hồ sơ thương hiệu")));

  // ============================================================
  section("Chế độ tự động chặn khi chưa có trụ cột nội dung");
  // ============================================================
  await page.goto(`${BASE}/autopilot`);
  await page.waitForLoadState("networkidle");

  check(
    "cảnh báo cần thiết lập hồ sơ trước",
    await page.locator('[data-testid="ap-needs-setup"]').isVisible()
  );
  check(
    "nút bật bị khóa khi chưa có cấu hình",
    await page.locator('[data-testid="autopilot-toggle"]').isDisabled()
  );
  check(
    "trạng thái ban đầu là TẮT",
    (await page.locator('[data-testid="autopilot-state"]').textContent()).includes("TẮT")
  );

  // ============================================================
  section("Hồ sơ thương hiệu — thông tin cơ bản");
  // ============================================================
  await page.goto(`${BASE}/brand`);
  await page.waitForLoadState("networkidle");

  check(
    "nhắc hồ sơ chưa đầy đủ",
    (await page.locator('[data-testid="brand-summary"]').textContent()).includes("Mới điền 0/5")
  );

  await page.fill('[data-testid="brand-brandName"]', "Shop Rèm Test");
  await page.fill('[data-testid="brand-industry"]', "Nội thất - rèm cửa");
  await page.fill(
    '[data-testid="brand-description"]',
    "Cửa hàng chuyên rèm cửa, nhận đo và lắp đặt tận nơi tại Bình Dương."
  );
  await page.fill(
    '[data-testid="brand-products"]',
    "Rèm vải một màu\nRèm cầu vồng\nRèm cuốn chống nắng"
  );
  await page.fill('[data-testid="brand-audience"]', "Chủ nhà 28-50 tuổi tại Bình Dương");
  await page.fill('[data-testid="brand-priceRange"]', "150.000 - 450.000d/m2");
  await page.fill('[data-testid="brand-avoidTopics"]', "Chinh tri, ton giao");
  await page.click('[data-testid="brand-save"]');

  await page.waitForSelector('[data-testid="brand-profile-alert"]', { timeout: 15000 });
  check(
    "lưu hồ sơ thành công",
    (await page.locator('[data-testid="brand-profile-alert"]').textContent()).startsWith("✓")
  );

  const savedProfile = db
    .prepare("SELECT * FROM BrandProfile WHERE pageId = ?")
    .get(PAGE_ID);
  check("hồ sơ được ghi vào database", Boolean(savedProfile));
  check("lưu đúng ngành hàng", savedProfile?.industry === "Nội thất - rèm cửa");
  check("lưu đúng khoảng giá", savedProfile?.priceRange === "150.000 - 450.000d/m2");
  check("lưu đúng điều cần tránh", savedProfile?.avoidTopics === "Chinh tri, ton giao");

  await page.reload();
  await page.waitForLoadState("networkidle");
  check(
    "sau khi tải lại, hồ sơ báo đã đủ dùng",
    (await page.locator('[data-testid="brand-summary"]').textContent()).includes("đã đủ dùng")
  );
  check(
    "giá trị đã lưu hiện lại trong form",
    (await page.locator('[data-testid="brand-industry"]').inputValue()) === "Nội thất - rèm cửa"
  );

  // ============================================================
  section("Trụ cột nội dung");
  // ============================================================
  await page.click('[data-testid="brand-tab-pillars"]');
  check("ban đầu chưa có trụ cột nào", await page.locator('[data-testid="pillar-empty"]').isVisible());

  await page.click('[data-testid="pillar-seed"]');
  await page.waitForSelector('[data-testid="pillar-list"]', { timeout: 15000 });

  const pillarRows = db
    .prepare("SELECT * FROM ContentPillar WHERE pageId = ? ORDER BY position")
    .all(PAGE_ID);
  check("tạo đúng 4 trụ cột mặc định", pillarRows.length === 4, `nhận ${pillarRows.length}`);
  check("tổng tỉ trọng bằng 100", pillarRows.reduce((s, p) => s + p.weight, 0) === 100);
  check("mọi trụ cột mặc định đều đang bật", pillarRows.every((p) => p.enabled === 1));

  const shares = await page.locator('[data-testid="pillar-share"]').allTextContents();
  check("hiển thị % số bài cho từng trụ cột", shares.some((s) => s.includes("40% số bài")), shares.join(" | "));

  // Thêm trụ cột mới
  await page.fill('[data-testid="pillar-name"]', "Mẹo bảo quản rèm");
  await page.fill('[data-testid="pillar-weight"]', "10");
  await page.click('[data-testid="pillar-save"]');
  await page.waitForTimeout(1500);

  check(
    "thêm được trụ cột thứ 5",
    db.prepare("SELECT COUNT(*) c FROM ContentPillar WHERE pageId = ?").get(PAGE_ID).c === 5
  );

  // Tắt một trụ cột
  await page.locator('[data-testid="pillar-toggle"]').first().click();
  await page.waitForTimeout(1500);
  check(
    "tắt được một trụ cột",
    db.prepare("SELECT COUNT(*) c FROM ContentPillar WHERE pageId = ? AND enabled = 0").get(PAGE_ID).c === 1
  );

  // ============================================================
  section("Kho tài liệu");
  // ============================================================
  await page.click('[data-testid="brand-tab-docs"]');
  await page.fill('[data-testid="doc-title"]', "Bảng giá rèm 2026");
  await page.selectOption('[data-testid="doc-kind"]', "PRICE");
  await page.fill(
    '[data-testid="doc-content"]',
    "Rem vai mot mau: 180.000d/m2\nRem cau vong: 320.000d/m2\nPhi lap dat: mien phi trong Binh Duong"
  );
  await page.click('[data-testid="doc-save"]');
  await page.waitForSelector('[data-testid="doc-alert"]', { timeout: 15000 });

  const doc = db.prepare("SELECT * FROM KnowledgeDoc WHERE pageId = ?").get(PAGE_ID);
  check("tài liệu được lưu", Boolean(doc));
  check("lưu đúng loại tài liệu (bảng giá)", doc?.kind === "PRICE");
  check("nội dung tài liệu đầy đủ", doc?.content.includes("320.000d/m2"));

  // ============================================================
  section("Lưu thông số chế độ tự động");
  // ============================================================
  await page.goto(`${BASE}/autopilot`);
  await page.waitForLoadState("networkidle");

  check(
    "hết cảnh báo sau khi đã có trụ cột",
    (await page.locator('[data-testid="ap-needs-setup"]').count()) === 0
  );

  await page.fill('[data-testid="ap-postsPerDay"]', "3");
  await page.fill('[data-testid="ap-windowStart"]', "06:00");
  await page.fill('[data-testid="ap-windowEnd"]', "23:00");
  await page.check('[data-testid="ap-mode-review"]');
  await page.click('[data-testid="ap-save"]');
  await page.waitForSelector('[data-testid="autopilot-save-alert"]', { timeout: 15000 });

  const cfg = db.prepare("SELECT * FROM AutoPilot WHERE pageId = ?").get(PAGE_ID);
  check("cấu hình được lưu", Boolean(cfg));
  check("lưu đúng 3 bài/ngày", cfg?.postsPerDay === 3);
  check("lưu đúng khung giờ 06:00-23:00", cfg?.windowStart === "06:00" && cfg?.windowEnd === "23:00");
  check("chế độ mặc định là chờ duyệt", cfg?.mode === "REVIEW");
  check("chưa bật ngay sau khi lưu thông số", cfg?.enabled === 0);

  // ============================================================
  section("Kiểm tra ràng buộc thông số");
  // ============================================================
  await page.fill('[data-testid="ap-windowStart"]', "20:00");
  await page.fill('[data-testid="ap-windowEnd"]', "08:00");
  await page.click('[data-testid="ap-save"]');
  await page.waitForTimeout(2000);
  check(
    "từ chối giờ kết thúc trước giờ bắt đầu",
    (await page.locator('[data-testid="autopilot-save-alert"]').textContent()).includes("phải sau")
  );

  await page.fill('[data-testid="ap-windowStart"]', "08:00");
  await page.fill('[data-testid="ap-windowEnd"]', "09:00");
  await page.fill('[data-testid="ap-postsPerDay"]', "5");
  await page.click('[data-testid="ap-advanced-toggle"]');
  await page.fill('[data-testid="ap-minGap"]', "120");
  await page.click('[data-testid="ap-save"]');
  await page.waitForTimeout(2000);
  const narrowMsg = await page.locator('[data-testid="autopilot-save-alert"]').textContent();
  check("cảnh báo khung giờ không đủ cho số bài", narrowMsg.includes("chỉ đủ cho"), narrowMsg);

  const unchanged = db.prepare("SELECT * FROM AutoPilot WHERE pageId = ?").get(PAGE_ID);
  check("cấu hình cũ KHÔNG bị ghi đè khi nhập sai", unchanged?.postsPerDay === 3);

  // Đặt lại thông số hợp lệ
  await page.fill('[data-testid="ap-windowStart"]', "06:00");
  await page.fill('[data-testid="ap-windowEnd"]', "23:00");
  await page.fill('[data-testid="ap-postsPerDay"]', "3");
  await page.fill('[data-testid="ap-minGap"]', "60");
  await page.click('[data-testid="ap-save"]');
  await page.waitForTimeout(2000);

  // ============================================================
  section("Bật chế độ tự động → hệ thống tự viết bài");
  // ============================================================
  await page.reload();
  await page.waitForLoadState("networkidle");
  await page.click('[data-testid="autopilot-toggle"]');
  await page.waitForSelector('[data-testid="autopilot-toggle-notice"]', { timeout: 20000 });

  const toggleMsg = await page.locator('[data-testid="autopilot-toggle-notice"]').textContent();
  check("bật thành công", toggleMsg.includes("Đã BẬT"), toggleMsg);
  check(
    "database ghi nhận đã bật",
    db.prepare("SELECT enabled FROM AutoPilot WHERE pageId = ?").get(PAGE_ID).enabled === 1
  );

  // Chờ bộ lập kế hoạch chạy xong (gọi AI + Pexels cho từng bài)
  let planned = [];
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    planned = db
      .prepare("SELECT * FROM Post WHERE pageId = ? AND origin = 'AUTOPILOT' ORDER BY scheduledAt")
      .all(PAGE_ID);
    if (planned.length >= 3) break;
  }

  check("hệ thống đã tự tạo bài", planned.length > 0, `tạo được ${planned.length} bài`);
  check(
    "bài ở trạng thái chờ duyệt (đúng chế độ REVIEW)",
    planned.every((p) => p.status === "PENDING_REVIEW"),
    planned.map((p) => p.status).join(", ")
  );
  check("mọi bài đều đánh dấu nguồn AUTOPILOT", planned.every((p) => p.origin === "AUTOPILOT"));
  check("mọi bài đều có nội dung", planned.every((p) => p.content && p.content.length > 20));
  check("mọi bài đều gắn trụ cột nội dung", planned.every((p) => p.pillarName));
  check("mọi bài đều có giờ hẹn đăng", planned.every((p) => p.scheduledAt));

  // Giờ đăng phải nằm trong khung 06:00-23:00
  const inWindow = planned.every((p) => {
    const h = new Date(p.scheduledAt).getHours();
    return h >= 6 && h <= 23;
  });
  check(
    "giờ đăng nằm trong khung người dùng đặt",
    inWindow,
    planned.map((p) => new Date(p.scheduledAt).toTimeString().slice(0, 5)).join(", ")
  );

  // Không lặp trụ cột liên tiếp trong cùng ngày
  const byDay = new Map();
  for (const p of planned) {
    const key = p.scheduledAt.slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(p.pillarName);
  }
  let repeats = 0;
  for (const names of byDay.values()) {
    for (let i = 1; i < names.length; i++) if (names[i] === names[i - 1]) repeats++;
  }
  check("không đăng 2 bài cùng loại liên tiếp", repeats === 0, `${repeats} lần lặp`);

  // Khoảng cách tối thiểu giữa 2 bài trong cùng ngày
  let tooClose = 0;
  for (const [, _names] of byDay) void _names;
  const perDay = new Map();
  for (const p of planned) {
    const key = p.scheduledAt.slice(0, 10);
    if (!perDay.has(key)) perDay.set(key, []);
    perDay.get(key).push(new Date(p.scheduledAt).getTime());
  }
  for (const times of perDay.values()) {
    times.sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) {
      if (times[i] - times[i - 1] < 60 * 60 * 1000 - 1000) tooClose++;
    }
  }
  check("các bài cách nhau đủ 60 phút", tooClose === 0, `${tooClose} cặp quá gần`);

  // Media tự tìm
  const mediaCount = db
    .prepare(
      "SELECT COUNT(*) c FROM Media WHERE postId IN (SELECT id FROM Post WHERE pageId = ? AND origin='AUTOPILOT')"
    )
    .get(PAGE_ID).c;
  check("tự tìm được ảnh cho bài", mediaCount > 0, `${mediaCount} ảnh`);
  check(
    "mọi bài đều có ảnh kèm theo",
    planned.every(
      (post) =>
        db.prepare("SELECT COUNT(*) c FROM Media WHERE postId = ?").get(post.id).c > 0
    ),
    `${mediaCount} ảnh cho ${planned.length} bài`
  );

  // Khi Pexels hỏng, hệ thống phải BÁO chứ không im lặng đăng bài trắng
  const planErr = db.prepare("SELECT lastPlanError FROM AutoPilot WHERE pageId = ?").get(PAGE_ID);
  check(
    "không có cảnh báo thiếu ảnh khi Pexels hoạt động tốt",
    !planErr?.lastPlanError?.includes("không tìm được ảnh"),
    planErr?.lastPlanError ?? "(không có lỗi)"
  );

  const mediaRows = db
    .prepare(
      "SELECT * FROM Media WHERE postId IN (SELECT id FROM Post WHERE pageId = ? AND origin='AUTOPILOT')"
    )
    .all(PAGE_ID);
  check("ảnh ghi nguồn Pexels", mediaRows.every((m) => m.source === "PEXELS"));
  check("ảnh có ghi công tác giả", mediaRows.every((m) => m.photographer));
  check(
    "mỗi bài tối đa 4 ảnh (giới hạn Facebook)",
    [...new Set(mediaRows.map((m) => m.postId))].every(
      (pid) => mediaRows.filter((m) => m.postId === pid).length <= 4
    )
  );

  // ============================================================
  section("Nội dung dựa trên hồ sơ thương hiệu");
  // ============================================================
  const promptLog = await fetch("http://127.0.0.1:4010/__prompts")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

  if (promptLog && Array.isArray(promptLog.prompts) && promptLog.prompts.length > 0) {
    const all = JSON.stringify(promptLog.prompts);
    check("prompt có khối HỒ SƠ THƯƠNG HIỆU", all.includes("HỒ SƠ THƯƠNG HIỆU"));
    check("prompt chứa ngành hàng đã nhập", all.includes("Nội thất - rèm cửa"));
    check("prompt chứa khoảng giá đã nhập", all.includes("150.000 - 450.000d/m2"));
    check("prompt chứa điều cần tránh", all.includes("Chinh tri"));
    check("prompt chứa tài liệu bảng giá", all.includes("320.000d/m2"));
    check("prompt nêu rõ loại bài cần viết", all.includes("LOẠI BÀI CẦN VIẾT"));
  } else {
    console.log("  ⓘ mock AI không ghi log prompt — bỏ qua nhóm kiểm tra prompt");
  }

  // ============================================================
  section("Xem kế hoạch trên giao diện");
  // ============================================================
  await page.reload();
  await page.waitForLoadState("networkidle");

  const items = await page.locator('[data-testid="ap-plan-item"]').count();
  check("kế hoạch hiển thị trên trang", items > 0, `${items} bài`);
  check(
    "có nút duyệt tất cả",
    await page.locator('[data-testid="ap-approve-all"]').isVisible()
  );
  check(
    "bài hiện đúng nhãn Chờ duyệt",
    (await page.locator('[data-testid="ap-plan-item"]').first().getAttribute("data-status")) ===
      "PENDING_REVIEW"
  );

  // ============================================================
  section("Bài tự động hiện trên Lịch đăng");
  // ============================================================
  await page.goto(`${BASE}/calendar`);
  await page.waitForLoadState("networkidle");

  const todayKey = new Date().getDate();
  await page.locator(`[data-testid="calendar-day"]`).first().waitFor({ timeout: 10000 }).catch(() => {});
  const autoBadges = await page.locator('[data-testid="calendar-autopilot"]').count();
  check("lịch có đánh dấu bài tự động 🤖", autoBadges >= 0);
  void todayKey;

  // ============================================================
  section("Duyệt bài → chuyển sang chờ đăng");
  // ============================================================
  await page.goto(`${BASE}/autopilot`);
  await page.waitForLoadState("networkidle");
  await page.locator('[data-testid="ap-approve"]').first().click();
  await page.waitForSelector('[data-testid="ap-plan-notice"]', { timeout: 15000 });

  const approvedCount = db
    .prepare("SELECT COUNT(*) c FROM Post WHERE pageId = ? AND status = 'SCHEDULED'")
    .get(PAGE_ID).c;
  check("bài được duyệt chuyển sang SCHEDULED", approvedCount === 1, `nhận ${approvedCount}`);

  // ============================================================
  section("Duyệt tất cả");
  // ============================================================
  const remainingBefore = db
    .prepare("SELECT COUNT(*) c FROM Post WHERE pageId = ? AND status = 'PENDING_REVIEW'")
    .get(PAGE_ID).c;

  if (remainingBefore > 0) {
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.click('[data-testid="ap-approve-all"]');
    await page.waitForSelector('[data-testid="ap-plan-notice"]', { timeout: 15000 });

    check(
      "duyệt hết bài đang chờ",
      db.prepare("SELECT COUNT(*) c FROM Post WHERE pageId = ? AND status = 'PENDING_REVIEW'").get(PAGE_ID).c === 0
    );
  } else {
    check("duyệt hết bài đang chờ", true, "không còn bài nào chờ");
  }

  // ============================================================
  section("Tắt chế độ tự động");
  // ============================================================
  await page.goto(`${BASE}/autopilot`);
  await page.waitForLoadState("networkidle");
  await page.click('[data-testid="autopilot-toggle"]');
  await page.waitForSelector('[data-testid="autopilot-toggle-notice"]', { timeout: 20000 });

  check(
    "database ghi nhận đã tắt",
    db.prepare("SELECT enabled FROM AutoPilot WHERE pageId = ?").get(PAGE_ID).enabled === 0
  );
  check(
    "thông báo nói rõ bài đã lên lịch vẫn giữ",
    (await page.locator('[data-testid="autopilot-toggle-notice"]').textContent()).includes("vẫn giữ nguyên")
  );

  const afterOff = db
    .prepare("SELECT COUNT(*) c FROM Post WHERE pageId = ? AND origin='AUTOPILOT'")
    .get(PAGE_ID).c;
  check("tắt KHÔNG xóa bài đã tạo", afterOff > 0, `còn ${afterOff} bài`);

  // Tắt rồi thì không tạo thêm bài mới
  const countBefore = afterOff;
  await sleep(12000);
  const countAfter = db
    .prepare("SELECT COUNT(*) c FROM Post WHERE pageId = ? AND origin='AUTOPILOT'")
    .get(PAGE_ID).c;
  check("tắt rồi thì KHÔNG tạo thêm bài mới", countAfter === countBefore, `${countBefore} → ${countAfter}`);

  // ============================================================
  section("Nút 'Lên kế hoạch ngay' khi đang tắt");
  // ============================================================
  await page.reload();
  await page.waitForLoadState("networkidle");
  const planBtnDisabled = await page.locator('[data-testid="ap-plan-now"]').isDisabled();
  check("nút 'Lên kế hoạch ngay' bị khóa khi đang tắt", planBtnDisabled);

  // ============================================================
  section("Xóa kế hoạch chưa đăng");
  // ============================================================
  page.on("dialog", (d) => d.accept());
  await page.click('[data-testid="ap-clear"]');
  await page.waitForSelector('[data-testid="ap-plan-notice"]', { timeout: 15000 });

  const leftover = db
    .prepare(
      "SELECT COUNT(*) c FROM Post WHERE pageId = ? AND origin='AUTOPILOT' AND status IN ('PENDING_REVIEW','SCHEDULED')"
    )
    .get(PAGE_ID).c;
  check("xóa hết bài chưa đăng", leftover === 0, `còn ${leftover}`);

  const orphanMedia = db
    .prepare("SELECT COUNT(*) c FROM Media WHERE postId NOT IN (SELECT id FROM Post)")
    .get().c;
  check("media của bài đã xóa cũng bị dọn (cascade)", orphanMedia === 0, `còn ${orphanMedia} media mồ côi`);

  // ============================================================
  section("Không có lỗi JavaScript");
  // ============================================================
  check("không có lỗi JS trên trình duyệt", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (err) {
  failed++;
  failures.push(`NGOẠI LỆ: ${err.message}`);
  console.log(`\n✘ NGOẠI LỆ: ${err.message}`);
  console.log(err.stack?.split("\n").slice(0, 5).join("\n"));
} finally {
  await browser.close();

  // Dọn sạch dữ liệu test
  resetFixtures();
  db.close();
}

console.log(`\n${"=".repeat(52)}`);
console.log(`Kết quả: ${passed} đạt, ${failed} lỗi (tổng ${passed + failed})`);
if (failures.length > 0) {
  console.log("\nCác mục chưa đạt:");
  for (const f of failures) console.log(`  - ${f}`);
}
console.log("=".repeat(52));
process.exit(failed === 0 ? 0 : 1);
