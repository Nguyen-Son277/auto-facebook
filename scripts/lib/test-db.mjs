// Helper dùng chung cho mọi script test: LUÔN mở DB test, KHÔNG BAO GIỜ mở dev.db.
//
// Lý do tồn tại: một lần dọn dữ liệu test chạy nhầm trên dev.db đã xoá mất Page
// thật của người dùng. Từ nay việc đó không thể xảy ra:
//   1. Đường dẫn DB test mặc định là ./test.db, không phải ./dev.db.
//   2. Nếu ai đó trỏ TEST_DB vào dev.db → script từ chối chạy.
//   3. Kể cả khi file DB có chứa user thật → script cũng từ chối chạy.
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

export const SMOKE_EMAIL = "smoke@test.local";

/** DB thật của ứng dụng — tuyệt đối không được ghi vào khi chạy test. */
export const PROD_DB_PATH = path.resolve(process.env.PROD_DB ?? "./dev.db");

/** DB dành riêng cho test. Có thể đổi bằng biến môi trường TEST_DB. */
export const TEST_DB_PATH = path.resolve(process.env.TEST_DB ?? "./test.db");

if (TEST_DB_PATH === PROD_DB_PATH) {
  throw new Error(
    `TỪ CHỐI CHẠY: TEST_DB đang trỏ vào DB thật (${PROD_DB_PATH}).\n` +
      `Test phải dùng file riêng, ví dụ: TEST_DB=./test.db`
  );
}

/**
 * Mở DB test. Từ chối nếu file chứa dữ liệu thật (có user không phải user test),
 * để một lần cấu hình sai cũng không thể phá dữ liệu người dùng.
 */
export function openTestDb() {
  if (!fs.existsSync(TEST_DB_PATH)) {
    throw new Error(
      `Chưa có DB test tại ${TEST_DB_PATH}.\n` +
        `Tạo trước bằng: npm run test:db:prepare`
    );
  }

  const db = new Database(TEST_DB_PATH);
  db.pragma("busy_timeout = 5000");

  // Chặn cứng: DB test không được chứa user thật
  let users = [];
  try {
    users = db.prepare('SELECT email FROM "User"').all();
  } catch {
    throw new Error(
      `${TEST_DB_PATH} chưa có bảng — chạy "npm run test:db:prepare" để tạo schema.`
    );
  }

  const strangers = users.filter((u) => u.email !== SMOKE_EMAIL);
  if (strangers.length > 0) {
    db.close();
    throw new Error(
      `TỪ CHỐI CHẠY: ${TEST_DB_PATH} chứa user thật ` +
        `(${strangers.map((u) => u.email).join(", ")}).\n` +
        `Đây có vẻ là DB thật. Hãy xoá file này rồi chạy "npm run test:db:prepare".`
    );
  }

  return db;
}

/** Lấy user test, báo lỗi rõ ràng nếu chưa chạy smoke-login. */
export function requireSmokeUser(db) {
  const smoke = db.prepare('SELECT id FROM "User" WHERE email = ?').get(SMOKE_EMAIL);
  if (!smoke) {
    throw new Error(
      `Chưa có user test trong ${TEST_DB_PATH}. Chạy trước: node scripts/smoke-login.mjs`
    );
  }
  return smoke;
}
