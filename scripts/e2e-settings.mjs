// E2E test: kiểm tra form AI giữ nguyên Base URL + API Key sau khi tải model.
// Chạy: node scripts/e2e-settings.mjs
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const MOCK = "http://127.0.0.1:4010/v1";
const KEY = "test-key-abc123";

let failures = 0;
function check(name, condition, detail = "") {
  const mark = condition ? "✓ PASS" : "✗ FAIL";
  if (!condition) failures++;
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
page.on("console", (m) => {
  if (m.type() === "error") console.log("   [browser error]", m.text().slice(0, 200));
});

try {
  // ---------- 1. Đăng nhập ----------
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', "smoke@test.local");
  await page.fill('input[name="password"]', "test123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 20000 });
  check("Đăng nhập thành công", page.url().includes("/dashboard"));

  // ---------- 2. Vào trang Cài đặt ----------
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  check("Mở trang Cài đặt", page.url().includes("/settings"));

  // Scope mọi thao tác trong form AI (trang có 3 form, nút trùng tên nhau)
  const aiForm = page.locator('form:has(input[name="baseUrl"])');
  const baseUrlInput = aiForm.locator('input[name="baseUrl"]');
  const apiKeyInput = aiForm.locator('input[name="apiKey"]');
  const modelInput = aiForm.locator('input[name="model"]');

  // ---------- 3. Nhập Base URL + API Key rồi bấm Tải danh sách model ----------
  await baseUrlInput.fill(MOCK);
  await apiKeyInput.fill(KEY);
  check(
    "Đã nhập Base URL + API Key",
    (await baseUrlInput.inputValue()) === MOCK && (await apiKeyInput.inputValue()) === KEY
  );

  await aiForm.getByRole("button", { name: /Tải danh sách model/ }).click();

  // Chờ server action trả về (thông báo tải model thành công)
  await page
    .getByText(/Đã tải \d+ model từ provider|Danh sách model đã sẵn sàng/)
    .first()
    .waitFor({ timeout: 20000 });

  const baseUrlAfter = await baseUrlInput.inputValue();
  const apiKeyAfter = await apiKeyInput.inputValue();
  const options = await aiForm.locator("#ai-model-options option").count();

  console.log(`   → Base URL sau khi tải: "${baseUrlAfter}"`);
  console.log(`   → API Key sau khi tải: "${apiKeyAfter}" (dài ${apiKeyAfter.length})`);
  console.log(`   → Số model tải về: ${options}`);

  // ===== ĐÂY LÀ LỖI NGƯỜI DÙNG BÁO: giá trị phải được giữ nguyên =====
  check("Base URL KHÔNG bị mất sau khi tải model", baseUrlAfter === MOCK, `nhận "${baseUrlAfter}"`);
  check("API Key KHÔNG bị mất sau khi tải model", apiKeyAfter === KEY, `nhận "${apiKeyAfter}"`);
  check("Danh sách model đã được tải về", options > 0, `${options} model`);

  await page.screenshot({ path: "/tmp/e2e-1-after-load.png", fullPage: true });

  // ---------- 4. Chọn model rồi lưu ----------
  await modelInput.fill("mock-deepseek-chat");
  await aiForm.getByRole("button", { name: /^Chỉ lưu$/ }).click();
  await page.getByText("Đã lưu cấu hình AI Provider.").waitFor({ timeout: 20000 });

  const baseUrlAfterSave = await baseUrlInput.inputValue();
  const modelAfterSave = await modelInput.inputValue();
  check("Base URL giữ nguyên sau khi lưu", baseUrlAfterSave === MOCK, `nhận "${baseUrlAfterSave}"`);
  check("Model giữ nguyên sau khi lưu", modelAfterSave === "mock-deepseek-chat", `nhận "${modelAfterSave}"`);
  check(
    "Hiện badge Đã cấu hình",
    (await page.getByText("Đã cấu hình").count()) > 0
  );
  await page.screenshot({ path: "/tmp/e2e-2-after-save.png", fullPage: true });

  // ---------- 5. Tải lại trang: model phải tự tải sẵn từ server ----------
  await page.reload({ waitUntil: "networkidle" });
  const aiFormReloaded = page.locator('form:has(input[name="baseUrl"])');
  const optionsAfterReload = await aiFormReloaded.locator("#ai-model-options option").count();
  const modelAfterReload = await aiFormReloaded.locator('input[name="model"]').inputValue();
  check("Sau reload, model tự tải sẵn (SSR)", optionsAfterReload > 0, `${optionsAfterReload} model`);
  check(
    "Sau reload, model đã lưu được điền sẵn",
    modelAfterReload === "mock-deepseek-chat",
    `nhận "${modelAfterReload}"`
  );
  check(
    "Sau reload, Base URL đã lưu được điền sẵn",
    (await aiFormReloaded.locator('input[name="baseUrl"]').inputValue()) === MOCK
  );

  // ---------- 6. Trường hợp API Key sai: phải báo lỗi VÀ giữ nguyên giá trị ----------
  await page.locator('input[name="baseUrl"]').fill(MOCK);
  await page.locator('input[name="apiKey"]').first().fill("sai-key-hoan-toan");
  await aiForm.getByRole("button", { name: /Tải danh sách model/ }).click();
  await page.getByText(/Provider trả về 401/).waitFor({ timeout: 20000 });

  check(
    "Key sai → hiện lỗi 401",
    (await page.getByText(/Provider trả về 401/).count()) > 0
  );
  check(
    "Key sai → Base URL vẫn giữ nguyên",
    (await aiFormReloaded.locator('input[name="baseUrl"]').inputValue()) === MOCK
  );
  check(
    "Key sai → API Key vẫn giữ nguyên",
    (await page.locator('input[name="apiKey"]').first().inputValue()) === "sai-key-hoan-toan"
  );
  await page.screenshot({ path: "/tmp/e2e-3-bad-key.png", fullPage: true });

  // ---------- 7. Kiểm tra kết nối thật với model đã chọn ----------
  const aiFormOk = page.locator('form:has(input[name="baseUrl"])');
  await aiFormOk.locator('input[name="apiKey"]').fill(KEY);
  await aiFormOk.locator('input[name="model"]').fill("mock-gpt-4o-mini");
  await aiFormOk.getByRole("button", { name: /Lưu & Kiểm tra kết nối/ }).click();
  await page.getByText(/Kết nối AI thành công/).waitFor({ timeout: 25000 });
  const pingDetail = await page.getByText(/Model phản hồi/).count();
  check("Kiểm tra kết nối: model phản hồi thật", pingDetail > 0);
  await page.screenshot({ path: "/tmp/e2e-4-test-ok.png", fullPage: true });
} catch (err) {
  failures++;
  console.log("✗ FAIL  Ngoại lệ:", err instanceof Error ? err.message : String(err));
  await page.screenshot({ path: "/tmp/e2e-error.png", fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\n🎉 TẤT CẢ TEST ĐỀU PASS" : `\n❌ CÓ ${failures} TEST FAIL`);
process.exit(failures === 0 ? 0 : 1);
