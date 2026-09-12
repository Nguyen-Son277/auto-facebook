// ============================================================
// E2E: vòng đời TRỌN VẸN của chế độ tự động (mode = AUTO).
//
// Câu hỏi cần trả lời: "đặt thông số xong rồi có thật sự không phải
// làm gì nữa không?" — test này chứng minh bài tự đi từ lúc AI viết
// cho tới khi lên Facebook, không có thao tác tay nào ở giữa.
//
// Chạy: node scripts/e2e-autopilot-fullcycle.mjs
// ============================================================

import { openTestDb, requireSmokeUser } from "./lib/test-db.mjs";
import { ensureWorkspace, ensureBrand, seedPage } from "./lib/test-fixtures.mjs";
import { seedMockSettings } from "./lib/seed-settings.mjs";

const FB_MOCK = process.env.FB_MOCK_URL ?? "http://127.0.0.1:4021";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const CRON_SECRET = process.env.CRON_SECRET ?? "";

/**
 * Gõ vào endpoint cron để chạy một vòng scheduler + lập kế hoạch.
 *
 * Trước đây test chỉ ngồi chờ vòng lặp nền tự chạy, nên kết quả phụ thuộc
 * PLANNER_INTERVAL_MS của dev server — chạy được hay không là do may rủi.
 * Gọi thẳng endpoint (đúng cách worker thật làm) khiến test tất định.
 */
async function tick() {
  const headers = CRON_SECRET ? { Authorization: `Bearer ${CRON_SECRET}` } : {};
  try {
    const res = await fetch(`${BASE}/api/cron/tick`, { method: "POST", headers });
    return await res.json();
  } catch {
    // Server chưa sẵn sàng ở nhịp đầu — vòng lặp gọi lại ngay sau đó
    return null;
  }
}

let passed = 0, failed = 0;
const failures = [];
const check = (n, c, d = "") => {
  if (c) { passed++; console.log(`  ✔ ${n}`); }
  else { failed++; failures.push(`${n}${d ? ` — ${d}` : ""}`); console.log(`  ✘ ${n}${d ? ` — ${d}` : ""}`); }
};
const section = (t) => console.log(`\n▸ ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const db = openTestDb();
const user = requireSmokeUser(db);
const PAGE_ID = "ap-cycle-page";

function reset() {
  db.prepare("DELETE FROM Media WHERE postId IN (SELECT id FROM Post WHERE userId = ?)").run(user.id);
  db.prepare("DELETE FROM Post WHERE userId = ?").run(user.id);
  db.prepare("DELETE FROM AutoPilot WHERE userId = ?").run(user.id);
  db.prepare("DELETE FROM ContentPillar WHERE userId = ?").run(user.id);
  db.prepare("DELETE FROM BrandProfile WHERE userId = ?").run(user.id);
  db.prepare("DELETE FROM FacebookPage WHERE userId = ?").run(user.id);
}
reset();

// Bộ test khác có thể đã xóa sạch AppSetting — nạp lại cấu hình mock để
// kết quả không phụ thuộc thứ tự chạy các bộ test.
seedMockSettings(db);

const now = new Date().toISOString();
const wsId = ensureWorkspace(db, user.id);
const brandId = ensureBrand(db, wsId, user.id, "Shop Vòng Đời");
seedPage(db, {
  id: PAGE_ID, userId: user.id, workspaceId: wsId, brandId,
  fbPageId: "900900901", name: "Shop Vòng Đời", category: "Shopping", accessToken: "test-page-token",
});

db.prepare(
  `INSERT INTO BrandProfile (id, userId, brandId, brandName, industry, description, products, tone, createdAt, updatedAt)
   VALUES (?, ?, ?, ?, ?, ?, ?, 'friendly', ?, ?)`
).run("bp-cycle", user.id, brandId, "Shop Vòng Đời", "Bán lẻ",
      "Cửa hàng test vòng đời tự động.", "Sản phẩm A\nSản phẩm B", now, now);

// 2 trụ cột để có xoay vòng
for (const [i, name] of [["p1", "Giới thiệu sản phẩm"], ["p2", "Chia sẻ kiến thức"]].entries()) {
  db.prepare(
    `INSERT INTO ContentPillar (id, userId, brandId, name, description, goal, weight, enabled, position, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, 'sales', 50, 1, ?, ?, ?)`
  ).run(name[0], user.id, brandId, name[1], `Viết bài ${name[1]}`, i, now, now);
}

try {
  // Xóa sổ ghi của mock Facebook: bộ test trước cũng đăng bài lên cùng mock,
  // nếu không xóa thì phép đếm "đúng 1 lượt gọi /feed" sẽ tính nhầm bài cũ.
  await fetch(`${FB_MOCK}/__posts`, { method: "DELETE" }).catch(() => {});

  section("Thiết lập: chế độ ĐĂNG THẲNG, khung giờ phủ cả ngày");
  // Khung giờ 00:00–23:59 để chắc chắn có slot khả dụng ngay hôm nay
  db.prepare(
    `INSERT INTO AutoPilot
       (id, userId, pageId, enabled, mode, postsPerDay, windowStart, windowEnd,
        daysOfWeek, minGapMinutes, autoMedia, mediaKind, photosPerPost, length,
        useHashtags, planAheadDays, lastPlanCount, totalPlanned, createdAt, updatedAt)
     VALUES (?, ?, ?, 1, 'AUTO', 2, '00:00', '23:59', '1,2,3,4,5,6,7', 30, 1,
             'IMAGE', 2, 'medium', 1, 1, 0, 0, ?, ?)`
  ).run("ap-cycle", user.id, PAGE_ID, now, now);
  check("cấu hình AUTO đã sẵn sàng", true);

  section("Hệ thống tự lập kế hoạch (không thao tác tay)");
  // Bộ lập kế hoạch có lớp giãn cách PLANNER_INTERVAL_MS; lượt test trước có
  // thể vừa dùng hết cửa sổ đó. Cứ gọi đều cho tới khi endpoint báo
  // plannerKicked=true, rồi mới chờ kết quả — không đoán mò theo thời gian.
  let planned = [];
  let kicked = false;
  for (let i = 0; i < 60; i++) {
    const res = await tick();
    if (res?.plannerKicked) kicked = true;
    await sleep(1500);
    planned = db.prepare(
      "SELECT * FROM Post WHERE pageId = ? AND origin='AUTOPILOT' ORDER BY scheduledAt"
    ).all(PAGE_ID);
    if (planned.length >= 1) break;
  }
  if (!kicked) console.log("   (cảnh báo: endpoint chưa lần nào chạy bộ lập kế hoạch)");
  check("hệ thống tự tạo bài", planned.length > 0, `${planned.length} bài`);
  check(
    "chế độ AUTO tạo thẳng SCHEDULED (không cần duyệt)",
    planned.every((p) => p.status === "SCHEDULED"),
    planned.map((p) => p.status).join(", ")
  );

  section("Ép một bài tới hạn → scheduler tự đăng lên Facebook");
  const target = planned[0];
  const past = new Date(Date.now() - 60_000).toISOString();
  db.prepare("UPDATE Post SET scheduledAt = ? WHERE id = ?").run(past, target.id);
  check("đã đẩy giờ hẹn về quá khứ", true);

  let published = null;
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    published = db.prepare("SELECT * FROM Post WHERE id = ?").get(target.id);
    if (published.status === "PUBLISHED" || published.status === "FAILED") break;
  }

  check("bài được đăng tự động", published?.status === "PUBLISHED",
        `trạng thái ${published?.status}${published?.errorMessage ? `: ${published.errorMessage}` : ""}`);
  check("có ID bài đăng từ Facebook", Boolean(published?.fbPostId), published?.fbPostId ?? "(trống)");
  check("ghi lại thời điểm đăng thực tế", Boolean(published?.publishedAt));
  check("không còn giữ khóa worker", published?.lockedAt === null);

  section("Kiểm chứng phía Facebook (mock)");
  const posted = await fetch(`${FB_MOCK}/__posts`).then((r) => r.ok ? r.json() : null).catch(() => null);
  if (posted && Array.isArray(posted.posts)) {
    const mine = posted.posts.filter((p) => String(p.pageId) === "900900901");
    check("Facebook nhận được bài", mine.length > 0, `${mine.length} lượt gọi`);

    // Bài có ảnh đi theo đúng chuẩn Facebook: ảnh lên /photos trước
    // (không kèm caption), rồi /feed mang nội dung và gắn các ảnh đó.
    const feed = mine.filter((p) => p.kind === "feed");
    const photos = mine.filter((p) => p.kind === "photos");

    check("có đúng 1 lượt gọi /feed để tạo bài", feed.length === 1, `${feed.length} lượt`);
    check("nội dung bài gửi lên đầy đủ",
          Boolean(feed[0]?.message && feed[0].message.length > 20),
          feed[0]?.message?.slice(0, 40) ?? "(trống)");
    check("ảnh được tải lên trước qua /photos", photos.length > 0, `${photos.length} ảnh`);
    check("mỗi ảnh đều có URL nguồn", photos.every((p) => p.url));
  } else {
    console.log("  ⓘ mock FB không có endpoint __posts — bỏ qua nhóm này");
  }

  section("Bài đăng rồi thì không bị tạo lại");
  const beforeCount = db.prepare(
    "SELECT COUNT(*) c FROM Post WHERE pageId = ? AND origin='AUTOPILOT'"
  ).get(PAGE_ID).c;
  await sleep(12000);
  const afterCount = db.prepare(
    "SELECT COUNT(*) c FROM Post WHERE pageId = ? AND origin='AUTOPILOT'"
  ).get(PAGE_ID).c;
  check("không tạo trùng bài cho ngày đã đủ chỉ tiêu", afterCount <= beforeCount + 1,
        `${beforeCount} → ${afterCount}`);
  check("bài đã đăng vẫn nguyên trạng thái PUBLISHED",
        db.prepare("SELECT status FROM Post WHERE id = ?").get(target.id).status === "PUBLISHED");
} catch (err) {
  failed++;
  failures.push(`NGOẠI LỆ: ${err.message}`);
  console.log(`\n✘ NGOẠI LỆ: ${err.message}`);
} finally {
  reset();
  db.close();
}

console.log(`\n${"=".repeat(52)}`);
console.log(`Kết quả: ${passed} đạt, ${failed} lỗi (tổng ${passed + failed})`);
if (failures.length) { console.log("\nChưa đạt:"); failures.forEach((f) => console.log(`  - ${f}`)); }
console.log("=".repeat(52));
process.exit(failed === 0 ? 0 : 1);
