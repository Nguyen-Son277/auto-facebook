// E2E test Tuần 4 — Tích hợp Pexels (tìm ảnh/video, thư viện, đính kèm, gợi ý từ khóa AI).
// Chạy: node scripts/e2e-media.mjs
// Cần dev server với PEXELS_BASE_URL + FB_GRAPH_BASE_URL trỏ về mock, và 3 mock server.
import { chromium } from "playwright";
import { openTestDb } from "./lib/test-db.mjs";
import { ensureWorkspace } from "./lib/test-fixtures.mjs";

const BASE = "http://localhost:3000";
const MOCK_AI = "http://127.0.0.1:4010/v1";
const AI_KEY = "test-key-abc123";
const PEXELS_KEY = "pexels-test-key";
const SMOKE_EMAIL = "smoke@test.local";
const PAGE_FB_ID = "111222333444555";

let failures = 0;
function check(name, condition, detail = "") {
  const mark = condition ? "✓ PASS" : "✗ FAIL";
  if (!condition) failures++;
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ""}`);
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
console.log("→ Đã reset fixture: 1 Facebook Page giả, xoá media/post/settings cũ\n");

/** Chờ tới khi truy vấn DB trả về giá trị "thật" (tránh đọc sớm khi UI còn thông báo cũ). */
async function waitForDb(fn, timeoutMs = 20000, label = "DB") {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Hết thời gian chờ ${label} (giá trị cuối: ${JSON.stringify(last)})`);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();

const tile = () => page.locator('[data-testid="media-tile"]');
const selectedSummary = () => page.locator('[data-testid="selected-summary"]').first();

async function login() {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', SMOKE_EMAIL);
  await page.fill('input[name="password"]', "test123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 20000 });
}

async function configureIntegrations() {
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });

  const aiForm = page.locator('form:has(input[name="baseUrl"])');
  await aiForm.locator('input[name="baseUrl"]').fill(MOCK_AI);
  await aiForm.locator('input[name="apiKey"]').fill(AI_KEY);
  await aiForm.getByRole("button", { name: /Tải danh sách model/ }).click();
  await aiForm.locator("#ai-model-options option").first().waitFor({ state: "attached", timeout: 20000 });
  await aiForm.locator('input[name="model"]').fill("mock-gpt-4o-mini");
  await aiForm.getByRole("button", { name: /^Chỉ lưu$/ }).click();
  await page.getByText(/Đã lưu cấu hình AI Provider/).waitFor({ timeout: 20000 });

  // Form Pexels = form có input apiKey nhưng KHÔNG có baseUrl (form AI có baseUrl)
  const pexelsForm = page
    .locator('form:has(input[name="apiKey"]):not(:has(input[name="baseUrl"]))')
    .first();
  await pexelsForm.locator('input[name="apiKey"]').fill(PEXELS_KEY);
  await pexelsForm.getByRole("button", { name: /Lưu & Kiểm tra kết nối/ }).click();
  await page.getByText(/Kết nối Pexels thành công/).waitFor({ timeout: 20000 });
}

try {
  // ================= 1. Đăng nhập + cấu hình =================
  await login();
  check("Đăng nhập", page.url().includes("/dashboard"));
  await configureIntegrations();
  check("Cấu hình AI + Pexels xong", true);

  // ================= 2. Trang Thư viện Media =================
  await page.goto(`${BASE}/media`, { waitUntil: "networkidle" });
  check(
    "Trang /media hiện khu tìm kiếm Pexels (không còn placeholder Tuần 4)",
    (await page.getByText("Tìm trên Pexels").count()) > 0 &&
      (await page.getByText(/Sắp ra mắt ở Tuần 4/).count()) === 0
  );

  await tile().first().waitFor({ timeout: 20000 });
  const curatedCount = await tile().count();
  check("Ảnh phổ biến tải sẵn từ server khi mở trang", curatedCount === 12, `${curatedCount} ảnh`);
  check("Hiện tên tác giả (ghi công nguồn Pexels)", (await page.getByText(/Tác giả/).count()) > 0);
  await page.screenshot({ path: "/tmp/w4-1-media-curated.png", fullPage: true });

  // ================= 3. Tìm kiếm theo từ khóa =================
  const searchInput = page.getByPlaceholder(/Tìm ảnh\/video/);
  await searchInput.fill("milk tea");
  await page.locator('[data-testid="media-search-btn"]').click();
  await page.getByText(/42 kết quả cho "milk tea"/).waitFor({ timeout: 20000 });
  check("Tìm theo từ khóa trả kết quả", (await tile().count()) === 12);

  // ================= 4. Phân trang =================
  await page.getByRole("button", { name: /Trang sau/ }).click();
  await page.getByText("Trang 2").first().waitFor({ timeout: 20000 });
  check("Phân trang hoạt động", true);
  await page.getByRole("button", { name: /Trang trước/ }).click();
  await page.getByText("Trang 1").first().waitFor({ timeout: 20000 });

  // ================= 5. Từ khóa không có kết quả =================
  await searchInput.fill("khong-co-ket-qua");
  await page.locator('[data-testid="media-search-btn"]').click();
  await page.getByText(/Không tìm thấy ảnh nào cho/).waitFor({ timeout: 20000 });
  check("Hiện thông báo khi không có kết quả", true);

  // ================= 6. Tab Video =================
  await searchInput.fill("coffee");
  await page.locator('[data-testid="media-tab-VIDEO"]').click();
  await page.locator('[data-media-type="VIDEO"]').first().waitFor({ timeout: 20000 });
  check("Chuyển sang tab Video trả về video", (await page.locator('[data-media-type="VIDEO"]').count()) === 12);
  check("Video hiện thời lượng", (await page.getByText(/▶ \d+:\d\d/).count()) > 0);
  await page.screenshot({ path: "/tmp/w4-2-videos.png", fullPage: true });

  // Quay lại Ảnh
  await page.locator('[data-testid="media-tab-IMAGE"]').click();
  await page.locator('[data-media-type="IMAGE"]').first().waitFor({ timeout: 20000 });

  // ================= 7. Lưu vào thư viện =================
  await tile().nth(0).click();
  await tile().nth(1).click();
  check(
    "Chọn được 2 ảnh",
    (await selectedSummary().innerText()).includes("Đã chọn 2 mục"),
    await selectedSummary().innerText()
  );
  await page.getByRole("button", { name: /Lưu 2 mục vào thư viện/ }).click();
  await page.getByText(/Đã lưu 2 mục vào thư viện/).waitFor({ timeout: 30000 });
  check("Lưu 2 ảnh vào thư viện thành công", true);

  const savedCount = db
    .prepare('SELECT COUNT(*) c FROM "Media" WHERE "userId" = ? AND "postId" IS NULL')
    .get(smoke.id).c;
  check("DB ghi đúng 2 media thư viện", savedCount === 2, `${savedCount} bản ghi`);
  const meta = db
    .prepare('SELECT "providerId", photographer, "sourcePageUrl", "previewUrl" FROM "Media" WHERE "userId" = ? LIMIT 1')
    .get(smoke.id);
  check(
    "Lưu kèm metadata Pexels (id, tác giả, trang nguồn, preview)",
    Boolean(meta.providerId && meta.photographer && meta.sourcePageUrl && meta.previewUrl),
    JSON.stringify(meta).slice(0, 120)
  );

  // ================= 8. Tab thư viện =================
  await page.goto(`${BASE}/media`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Thư viện của tôi/ }).click();
  await page.getByRole("button", { name: /^Tất cả \(2\)/ }).waitFor({ timeout: 20000 });
  check("Tab thư viện hiện 2 mục đã lưu", true);
  check(
    "Bộ lọc Ảnh/Video đúng số lượng",
    (await page.getByRole("button", { name: /^Ảnh \(2\)/ }).count()) > 0 &&
      (await page.getByRole("button", { name: /^Video \(0\)/ }).count()) > 0
  );
  await page.screenshot({ path: "/tmp/w4-3-library.png", fullPage: true });

  // ================= 9. Xóa khỏi thư viện =================
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /^Xóa$/ }).first().click();
  await page.waitForTimeout(2000);
  const afterDelete = db
    .prepare('SELECT COUNT(*) c FROM "Media" WHERE "userId" = ? AND "postId" IS NULL')
    .get(smoke.id).c;
  check("Xóa media khỏi thư viện", afterDelete === 1, `còn ${afterDelete} bản ghi`);
  await page.goto(`${BASE}/media`, { waitUntil: "networkidle" });

  // ================= 10. Composer: AI sinh nội dung =================
  await page.goto(`${BASE}/composer`, { waitUntil: "networkidle" });
  const genForm = page.locator('form:has(textarea[name="topic"])');
  await genForm.locator('textarea[name="topic"]').fill("Khai trương quán cà phê mới tại Quận 3");
  await genForm.getByRole("button", { name: /Sinh nội dung/ }).click();
  await page.getByText(/AI đã viết \d+ phương án/).waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: /Dùng phương án này/ }).first().click();
  const editForm = page.locator('form:has(textarea[name="content"])');
  check(
    "Đã có nội dung trong trình soạn thảo",
    (await editForm.locator('textarea[name="content"]').inputValue()).length > 20
  );

  // ================= 11. Mở Media Picker trong Composer =================
  await page.getByRole("button", { name: /Chọn ảnh\/video từ Pexels/ }).click();
  await page.getByText("Chọn ảnh/video từ Pexels").nth(1).waitFor({ timeout: 20000 });
  check(
    "Modal picker mở với hướng dẫn khi chưa tìm",
    (await page.getByText(/Nhập từ khóa rồi bấm/).count()) > 0
  );

  // ================= 12. AI gợi ý từ khóa =================
  await page.locator('[data-testid="ai-keyword-btn"]').click();
  await page.locator('[data-testid="keyword-suggestion"]').first().waitFor({ timeout: 60000 });
  const kwCount = await page.locator('[data-testid="keyword-suggestion"]').count();
  check("AI gợi ý được từ khóa tìm ảnh", kwCount > 0, `${kwCount} từ khóa`);
  check(
    "Từ khóa hiện cả nhãn tiếng Việt và query tiếng Anh",
    (await page.locator('[data-testid="keyword-suggestion"]').first().innerText()).includes("·")
  );
  await page.screenshot({ path: "/tmp/w4-4-keywords.png", fullPage: true });

  // Bấm 1 từ khóa → tự tìm
  await page.locator('[data-testid="keyword-suggestion"]').first().click();
  await tile().first().waitFor({ timeout: 20000 });
  check("Bấm từ khóa AI gợi ý → tự động tìm ảnh", (await tile().count()) > 0);

  // ================= 13. Đính kèm 2 ảnh vào bài =================
  await tile().nth(0).click();
  await tile().nth(1).click();
  await page.getByRole("button", { name: /Thêm 2 mục vào bài/ }).click();
  await page.waitForTimeout(1000);
  const trayCount = await page.locator('[data-testid="tray-item"]').count();
  check("2 ảnh được đưa vào khay đính kèm", trayCount === 2, `${trayCount} mục`);
  await page.screenshot({ path: "/tmp/w4-5-tray.png", fullPage: true });

  // ================= 14. Chặn trộn ảnh + video =================
  await page.getByRole("button", { name: /Chọn ảnh\/video từ Pexels/ }).click();
  await page.locator('[data-testid="media-tab-VIDEO"]').click();
  await page.locator('[data-media-type="VIDEO"]').first().waitFor({ timeout: 20000 });
  await page.locator('[data-media-type="VIDEO"]').first().click();
  await page.locator('[data-testid="media-notice"]').waitFor({ timeout: 10000 });
  check(
    "Chặn chọn video khi đã có ảnh (Facebook không cho trộn)",
    (await page.locator('[data-testid="media-notice"]').innerText()).includes("trộn"),
    await page.locator('[data-testid="media-notice"]').innerText()
  );
  await page.screenshot({ path: "/tmp/w4-6-mix-blocked.png", fullPage: true });
  await page.getByRole("button", { name: /^Đóng$/ }).click();

  // ================= 15. Đăng bài kèm 2 ảnh Pexels =================
  await editForm.locator('select[name="pageId"]').selectOption({ label: "Mock Page Kinh Doanh" });
  await editForm.getByRole("button", { name: /Đăng ngay/ }).click();
  await page.getByText(/Đăng bài thành công/).waitFor({ timeout: 30000 });
  check("Đăng bài kèm 2 ảnh Pexels thành công", true);

  const postMedia = db
    .prepare(
      'SELECT COUNT(*) c FROM "Media" WHERE "userId" = ? AND type = ? AND "postId" IS NOT NULL'
    )
    .get(smoke.id, "IMAGE").c;
  check("Bài đăng lưu đúng 2 media kèm metadata", postMedia === 2, `${postMedia} media`);
  await page.screenshot({ path: "/tmp/w4-7-published.png", fullPage: true });

  // ================= 16. Đăng bài kèm 1 video =================
  await page.getByRole("button", { name: /Soạn bài mới/ }).click();
  await page
    .getByText(/Đăng bài thành công/)
    .waitFor({ state: "hidden", timeout: 10000 });
  check("Nút Soạn bài mới ẩn thông báo đăng thành công cũ", true);
  await editForm.locator('textarea[name="content"]').fill("Bài test đăng kèm video từ Pexels");
  await page.getByRole("button", { name: /Chọn ảnh\/video từ Pexels/ }).click();
  await page.locator('[data-testid="media-tab-VIDEO"]').click();
  await page.locator('[data-media-type="VIDEO"]').first().waitFor({ timeout: 20000 });
  await page.locator('[data-media-type="VIDEO"]').first().click();
  await page.getByRole("button", { name: /Thêm 1 mục vào bài/ }).click();
  await page.waitForTimeout(1000);
  check(
    "Video được đưa vào khay đính kèm",
    (await page.locator('[data-testid="tray-item"]').count()) === 1
  );
  await editForm.locator('select[name="pageId"]').selectOption({ label: "Mock Page Kinh Doanh" });
  await editForm.getByRole("button", { name: /Đăng ngay/ }).click();
  await page.getByText(/Đăng bài thành công/).waitFor({ timeout: 30000 });
  await waitForDb(
    () =>
      db
        .prepare(
          'SELECT id FROM "Post" WHERE "userId" = ? AND status = ? AND content LIKE ?'
        )
        .get(smoke.id, "PUBLISHED", "%video từ Pexels%"),
    30000,
    "bài video PUBLISHED"
  );
  const videoRow = db
    .prepare(
      'SELECT "remoteUrl" FROM "Media" WHERE "userId" = ? AND type = ? ORDER BY "createdAt" DESC, rowid DESC LIMIT 1'
    )
    .get(smoke.id, "VIDEO");
  check("Đăng bài kèm video thành công", Boolean(videoRow));
  check(
    "Chọn đúng bản video HD (không phải 4K nặng)",
    Boolean(videoRow && videoRow.remoteUrl.endsWith("-hd.mp4")),
    videoRow?.remoteUrl ?? "không có"
  );
  await page.screenshot({ path: "/tmp/w4-8-video-published.png", fullPage: true });

  // ================= 17. Lưu nháp giữ media =================
  await page.getByRole("button", { name: /Soạn bài mới/ }).click();
  await editForm.locator('textarea[name="content"]').fill("Nháp có kèm ảnh Pexels");
  await page.getByRole("button", { name: /Chọn ảnh\/video từ Pexels/ }).click();
  await page.getByPlaceholder(/Tìm ảnh\/video/).fill("office desk");
  await page.locator('[data-testid="media-search-btn"]').click();
  await tile().first().waitFor({ timeout: 20000 });
  await tile().nth(2).click();
  await page.getByRole("button", { name: /Thêm 1 mục vào bài/ }).click();
  await page.waitForTimeout(800);
  await editForm.getByRole("button", { name: /Lưu nháp/ }).click();
  await page.getByText(/Đã lưu nháp/).waitFor({ timeout: 20000 });
  check("Lưu nháp thành công", true);

  await page.waitForTimeout(1500);
  await editForm.locator('textarea[name="content"]').fill("");
  await page.getByRole("button", { name: /Sửa/ }).first().click();
  await page.waitForFunction(
    () => {
      const ta = document.querySelector('textarea[name="content"]');
      return !!ta && ta.value.includes("Nháp có kèm ảnh Pexels");
    },
    { timeout: 20000 }
  );
  check(
    "Mở lại nháp khôi phục cả media đã đính kèm",
    (await page.locator('[data-testid="tray-item"]').count()) === 1,
    `${await page.locator('[data-testid="tray-item"]').count()} mục`
  );

  // ================= 18. Trang /media không còn placeholder =================
  check(
    "Placeholder Tuần 4 đã bị xóa khỏi /media",
    (await page.getByText(/Sắp ra mắt ở Tuần 4/).count()) === 0
  );
} catch (err) {
  failures++;
  console.log("✗ FAIL  Ngoại lệ:", err instanceof Error ? err.message : String(err));
  await page.screenshot({ path: "/tmp/w4-error.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  db.prepare('DELETE FROM "Media" WHERE "userId" = ?').run(smoke.id);
  db.prepare('DELETE FROM "Post" WHERE "userId" = ?').run(smoke.id);
  db.prepare('DELETE FROM "FacebookPage" WHERE "fbPageId" = ?').run(PAGE_FB_ID);
  db.prepare('DELETE FROM "AppSetting"').run();
  db.close();
}

console.log(failures === 0 ? "\n🎉 TẤT CẢ TEST ĐỀU PASS" : `\n❌ CÓ ${failures} TEST FAIL`);
process.exit(failures === 0 ? 0 : 1);
