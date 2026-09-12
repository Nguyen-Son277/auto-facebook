// ============================================================
// Seed tài khoản admin + chuẩn hóa trạng thái user cũ.
//
// Chạy 1 lần (idempotent — chạy lại không lỗi, không đè dữ liệu):
//   npm run db:seed-admin
//
// 1. Tạo admin hệ thống (nếu chưa có) với mật khẩu lấy từ ADMIN_PASSWORD.
// 2. Các user role USER chưa có status → APPROVED (user cũ dùng bình thường).
//
// Dùng PostgreSQL (Supabase) qua DIRECT_URL/DATABASE_URL.
// ============================================================

import "dotenv/config";
import bcrypt from "bcryptjs";
import pg from "pg";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "nms2772k2@gmail.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "Admin@123";
const ADMIN_NAME = process.env.ADMIN_NAME ?? "Quản trị viên";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error("✗ Thiếu DIRECT_URL/DATABASE_URL — kiểm tra file .env");
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();

  // ---- 1. Tạo admin hệ thống ----
  const existing = await client.query(
    'SELECT id, role, status FROM "User" WHERE email = $1',
    [ADMIN_EMAIL]
  );

  if (existing.rowCount > 0) {
    await client.query(
      'UPDATE "User" SET role = \'ADMIN\', status = NULL, "updatedAt" = now() WHERE email = $1',
      [ADMIN_EMAIL]
    );
    console.log(`= Admin đã tồn tại, làm mới quyền: ${ADMIN_EMAIL}`);
  } else {
    const hash = bcrypt.hashSync(ADMIN_PASSWORD, 12);
    const id = `admin-${Date.now().toString(36)}`;
    await client.query(
      `INSERT INTO "User" (id, email, name, password, role, status, "mustChangePassword", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'ADMIN', NULL, true, now(), now())`,
      [id, ADMIN_EMAIL, ADMIN_NAME, hash]
    );
    console.log(`✔ Đã tạo admin: ${ADMIN_EMAIL}`);
    console.log(
      `  ⚠ MẬT KHẨU: ${ADMIN_PASSWORD} — lần đăng nhập đầu sẽ BẮT BUỘC đổi mật khẩu.`
    );
  }

  // ---- 2. Chuẩn hóa status các user cũ ----
  const legacy = await client.query(
    `SELECT id, email FROM "User" WHERE role != 'ADMIN' AND status IS NULL`
  );
  for (const u of legacy.rows) {
    await client.query(
      `UPDATE "User" SET status = 'APPROVED', "updatedAt" = now() WHERE id = $1`,
      [u.id]
    );
    console.log(`✔ User cũ → APPROVED: ${u.email}`);
  }

  const total = await client.query('SELECT COUNT(*)::int AS c FROM "User"');
  console.log(`\nTổng cộng ${total.rows[0].c} user trong hệ thống.`);
}

main()
  .catch((err) => {
    console.error("✗ Lỗi seed admin:", err.message);
    process.exitCode = 1;
  })
  .finally(() => client.end());
