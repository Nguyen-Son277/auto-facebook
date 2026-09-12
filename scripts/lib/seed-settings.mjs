// ============================================================
// Nạp sẵn cài đặt (AI / Pexels) vào test.db.
//
// Vì sao cần: các bộ E2E xóa sạch bảng AppSetting khi chạy xong, nên bộ chạy
// sau có thể thấy database trống và fail vì lý do không liên quan tới thứ nó
// đang kiểm tra. Thứ tự chạy không được quyết định pass/fail.
//
// Giá trị phải mã hóa đúng như app làm (AES-256-GCM, khóa dẫn xuất từ
// SESSION_SECRET), nếu không app sẽ đọc ra rác.
// ============================================================

import fs from "node:fs";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";

const ENC_PREFIX = "enc:v1:";

function masterKey() {
  const env = fs.readFileSync(".env", "utf8");
  const secret =
    process.env.SESSION_SECRET ?? env.match(/^SESSION_SECRET="([^"]*)"/m)?.[1];
  if (!secret || secret.length < 16) {
    throw new Error("Không đọc được SESSION_SECRET từ .env");
  }
  return scryptSync(secret, "fb-marketing-auto:app-settings:v1", 32);
}

function encryptValue(plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return (
    ENC_PREFIX +
    [iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":")
  );
}

const GROUP = {
  "ai.baseUrl": "AI",
  "ai.apiKey": "AI",
  "ai.model": "AI",
  "pexels.apiKey": "PEXELS",
};

/**
 * Ghi các cài đặt cần thiết vào test.db (chỉ ghi đè đúng những key truyền vào).
 *
 * AI/Pexels giờ là tài sản RIÊNG từng user (bảng UserSetting) → key ai./pexels.
 * bắt buộc phải truyền userId. AppSetting chỉ còn Facebook legacy + scheduler.
 *
 * @param db     kết nối trả về từ openTestDb()
 * @param values ví dụ { "pexels.apiKey": "pexels-test-key" }
 * @param userId user nhận các key ai./pexels.
 */
export function seedSettings(db, values, userId = null) {
  const now = new Date().toISOString();
  const appStmt = db.prepare(
    `INSERT INTO "AppSetting" (key, value, "group", createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`
  );
  const userStmt = db.prepare(
    `INSERT INTO "UserSetting" (id, userId, key, value, "group", createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT("userId", key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`
  );
  for (const [key, plain] of Object.entries(values)) {
    if (key.startsWith("ai.") || key.startsWith("pexels.")) {
      if (!userId) throw new Error(`seedSettings: key ${key} cần userId (UserSetting)`);
      userStmt.run(
        `us-seed-${userId}-${key}`,
        userId,
        key,
        encryptValue(String(plain)),
        GROUP[key],
        now,
        now
      );
    } else {
      appStmt.run(key, encryptValue(String(plain)), GROUP[key] ?? "MISC", now, now);
    }
  }
}

/** Bộ cài đặt mock cho MỘT user — trỏ về các mock server dùng trong test. */
export function seedMockSettingsForUser(db, userId) {
  seedSettings(
    db,
    {
      "ai.baseUrl": process.env.AI_BASE_URL ?? "http://127.0.0.1:4010/v1",
      "ai.apiKey": "test-key-abc123",
      // Phải là tên model mock-ai thật sự phục vụ, nếu không provider trả 404
      "ai.model": "mock-gpt-4o",
      "pexels.apiKey": "pexels-test-key",
    },
    userId
  );
}

/** Bộ cài đặt mặc định toàn cục (scheduler) — giữ chữ ký cũ cho test cũ. */
export function seedMockSettings(db) {
  seedSettings(db, { "scheduler.enabled": "true" });
}
