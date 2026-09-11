// Khôi phục cấu hình Facebook + danh sách Page từ Facebook Graph API.
//
// Bối cảnh: dữ liệu test đã ghi đè bảng AppSetting và xoá Page thật trong dev.db.
// Script này dựng lại đúng những gì app cần, theo cùng cách app lưu (mã hóa
// AES-256-GCM giống src/lib/settings.ts, upsert Page giống syncPagesToDb).
//
// Chạy: RECOVERED_USER_TOKEN="EAA..." node scripts/restore-from-facebook.mjs
import fs from "node:fs";
import Database from "better-sqlite3";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";

const GRAPH = process.env.FB_GRAPH_BASE_URL ?? "https://graph.facebook.com";
const VERSION = process.env.FB_GRAPH_VERSION ?? "v25.0";
const EMAIL = process.env.RESTORE_USER_EMAIL ?? "thehung020630@gmail.com";

const userToken = process.env.RECOVERED_USER_TOKEN;
if (!userToken) {
  console.error("Thiếu RECOVERED_USER_TOKEN. Ví dụ:");
  console.error('  RECOVERED_USER_TOKEN="EAA..." node scripts/restore-from-facebook.mjs');
  process.exit(1);
}

// ---- Mã hóa giống hệt src/lib/settings.ts ----
const secret = fs.readFileSync(".env", "utf8").match(/^SESSION_SECRET="([^"]*)"/m)?.[1];
if (!secret || secret.length < 16) throw new Error("SESSION_SECRET không hợp lệ trong .env");
const masterKey = scryptSync(secret, "fb-marketing-auto:app-settings:v1", 32);

function encryptValue(plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return (
    "enc:v1:" +
    [iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":")
  );
}

const db = new Database("./dev.db");
const user = db.prepare('SELECT id, email FROM "User" WHERE email = ?').get(EMAIL);
if (!user) {
  console.error(`Không tìm thấy user ${EMAIL} trong dev.db`);
  process.exit(1);
}
console.log(`User: ${user.email} (${user.id})`);

// ---- 1. Gọi Facebook lấy thông tin ----
async function graph(path, params = {}) {
  const url = new URL(`${GRAPH}/${VERSION}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", userToken);
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Graph ${path} lỗi: ${JSON.stringify(data.error ?? data).slice(0, 200)}`);
  }
  return data;
}

console.log("\nĐang gọi Facebook…");
const me = await graph("/me", { fields: "id,name" });
console.log(`  Token hợp lệ — user: ${me.name} (${me.id})`);

const accounts = await graph("/me/accounts", {
  fields: "id,name,category,access_token,tasks,picture",
  limit: "100",
});
const pages = accounts.data ?? [];
console.log(`  Tìm thấy ${pages.length} Page`);

// ---- 2. Ghi cấu hình Facebook vào AppSetting ----
const settings = {
  "facebook.userToken": userToken,
  "facebook.graphVersion": VERSION,
};
if (process.env.RECOVERED_TOKEN_EXPIRES_AT) {
  settings["facebook.userTokenExpiresAt"] = process.env.RECOVERED_TOKEN_EXPIRES_AT;
}

// Bảng AppSetting có thể có cột userId/group tuỳ phiên bản schema — kiểm tra trước
const cols = db.prepare('PRAGMA table_info("AppSetting")').all().map((c) => c.name);
console.log(`\nCột AppSetting: ${cols.join(", ")}`);

const hasGroup = cols.includes("group");
const hasUserId = cols.includes("userId");

const insertCols = ['key', 'value'];
const insertMarks = ["?", "?"];
if (hasGroup) {
  insertCols.push('"group"');
  insertMarks.push("?");
}
if (hasUserId) {
  insertCols.push('"userId"');
  insertMarks.push("?");
}
insertCols.push('"createdAt"', '"updatedAt"');
insertMarks.push("datetime('now')", "datetime('now')");

const upsertSetting = db.prepare(
  `INSERT INTO "AppSetting" (${insertCols.join(", ")})
   VALUES (${insertMarks.join(", ")})
   ON CONFLICT(key) DO UPDATE SET value = excluded.value`
);

for (const [key, value] of Object.entries(settings)) {
  const group = key.startsWith("facebook.")
    ? "FACEBOOK"
    : key.startsWith("ai.")
      ? "AI"
      : key.startsWith("pexels.")
        ? "PEXELS"
        : "MISC";
  const args = [key, encryptValue(value)];
  if (hasGroup) args.push(group);
  if (hasUserId) args.push(user.id);
  upsertSetting.run(...args);

  const shown = key.includes("Token") ? value.slice(0, 18) + "…" : value;
  console.log(`  ✔ ${key} = ${shown}`);
}

// ---- 3. Ghi Page vào DB (giống syncPagesToDb) ----
const upsertPage = db.prepare(
  `INSERT INTO "FacebookPage"
     (id, "userId", "fbPageId", name, category, "avatarUrl", "accessToken", "tokenExpiresAt", "isActive", "createdAt", "updatedAt")
   VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, datetime('now'), datetime('now'))
   ON CONFLICT("fbPageId") DO UPDATE SET
     "userId" = excluded."userId",
     name = excluded.name,
     category = excluded.category,
     "avatarUrl" = excluded."avatarUrl",
     "accessToken" = excluded."accessToken",
     "isActive" = 1,
     "updatedAt" = datetime('now')`
);

console.log("\nKhôi phục Page:");
for (const p of pages) {
  // Giữ lại id cũ nếu Page đã từng có trong DB, tránh đổi id làm mồ côi bài viết
  const existing = db
    .prepare('SELECT id FROM "FacebookPage" WHERE "fbPageId" = ?')
    .get(p.id);
  const id = existing?.id ?? process.env.RECOVERED_PAGE_ID ?? `page_${p.id}`;

  upsertPage.run(
    id,
    user.id,
    p.id,
    p.name,
    p.category ?? null,
    p.picture?.data?.url ?? null,
    p.access_token
  );
  console.log(`  ✔ ${p.name} (${p.id}) — token ${p.access_token.length} ký tự`);
}

// ---- 4. Kiểm tra lại ----
console.log("\nKiểm tra sau khi khôi phục:");
for (const t of ["User", "FacebookPage", "Post", "Media"]) {
  console.log(`  ${t}: ${db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c}`);
}
console.log(
  "  Trang FB:",
  JSON.stringify(
    db.prepare('SELECT name, "fbPageId", "isActive" FROM "FacebookPage"').all()
  )
);
db.close();
console.log("\nXong. Mở lại app để kiểm tra.");
