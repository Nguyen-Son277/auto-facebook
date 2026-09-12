// E2E test Tuần 3 — AI viết nội dung.
// Chạy: node scripts/e2e-composer.mjs
// Cần: dev server (có FB_GRAPH_BASE_URL trỏ về mock), mock-ai-server, mock-fb-server.
import { chromium } from "playwright";
import { openTestDb } from "./lib/test-db.mjs";
import { ensureWorkspace } from "./lib/test-fixtures.mjs";

const BASE = "http://localhost:3000";
const MOCK_AI = "http://127.0.0.1:4010/v1";
const AI_KEY = "test-key-abc123";
const SMOKE_EMAIL = "smoke@test.local";
const PAGE_FB_ID = "111222333444555";

let failures = 0;
function check(name, condition, detail = "") {
  const mark = condition ? "✓ PASS" : "✗ FAIL";
  if (!condition) failures++;
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// ---------- Fixture: một Facebook Page giả để test luồng đăng ----------
const db = openTestDb();
const smoke = db.prepare('SELECT id FROM "User" WHERE email = ?').get(SMOKE_EMAIL);
const wsId = ensureWorkspace(db, smoke.id);
if (!smoke) {
  console.error("✗ Chưa có user smoke — chạy `node scripts/smoke-login.mjs` trước.");
  process.exit(1);
}
db.prepare('DELETE FROM "FacebookPage" WHERE "fbPageId" = ?').run(PAGE_FB_ID);
db.prepare(
  `INSERT INTO "FacebookPage" (id, "userId", "workspaceId", "fbPageId", name, category, "accessToken", "isActive", "createdAt", "updatedAt")
   VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`
).run("e2e-page-1", smoke.id, wsId, PAGE_FB_ID, "Mock Page Kinh Doanh", "Business", "mock-page-token-abc");
console.log("→ Đã tạo Facebook Page giả cho test\n");

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();

try {
  // ================= 1. Đăng nhập =================
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', SMOKE_EMAIL);
  await page.fill('input[name="password"]', "test123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 20000 });
  check("Đăng nhập", page.url().includes("/dashboard"));

  // ================= 2. Cấu hình AI Provider =================
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
  await aiForm.getByRole("button", { name: /Lưu & Kiểm tra kết nối/ }).click();
  await page.getByText(/Kết nối AI thành công/).waitFor({ timeout: 25000 });

  // Pexels key (cần cho Media Picker ở bước đăng nhiều ảnh)
  const pexelsForm = page
    .locator('form:has(input[name="apiKey"]):not(:has(input[name="baseUrl"]))')
    .first();
  await pexelsForm.locator('input[name="apiKey"]').fill("pexels-test-key");
  await pexelsForm.getByRole("button", { name: /Lưu & Kiểm tra kết nối/ }).click();
  await page.getByText(/Kết nối Pexels thành công/).waitFor({ timeout: 20000 });
  check("Cấu hình AI Provider + Pexels xong", true);

  // ================= 3. Trang Soạn bài =================
  await page.goto(`${BASE}/composer`, { waitUntil: "networkidle" });
  check(
    "Composer hiện panel AI viết nội dung",
    (await page.getByText("AI viết nội dung").count()) > 0
  );
  check(
    "Có cảnh báo chưa cấu hình AI? (phải là KHÔNG)",
    (await page.getByText(/Chưa cấu hình AI Provider/).count()) === 0
  );

  const genForm = page.locator('form:has(textarea[name="topic"])');
  const editForm = page.locator('form:has(textarea[name="content"])');

  // ================= 4. Sinh nội dung bằng AI =================
  const TOPIC = "Khai trương cửa hàng trà sữa tại Quận 1, giảm 30% tuần đầu";
  await genForm.locator('textarea[name="topic"]').fill(TOPIC);
  await genForm.locator('select[name="tone"]').selectOption("exciting");
  await genForm.locator('select[name="goal"]').selectOption("sales");
  await genForm.locator('select[name="length"]').selectOption("medium");
  await genForm.locator('input[name="audience"]').fill("sinh viên");
  await genForm.locator('input[name="keywords"]').fill("trà sữa, khai trương");
  await genForm.locator('select[name="variantCount"]').selectOption("3");

  await genForm.getByRole("button", { name: /Sinh nội dung/ }).click();
  await page.getByText(/AI đã viết \d+ phương án/).waitFor({ timeout: 60000 });

  const cards = page.locator("text=/Phương án \\d+ ·/");
  const cardCount = await cards.count();
  check("AI trả về 3 phương án", cardCount === 3, `${cardCount} phương án`);
  check(
    "Hiện model + token đã dùng",
    (await page.getByText(/model: mock-gpt-4o-mini/).count()) > 0
  );
  check(
    "Không mất dữ liệu form AI sau khi sinh",
    (await genForm.locator('textarea[name="topic"]').inputValue()) === TOPIC &&
      (await genForm.locator('input[name="keywords"]').inputValue()) === "trà sữa, khai trương"
  );
  await page.screenshot({ path: "/tmp/w3-1-variants.png", fullPage: true });

  // ================= 5. Chọn phương án số 2 =================
  const variantTexts = await page
    .locator("p.whitespace-pre-wrap")
    .allInnerTexts();
  check("Đọc được nội dung từng phương án", variantTexts.length === 3);

  await page.getByRole("button", { name: /Dùng phương án này/ }).nth(1).click();
  const contentValue = await editForm.locator('textarea[name="content"]').inputValue();
  check(
    "Phương án 2 được đưa vào trình soạn thảo",
    contentValue.includes("phương án 2"),
    `nhận "${contentValue.slice(0, 60)}..."`
  );
  check(
    "Hashtag của phương án cũng được điền",
    (await editForm.locator('input[name="hashtags"]').inputValue()).includes("#phuongan2")
  );
  check(
    "Nút đổi thành 'Đang dùng phương án này'",
    (await page.getByText(/Đang dùng phương án này/).count()) > 0
  );

  // ================= 6. Sửa nội dung + lưu nháp =================
  const EDITED = contentValue + "\n\n(Ghi chú: đã được biên tập lại)";
  await editForm.locator('textarea[name="content"]').fill(EDITED);
  await editForm.getByRole("button", { name: /Lưu nháp/ }).click();
  await page.getByText(/Đã lưu nháp/).waitFor({ timeout: 20000 });

  check(
    "Lưu nháp không làm mất nội dung đang soạn",
    (await editForm.locator('textarea[name="content"]').inputValue()) === EDITED
  );

  await page.waitForTimeout(1200); // chờ revalidate render lại danh sách nháp
  check(
    "Nháp xuất hiện trong danh sách Bản nháp",
    (await page.getByRole("button", { name: /Sửa/ }).count()) > 0
  );
  await page.screenshot({ path: "/tmp/w3-2-draft-saved.png", fullPage: true });

  // ================= 7. Xóa nội dung rồi mở lại nháp =================
  await editForm.locator('textarea[name="content"]').fill("");
  await page.getByRole("button", { name: /Sửa/ }).first().click();
  await page.waitForFunction(
    () => {
      const ta = document.querySelector('textarea[name="content"]');
      return !!ta && ta.value.includes("đã được biên tập lại");
    },
    { timeout: 20000 }
  );
  check("Nút Sửa nạp lại đúng nội dung nháp", true);

  // ================= 8. Đăng bài lên Page (mock Graph API) =================
  await editForm.locator('select[name="pageId"]').selectOption({ label: "Mock Page Kinh Doanh" });
  await editForm.getByRole("button", { name: /Đăng ngay/ }).click();
  await page.getByText(/Đăng bài thành công/).waitFor({ timeout: 30000 });
  check("Đăng bài thành công qua Graph API", true);

  const permalink = page.getByRole("link", { name: /Xem bài trên Facebook/ });
  const href = await permalink.first().getAttribute("href");
  check(
    "Có link bài đăng đúng Page ID giả",
    Boolean(href && href.includes(`${PAGE_FB_ID}/posts/`)),
    href ?? "không có"
  );
  check(
    "Hiện nút 'Soạn bài mới' sau khi đăng",
    (await page.getByRole("button", { name: /Soạn bài mới/ }).count()) > 0
  );
  await page.screenshot({ path: "/tmp/w3-3-published.png", fullPage: true });

  // ================= 9. Bài đã đăng vào lịch sử, nháp được dọn =================
  await page.waitForTimeout(1200);
  check(
    "Lịch sử hiển thị bài đã đăng",
    (await page.getByText("Đã đăng").count()) > 0
  );

  // ================= 10. Nút 'Soạn bài mới' xóa trắng form =================
  await page.getByRole("button", { name: /Soạn bài mới/ }).click();
  check(
    "Nút Soạn bài mới xóa trắng nội dung",
    (await editForm.locator('textarea[name="content"]').inputValue()) === ""
  );

  // ================= 11. Đăng bài có 2 ảnh (multi-photo qua Media Picker) =================
  // (form đã được làm trắng ở bước 10)
  await editForm
    .locator('textarea[name="content"]')
    .fill("Bài test đăng kèm 2 ảnh (multi-photo flow)");
  await page.getByRole("button", { name: /Chọn ảnh\/video từ Pexels/ }).click();
  await page.getByPlaceholder(/Tìm ảnh\/video/).fill("marketing");
  await page.locator('[data-testid="media-search-btn"]').click();
  const tiles = page.locator('[data-testid="media-tile"]');
  await tiles.first().waitFor({ timeout: 20000 });
  await tiles.nth(0).click();
  await tiles.nth(1).click();
  await page.getByRole("button", { name: /Thêm 2 mục vào bài/ }).click();
  await page.waitForTimeout(800);
  check(
    "Chọn 2 ảnh Pexels vào bài",
    (await page.locator('[data-testid="tray-item"]').count()) === 2
  );

  await editForm.locator('select[name="pageId"]').selectOption({ label: "Mock Page Kinh Doanh" });
  await editForm.getByRole("button", { name: /Đăng ngay/ }).click();
  await page.getByText(/Đăng bài thành công/).waitFor({ timeout: 30000 });
  check("Đăng bài kèm 2 ảnh thành công (upload unpublished + feed)", true);
  await page.screenshot({ path: "/tmp/w3-5-multiphoto.png", fullPage: true });

  // ================= 11. Xử lý lỗi: model không tồn tại =================
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  const aiForm2 = page.locator('form:has(input[name="baseUrl"])');
  await aiForm2.locator('input[name="model"]').fill("model-khong-ton-tai");
  await aiForm2.getByRole("button", { name: /^Chỉ lưu$/ }).click();
  await page.getByText(/Đã lưu cấu hình AI Provider/).waitFor({ timeout: 20000 });

  await page.goto(`${BASE}/composer`, { waitUntil: "networkidle" });
  const genForm2 = page.locator('form:has(textarea[name="topic"])');
  await genForm2.locator('textarea[name="topic"]').fill("Bài test lỗi model");
  await genForm2.getByRole("button", { name: /Sinh nội dung/ }).click();
  await page.getByText(/trả về lỗi 404/).waitFor({ timeout: 30000 });
  check("Model lỗi → hiện thông báo lỗi rõ ràng cho người dùng", true);
  check(
    "Lỗi AI không làm mất chủ đề đã nhập",
    (await genForm2.locator('textarea[name="topic"]').inputValue()) === "Bài test lỗi model"
  );
  await page.screenshot({ path: "/tmp/w3-4-ai-error.png", fullPage: true });
} catch (err) {
  failures++;
  console.log("✗ FAIL  Ngoại lệ:", err instanceof Error ? err.message : String(err));
  await page.screenshot({ path: "/tmp/w3-error.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  // Dọn fixture
  db.prepare('DELETE FROM "Media" WHERE "postId" IN (SELECT id FROM "Post" WHERE "userId" = ?)').run(
    smoke.id
  );
  db.prepare('DELETE FROM "Post" WHERE "userId" = ?').run(smoke.id);
  db.prepare('DELETE FROM "FacebookPage" WHERE "fbPageId" = ?').run(PAGE_FB_ID);
  db.prepare('DELETE FROM "AppSetting"').run();
  db.close();
}

console.log(failures === 0 ? "\n🎉 TẤT CẢ TEST ĐỀU PASS" : `\n❌ CÓ ${failures} TEST FAIL`);
process.exit(failures === 0 ? 0 : 1);
