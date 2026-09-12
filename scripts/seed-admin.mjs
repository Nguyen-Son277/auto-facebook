// ============================================================
// Seed tài khoản admin + chuẩn hóa trạng thái user cũ.
//
// Chạy 1 lần (idempotent — chạy lại không lỗi, không đè dữ liệu):
//   npm run db:seed-admin
//
// 1. Tạo admin hệ thống (nếu chưa có) với mật khẩu đã thống nhất.
// 2. Các user có role ADMIN nhưng chưa có status → status = null (kế thừa).
// 3. Các user role USER chưa có status → APPROVED (user cũ dùng bình thường).
// ============================================================

import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "..", process.env.PROD_DB ?? "dev.db");

const ADMIN_EMAIL = "nms2772k2@gmail.com";
const ADMIN_PASSWORD = "Admin@123";

const db = new Database(DB_PATH);
db.pragma("wal_checkpoint(TRUNCATE)");

function main() {
  const cols = db.prepare("PRAGMA table_info(User)").all().map((c) => c.name);
  if (!cols.includes("status")) {
    console.error("✗ DB chưa có cột status — chạy migration user_admin_controls trước.");
    process.exit(1);
  }

  // ---- 1. Tạo admin hệ thống ----
  const existing = db.prepare("SELECT id, role, status FROM User WHERE email = ?").get(ADMIN_EMAIL);
  if (existing) {
    // Đảm bảo role ADMIN + bỏ ràng buộc status
    db.prepare("UPDATE User SET role = 'ADMIN', status = NULL WHERE email = ?").run(ADMIN_EMAIL);
    console.log(`= Admin đã tồn tại, làm mới quyền: ${ADMIN_EMAIL}`);
  } else {
    const hash = bcrypt.hashSync(ADMIN_PASSWORD, 12);
    db.prepare(
      `INSERT INTO User (id, email, name, password, role, status, mustChangePassword, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, 'ADMIN', NULL, 1, datetime('now'), datetime('now'))`
    ).run(`admin-${Date.now().toString(36)}`, ADMIN_EMAIL, "Quản trị viên", hash);
    console.log(`✔ Đã tạo admin: ${ADMIN_EMAIL}`);
    console.log(`  ⚠ MẬT KHẨU MẶC ĐỊNH: ${ADMIN_PASSWORD} — lần đăng nhập đầu sẽ BẮT BUỘC đổi mật khẩu.`);
  }

  // ---- 2. Chuẩn hóa status các user còn lại ----
  // ADMIN mà không phải admin hệ thống → status NULL (kế thừa, luôn được vào)
  const admins = db
    .prepare("SELECT id, email FROM User WHERE role = 'ADMIN' AND email != ? AND status IS NULL")
    .all(ADMIN_EMAIL);
  for (const a of admins) {
    console.log(`= ADMIN kế thừa (giữ nguyên): ${a.email}`);
  }

  // USER chưa có status → APPROVED (user cũ, không bắt đổi mật khẩu)
  const legacy = db
    .prepare("SELECT id, email FROM User WHERE role != 'ADMIN' AND status IS NULL")
    .all();
  for (const u of legacy) {
    db.prepare("UPDATE User SET status = 'APPROVED' WHERE id = ?").run(u.id);
    console.log(`✔ User cũ → APPROVED: ${u.email}`);
  }
  const total = db.prepare("SELECT COUNT(*) c FROM User").get().c;
  console.log(`\nTổng cộng ${total} user trong hệ thống.`);
  db.close();
}

main();
