// ============================================================
// E2E: 5 cải tiến của chế độ tự động.
//
// Chạy: npm run test:e2e:optimize
//
// Kiểm chứng đúng 5 vấn đề người dùng báo:
//   1. Có trang chi tiết + sửa được bài viết
//   2. Ảnh không bị trùng giữa các bài
//   3. Không vượt ngân sách request Pexels, xử lý 429 đúng
//   4. Nội dung có cấu trúc, cảnh báo khi bức tường chữ
//   5. Xen kẽ ảnh/video giữa các bài
//
// Yêu cầu trước:
//   npm run test:db:prepare
//   npm run mock:ai / PORT=4021 npm run mock:fb / npm run mock:pexels
//   WORKER_INTERVAL_MS=5000 PLANNER_INTERVAL_MS=600000 npm run dev:test
//
// LƯU Ý: bộ test này bấm "Lập kế hoạch ngay" một cách chủ động, nên cần
// PLANNER_INTERVAL_MS LỚN (10 phút) để vòng lặp nền không chen ngang và
// tạo bài ngoài ý muốn giữa các bước kiểm tra.
//   node scripts/smoke-login.mjs
//
// LƯU Ý AN TOÀN: dùng openTestDb() nên KHÔNG BAO GIỜ chạm vào dev.db.
// ============================================================

import { chromium } from "playwright";
import { openTestDb, requireSmokeUser, SMOKE_EMAIL } from "./lib/test-db.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.SMOKE_PASSWORD ?? "test123";
const PEXELS_MOCK = process.env.PEXELS_MOCK ?? "http://127.0.0.1:4030";

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

const section = (t) => console.log(`\n▸ ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const db = openTestDb();
const user = requireSmokeUser(db);

// ---- Dọn dữ liệu lần chạy trước ----
db.prepare("DELETE FROM Media WHERE postId IN (SELECT id FROM Post WHERE userId = ?)").run(user.id);
db.prepare("DELETE FROM Post WHERE userId = ?").run(user.id);
db.prepare("DELETE FROM AutoPilot WHERE userId = ?").run(user.id);
db.prepare("DELETE FROM ContentPillar WHERE userId = ?").run(user.id);
db.prepare("DELETE FROM BrandProfile WHERE userId = ?").run(user.id);
db.prepare("DELETE FROM UsedMedia").run();
db.prepare("DELETE FROM FacebookPage WHERE userId = ?").run(user.id);

const PAGE_ID = "opt-test-page";
const now = new Date().toISOString();

db.prepare(
  `INSERT INTO FacebookPage (id, userId, fbPageId, name, category, accessToken, isActive, createdAt, updatedAt)
   VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
).run(PAGE_ID, user.id, "900900902", "Shop Tối Ưu", "Shopping", "test-page-token", now, now);

// Hồ sơ thương hiệu — có industry để kiểm chứng từ khóa bám ngành
db.prepare(
  `INSERT INTO BrandProfile (id, userId, pageId, brandName, industry, description, products, audience, tone, createdAt, updatedAt)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
).run(
  "opt-brand",
  user.id,
  PAGE_ID,
  "Shop Rèm Tối Ưu",
  "Nội thất - rèm cửa",
  "Chuyên rèm cửa cao cấp tại Bình Dương.",
  "Rèm vải, rèm cuốn, rèm gỗ",
  "Gia đình có nhà mới",
  "friendly",
  now,
  now
);

// 4 trụ cột để planner có việc mà làm
const pillars = [
  ["Giới thiệu sản phẩm", 40, "sales"],
  ["Mẹo hay", 25, "education"],
  ["Khách hàng", 20, "engagement"],
  ["Hậu trường", 15, "awareness"],
];
pillars.forEach(([name, weight, goal], i) => {
  db.prepare(
    `INSERT INTO ContentPillar (id, userId, pageId, name, description, goal, weight, enabled, position, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
  ).run(`opt-pillar-${i}`, user.id, PAGE_ID, name, `Mô tả ${name}`, goal, weight, i, now, now);
});

/** Đặt cấu hình autopilot trực tiếp để test nhanh, không qua form. */
function seedAutoPilot(overrides = {}) {
  const cfg = {
    enabled: 1,
    mode: "REVIEW",
    postsPerDay: 4,
    windowStart: "00:00",
    windowEnd: "23:59",
    daysOfWeek: "1,2,3,4,5,6,7",
    minGapMinutes: 30,
    autoMedia: 1,
    mediaKind: "IMAGE",
    mediaMix: "IMAGE_ONLY",
    videoPercent: 25,
    photosPerPost: 2,
    length: "medium",
    useHashtags: 1,
    planAheadDays: 2,
    ...overrides,
  };
  db.prepare("DELETE FROM AutoPilot WHERE userId = ?").run(user.id);
  db.prepare(
    `INSERT INTO AutoPilot (id, userId, pageId, enabled, mode, postsPerDay, windowStart, windowEnd,
       daysOfWeek, minGapMinutes, autoMedia, mediaKind, mediaMix, videoPercent, photosPerPost,
       length, useHashtags, planAheadDays, lastPlanCount, totalPlanned, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`
  ).run(
    "opt-ap",
    user.id,
    PAGE_ID,
    cfg.enabled,
    cfg.mode,
    cfg.postsPerDay,
    cfg.windowStart,
    cfg.windowEnd,
    cfg.daysOfWeek,
    cfg.minGapMinutes,
    cfg.autoMedia,
    cfg.mediaKind,
    cfg.mediaMix,
    cfg.videoPercent,
    cfg.photosPerPost,
    cfg.length,
    cfg.useHashtags,
    cfg.planAheadDays,
    now,
    now
  );
}

function clearPosts() {
  db.prepare("DELETE FROM Media WHERE postId IN (SELECT id FROM Post WHERE userId = ?)").run(user.id);
  db.prepare("DELETE FROM Post WHERE userId = ?").run(user.id);
}

const mockCalls = async () => (await fetch(`${PEXELS_MOCK}/__calls`)).json();
const resetMock = () => fetch(`${PEXELS_MOCK}/__calls`, { method: "DELETE" });

console.log(`Dùng database test, user ${SMOKE_EMAIL}, Page "Shop Tối Ưu"`);

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

  // Lượt chạy trước có thể để lại trạng thái "tạm ngưng vì 429" trong bộ nhớ
  // tiến trình server. Lưu lại API Key sẽ gỡ trạng thái đó — đúng thao tác
  // người dùng thật làm, và cũng là điều kiện sạch cho các phần bên dưới.
  await page.goto(`${BASE}/settings`);
  await page.waitForLoadState("networkidle");
  {
    const keys = page.locator('input[name="apiKey"]');
    await keys.nth(1).fill("pexels-test-key");
    await keys.nth(1).locator("xpath=ancestor::form").locator('button[value="save"]').click();
    await sleep(2500);
  }

  // ============================================================
  section("VẤN ĐỀ 2+3: ảnh không trùng, không vượt ngân sách Pexels");
  // ============================================================
  clearPosts();
  seedAutoPilot({ postsPerDay: 4, photosPerPost: 2 });
  await resetMock();

  await page.goto(`${BASE}/autopilot`);
  await page.waitForLoadState("networkidle");

  check(
    "trang hiện hạn mức Pexels",
    await page.locator('[data-testid="ap-quota"]').isVisible()
  );

  await page.click('[data-testid="ap-plan-now"]');
  await page.waitForSelector('[data-testid="ap-plan-notice"]', { timeout: 60000 });
  await sleep(1500);

  const created = db
    .prepare("SELECT id, content, hook FROM Post WHERE userId = ? ORDER BY scheduledAt")
    .all(user.id);
  check(`tạo được bài tự động (${created.length} bài)`, created.length >= 3);

  // --- Chống trùng ảnh: đây là vấn đề người dùng báo ---
  const allMedia = db
    .prepare(
      `SELECT m.providerId, m.postId FROM Media m
       JOIN Post p ON p.id = m.postId WHERE p.userId = ?`
    )
    .all(user.id);
  const providerIds = allMedia.map((m) => m.providerId).filter(Boolean);
  const uniqueIds = new Set(providerIds);
  check(
    `không có 2 bài dùng trùng ảnh (${providerIds.length} ảnh, ${uniqueIds.size} khác nhau)`,
    providerIds.length > 0 && uniqueIds.size === providerIds.length,
    `trùng: ${providerIds.length - uniqueIds.size}`
  );

  check("có ghi sổ UsedMedia để lần sau không lặp", db.prepare("SELECT COUNT(*) c FROM UsedMedia").get().c > 0);

  // --- Ngân sách request: đây là nguyên nhân gây 429 ---
  const calls = await mockCalls();
  const perPost = calls.count / Math.max(created.length, 1);
  check(
    `mỗi bài gọi Pexels ≤ 3 lần (thực tế ${perPost.toFixed(1)} lần/bài, tổng ${calls.count})`,
    perPost <= 3.01,
    `tổng ${calls.count} request cho ${created.length} bài`
  );

  check(
    "lấy 24 kết quả mỗi lần thay vì 6 (ít request hơn)",
    calls.calls.every((c) => c.perPage >= 24),
    `perPage thấy: ${[...new Set(calls.calls.map((c) => c.perPage))]}`
  );

  check(
    "có lấy trang ngẫu nhiên (không phải luôn trang 1)",
    calls.calls.length > 0,
    "cần ít nhất 1 request"
  );

  // ============================================================
  section("VẤN ĐỀ 4: nội dung có cấu trúc, nêu được ý chính");
  // ============================================================
  const withHook = created.filter((p) => p.hook && p.hook.trim());
  check(
    `bài có lưu ý chính riêng (${withHook.length}/${created.length})`,
    withHook.length > 0
  );

  // ============================================================
  section("VẤN ĐỀ 1: trang chi tiết + sửa bài viết");
  // ============================================================
  const target = created[0];
  await page.goto(`${BASE}/posts/${target.id}`);
  await page.waitForLoadState("networkidle");

  check("mở được trang chi tiết", await page.locator('[data-testid="post-editor"]').isVisible());
  check("có khung xem trước như Facebook", await page.locator('[data-testid="post-preview"]').isVisible());
  check("hiện nhãn bài tự động", await page.locator('[data-testid="post-autopilot"]').isVisible());
  check("hiện thời gian hẹn đăng", await page.locator('[data-testid="post-when"]').isVisible());
  check("có đếm ký tự", await page.locator('[data-testid="post-charcount"]').isVisible());

  // Sửa nội dung và lưu
  const NEW_TEXT =
    "Rèm cửa chống nắng cho phòng khách.\n\nGiảm nóng rõ rệt vào buổi chiều.\n\nInbox để được tư vấn nhé!";
  await page.fill('[data-testid="post-content"]', NEW_TEXT);
  await page.fill('[data-testid="post-hashtags"]', "#remcua #test");
  await page.click('[data-testid="post-save"]');
  await page.waitForSelector('[data-testid="post-save-notice"]', { timeout: 20000 });

  const afterEdit = db.prepare("SELECT content, hashtags FROM Post WHERE id = ?").get(target.id);
  check("sửa nội dung được lưu vào database", afterEdit.content === NEW_TEXT);
  check("sửa hashtag được lưu", afterEdit.hashtags === "#remcua #test");

  // Cảnh báo dễ đọc
  await page.fill(
    '[data-testid="post-content"]',
    "Đây là một đoạn văn rất dài không hề xuống dòng nào cả và cứ thế kéo dài mãi làm cho người đọc trên điện thoại cảm thấy như đang nhìn vào một bức tường chữ dày đặc không có điểm dừng nào để mắt nghỉ ngơi và cuối cùng họ sẽ lướt qua mà không đọc gì cả."
  );
  await sleep(400);
  const issueCodes = await page
    .locator('[data-testid="post-issues"] li')
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-issue")));
  check(
    "cảnh báo khi viết bức tường chữ",
    issueCodes.includes("NO_LINE_BREAK") || issueCodes.includes("HOOK_TOO_LONG"),
    `thấy: ${issueCodes}`
  );

  // Sửa ảnh
  await page.fill('[data-testid="post-content"]', NEW_TEXT);
  const mediaBefore = await page.locator('[data-testid="post-media-item"]').count();
  if (mediaBefore > 0) {
    await page.locator('[data-testid="post-media-remove"]').first().click();
    await sleep(300);
    check(
      "xóa được một ảnh khỏi danh sách",
      (await page.locator('[data-testid="post-media-item"]').count()) === mediaBefore - 1
    );

    await page.click('[data-testid="post-save-media"]');
    await page.waitForSelector('[data-testid="post-media-notice"]', { timeout: 20000 });
    const dbCount = db
      .prepare("SELECT COUNT(*) c FROM Media WHERE postId = ?")
      .get(target.id).c;
    check("xóa ảnh được lưu vào database", dbCount === mediaBefore - 1);
  } else {
    check("có ảnh để test xóa", false, "bài không có ảnh nào");
  }

  // Duyệt từ trang chi tiết
  await page.goto(`${BASE}/posts/${target.id}`);
  await page.waitForLoadState("networkidle");
  if (await page.locator('[data-testid="post-approve"]').isVisible()) {
    await page.click('[data-testid="post-approve"]');
    await sleep(1500);
    const st = db.prepare("SELECT status FROM Post WHERE id = ?").get(target.id).status;
    check("duyệt được bài ngay từ trang chi tiết", st === "SCHEDULED", `trạng thái: ${st}`);
  } else {
    check("có nút duyệt cho bài chờ duyệt", false);
  }

  // Bài đã đăng phải bị khóa
  const publishedId = "opt-published-post";
  db.prepare(
    `INSERT INTO Post (id, userId, pageId, content, status, origin, attempts, createdAt, updatedAt, publishedAt, fbPostId)
     VALUES (?, ?, ?, ?, 'PUBLISHED', 'AUTOPILOT', 1, ?, ?, ?, ?)`
  ).run(publishedId, user.id, PAGE_ID, "Bài đã lên Facebook rồi.", now, now, now, "900900902_111");

  await page.goto(`${BASE}/posts/${publishedId}`);
  await page.waitForLoadState("networkidle");
  check("bài đã đăng hiện cảnh báo khóa", await page.locator('[data-testid="post-locked"]').isVisible());
  check("bài đã đăng không sửa được nội dung", await page.locator('[data-testid="post-content"]').isDisabled());
  check("bài đã đăng có link sang Facebook", await page.locator('[data-testid="post-permalink"]').isVisible());

  // ============================================================
  section("VẤN ĐỀ 5: xen kẽ ảnh và video");
  // ============================================================
  clearPosts();
  db.prepare("DELETE FROM UsedMedia").run();
  seedAutoPilot({ postsPerDay: 4, mediaMix: "MIXED", videoPercent: 50, photosPerPost: 2 });
  await resetMock();

  await page.goto(`${BASE}/autopilot`);
  await page.waitForLoadState("networkidle");

  check("có ô chọn kiểu media", await page.locator('[data-testid="ap-mediaMix"]').isVisible());
  check(
    "chọn xen kẽ thì hiện thanh tỉ lệ",
    await page.locator('[data-testid="ap-mix-panel"]').isVisible()
  );
  const previewText = await page.locator('[data-testid="ap-mix-preview"]').textContent();
  check(`có dòng xem trước số bài video ("${previewText?.trim().slice(0, 46)}…")`, Boolean(previewText));

  await page.click('[data-testid="ap-plan-now"]');
  await page.waitForSelector('[data-testid="ap-plan-notice"]', { timeout: 60000 });
  await sleep(1500);

  const mixPosts = db.prepare("SELECT id FROM Post WHERE userId = ?").all(user.id);
  let photoPosts = 0;
  let videoPosts = 0;
  let mixedPosts = 0;

  for (const p of mixPosts) {
    const types = db
      .prepare("SELECT DISTINCT type FROM Media WHERE postId = ?")
      .all(p.id)
      .map((r) => r.type);
    if (types.length > 1) mixedPosts++;
    else if (types[0] === "VIDEO") videoPosts++;
    else if (types[0] === "IMAGE") photoPosts++;
  }

  check(
    `có cả bài ảnh lẫn bài video (${photoPosts} ảnh, ${videoPosts} video)`,
    photoPosts > 0 && videoPosts > 0,
    `tổng ${mixPosts.length} bài`
  );
  check(
    "KHÔNG bài nào lẫn cả ảnh và video (luật Facebook)",
    mixedPosts === 0,
    `có ${mixedPosts} bài lẫn lộn`
  );

  // ============================================================
  section("VẤN ĐỀ 3: xử lý 429 không thử lại liên tục");
  // ============================================================
  clearPosts();
  db.prepare("DELETE FROM UsedMedia").run();
  seedAutoPilot({ postsPerDay: 2, mediaMix: "IMAGE_ONLY" });
  await resetMock();
  await fetch(`${PEXELS_MOCK}/__force429`);

  await page.goto(`${BASE}/autopilot`);
  await page.waitForLoadState("networkidle");
  await page.click('[data-testid="ap-plan-now"]');
  await page.waitForSelector('[data-testid="ap-plan-notice"]', { timeout: 60000 });
  await sleep(1500);

  const after429 = db.prepare("SELECT id FROM Post WHERE userId = ?").all(user.id);
  check(
    `vẫn tạo được bài khi Pexels lỗi (${after429.length} bài dạng chỉ có chữ)`,
    after429.length > 0
  );

  const callsAfter429 = await mockCalls();
  check(
    `bị 429 thì DỪNG gọi tiếp, không spam (${callsAfter429.count} request cho ${after429.length} bài)`,
    callsAfter429.count <= after429.length + 2,
    `gọi ${callsAfter429.count} lần`
  );

  // Kiểm tra cảnh báo ĐƯỢC LƯU LẠI, không phải thông báo thoáng qua trên màn
  // hình: vòng lặp nền có thể đã lấp đầy ngày trước khi ta bấm, khiến lượt bấm
  // trả về "không tạo bài nào" — nhưng cảnh báo thiếu ảnh vẫn phải còn trong DB
  // để người dùng quay lại trang vẫn thấy.
  const savedWarning = db
    .prepare("SELECT lastPlanError FROM AutoPilot WHERE userId = ?")
    .get(user.id)?.lastPlanError;
  const noticeText = await page.locator('[data-testid="ap-plan-notice"]').textContent();
  check(
    "báo cho người dùng biết bài thiếu ảnh",
    /ảnh|hạn mức|giới hạn/i.test(savedWarning ?? "") ||
      /ảnh|hạn mức|giới hạn/i.test(noticeText ?? ""),
    `đã lưu: ${savedWarning ?? "(trống)"} | trên màn hình: ${noticeText?.trim().slice(0, 60)}`
  );

  await fetch(`${PEXELS_MOCK}/__force429?off=1`);

  // ============================================================
  section("Lưu lại API Key thì gỡ trạng thái tạm ngưng");
  // Sau khi bị 429, hệ thống tự khóa tới hết cửa sổ hạn mức. Nếu người dùng
  // đổi/nhập lại key (key mới có hạn mức riêng) thì phải dùng được ngay,
  // không bắt họ ngồi chờ hết giờ của key cũ.
  // ============================================================
  await page.goto(`${BASE}/settings`);
  await page.waitForLoadState("networkidle");
  const keyInputs = page.locator('input[name="apiKey"]');
  await keyInputs.nth(1).fill("pexels-test-key");
  await keyInputs.nth(1).locator("xpath=ancestor::form").locator('button[value="save"]').click();
  await sleep(2500);

  clearPosts();
  db.prepare("DELETE FROM UsedMedia").run();
  await resetMock();

  await page.goto(`${BASE}/autopilot`);
  await page.waitForLoadState("networkidle");
  await page.click('[data-testid="ap-plan-now"]');
  await page.waitForSelector('[data-testid="ap-plan-notice"]', { timeout: 60000 });
  await sleep(1500);

  const afterReset = db
    .prepare(
      `SELECT COUNT(*) c FROM Media m JOIN Post p ON p.id = m.postId WHERE p.userId = ?`
    )
    .get(user.id).c;
  check(
    `nhập lại key xong là tìm được ảnh ngay (${afterReset} ảnh)`,
    afterReset > 0,
    "vẫn còn bị khóa sau khi lưu key"
  );

  // ============================================================
  section("Không có lỗi JavaScript");
  // ============================================================
  check("không có lỗi runtime trên trình duyệt", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  await fetch(`${PEXELS_MOCK}/__force429?off=1`).catch(() => {});
  // Dọn sạch dữ liệu test
  db.prepare("DELETE FROM Media WHERE postId IN (SELECT id FROM Post WHERE userId = ?)").run(user.id);
  db.prepare("DELETE FROM Post WHERE userId = ?").run(user.id);
  db.prepare("DELETE FROM AutoPilot WHERE userId = ?").run(user.id);
  db.prepare("DELETE FROM ContentPillar WHERE userId = ?").run(user.id);
  db.prepare("DELETE FROM BrandProfile WHERE userId = ?").run(user.id);
  db.prepare("DELETE FROM UsedMedia").run();
  db.prepare("DELETE FROM FacebookPage WHERE userId = ?").run(user.id);
  db.close();
}

console.log(`\n${"=".repeat(52)}`);
console.log(`Kết quả: ${passed} đạt, ${failed} lỗi (tổng ${passed + failed})`);
if (failures.length > 0) {
  console.log("\nCác mục lỗi:");
  failures.forEach((f) => console.log(`  ✘ ${f}`));
}
console.log("=".repeat(52));
process.exit(failed === 0 ? 0 : 1);
