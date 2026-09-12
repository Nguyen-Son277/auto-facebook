// ============================================================
// Migrate cấu hình AI / Pexels toàn cục (AppSetting) sang user (UserSetting)
//
// Trước đây mọi tài khoản dùng chung key lưu ở AppSetting (+ env). Nay key
// là tài sản RIÊNG từng người dùng. Chạy 1 lần sau khi cập nhật schema:
//
//   npm run db:migrate-settings      (dev.db)
//   DATABASE_URL="file:./test.db" npm run db:migrate-settings
//
// Hành vi:
//  - Đọc ai.baseUrl / ai.apiKey / ai.model / pexels.apiKey từ AppSetting.
//  - Copy (giữ nguyên chuỗi đã mã hóa — cùng master key) vào UserSetting
//    của MỌI user đang tồn tại, chỉ khi user đó chưa tự nhập key.
//  - Xóa các dòng AI/PEXELS khỏi AppSetting.
//  - User tạo SAU này không có gì — phải tự nhập (đúng yêu cầu).
//
// Idempotent: chạy lại không sao chép trùng, không phá dữ liệu.
// ============================================================

import path from "node:path";
import { config as loadEnv } from "dotenv";
import Database from "better-sqlite3";

loadEnv();

const DB_PATH = path.resolve(
  process.env.DATABASE_URL?.replace(/^file:/, "") ?? "./dev.db"
);

const USER_KEYS = {
  "ai.baseUrl": "AI",
  "ai.apiKey": "AI",
  "ai.model": "AI",
  "pexels.apiKey": "PEXELS",
};

console.log(`DB: ${DB_PATH}`);
const db = new Database(DB_PATH);

try {
  const rows = db
    .prepare(
      `SELECT key, value FROM "AppSetting" WHERE key IN ('ai.baseUrl','ai.apiKey','ai.model','pexels.apiKey')`
    )
    .all();
  if (rows.length === 0) {
    console.log("= AppSetting không còn key AI/Pexels nào — nothing to do.");
    process.exit(0);
  }
  console.log(`Key toàn cục tìm thấy: ${rows.map((r) => r.key).join(", ")}`);

  const users = db.prepare(`SELECT id, email FROM "User"`).all();
  console.log(`User hiện có: ${users.length}`);

  const now = new Date().toISOString();
  const findStmt = db.prepare(
    `SELECT id FROM "UserSetting" WHERE userId = ? AND key = ?`
  );
  const insStmt = db.prepare(
    `INSERT INTO "UserSetting" (id, userId, key, value, "group", createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  let copied = 0;
  for (const u of users) {
    for (const r of rows) {
      if (!USER_KEYS[r.key]) continue;
      if (findStmt.get(u.id, r.key)) {
        console.log(`  - ${u.email}: đã tự có ${r.key} — giữ nguyên, không đè`);
        continue;
      }
      insStmt.run(
        `us-mig-${u.id}-${r.key}`,
        u.id,
        r.key,
        r.value, // giữ nguyên ciphertext (cùng master key)
        USER_KEYS[r.key],
        now,
        now
      );
      copied++;
    }
  }

  db.prepare(
    `DELETE FROM "AppSetting" WHERE key IN ('ai.baseUrl','ai.apiKey','ai.model','pexels.apiKey')`
  ).run();

  console.log(`✔ Đã sao chép ${copied} key vào UserSetting, xóa key AI/PEXELS khỏi AppSetting.`);
} finally {
  db.close();
}
