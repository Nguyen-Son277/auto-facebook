// ============================================================
// Dọn thông báo rác trong hộp thư.
//
// Bối cảnh: nhịp AutoPilot từng gửi "🤖 AutoPilot bắt đầu chạy" mỗi ~5 phút,
// sinh ra 454 tin chỉ trong ~33 giờ. Code đã bị bỏ (src/lib/scheduler.ts),
// script này để dọn số tin cũ đã lỡ ghi vào DB.
//
// Cách dùng:
//   npm run db:cleanup-notifications                              # liệt kê top tiêu đề
//   npm run db:cleanup-notifications -- --title "..."             # ĐẾM THỬ (dry-run)
//   npm run db:cleanup-notifications -- --title "..." --apply     # xoá thật
//
// Tuỳ chọn:
//   --user <email|id>    chỉ dọn của một người nhận
//   --older-than <n>     chỉ dọn tin cũ hơn n ngày
//   --type <ACTIVITY|ADMIN|SYSTEM>
//
// An toàn: mặc định KHÔNG xoá gì. Phải có ĐỒNG THỜI --title và --apply.
// ============================================================

import "dotenv/config";
import pg from "pg";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name) => process.argv.includes(`--${name}`);

const title = arg("title");
const userArg = arg("user");
const olderThan = arg("older-than");
const type = arg("type");
const apply = has("apply");

const connectionString = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
if (!connectionString) {
  console.error("✗ Thiếu DATABASE_URL — kiểm tra file .env");
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

// ------------------------------------------------------------
// Không có --title → chỉ liệt kê để người dùng chọn
// ------------------------------------------------------------
if (!title) {
  const { rows } = await client.query(
    `SELECT title, count(*)::int AS n, max("createdAt") AS latest
       FROM "Notification"
      GROUP BY title
      ORDER BY n DESC
      LIMIT 20`
  );
  console.log("Top tiêu đề thông báo đang có:\n");
  for (const r of rows) {
    console.log(`  ${String(r.n).padStart(5)}  ${r.title}`);
  }
  console.log(
    "\nĐể dọn, chạy lại kèm --title (thêm --apply để xoá thật):\n" +
      '  npm run db:cleanup-notifications -- --title "🤖 AutoPilot bắt đầu chạy" --apply'
  );
  await client.end();
  process.exit(0);
}

// ------------------------------------------------------------
// Xác định người nhận (nếu có)
// ------------------------------------------------------------
let userId = null;
if (userArg) {
  const found = await client.query(
    `SELECT id, email FROM "User" WHERE email = $1 OR id = $1 LIMIT 1`,
    [userArg]
  );
  if (found.rowCount === 0) {
    console.error(`✗ Không tìm thấy user "${userArg}"`);
    await client.end();
    process.exit(1);
  }
  userId = found.rows[0].id;
  console.log(`Người nhận: ${found.rows[0].email} (${userId})`);
}

// ------------------------------------------------------------
// Dựng điều kiện lọc
// ------------------------------------------------------------
const where = [];
const params = [];

params.push(title);
where.push(`title = $${params.length}`);

if (userId) {
  params.push(userId);
  where.push(`"userId" = $${params.length}`);
}
if (type) {
  params.push(type);
  where.push(`type = $${params.length}`);
}
if (olderThan) {
  const days = Number(olderThan);
  if (!Number.isFinite(days) || days < 0) {
    console.error("✗ --older-than phải là số ngày >= 0");
    await client.end();
    process.exit(1);
  }
  params.push(`${days} days`);
  where.push(`"createdAt" < now() - $${params.length}::interval`);
}

const whereSql = where.join(" AND ");

const counted = await client.query(
  `SELECT count(*)::int AS n FROM "Notification" WHERE ${whereSql}`,
  params
);
const total = counted.rows[0].n;

console.log(`\nTiêu đề : ${title}`);
if (type) console.log(`Loại    : ${type}`);
if (olderThan) console.log(`Cũ hơn  : ${olderThan} ngày`);
console.log(`Khớp    : ${total} thông báo`);

if (total === 0) {
  console.log("\nKhông có gì để dọn.");
  await client.end();
  process.exit(0);
}

if (!apply) {
  console.log("\n(DRY-RUN — chưa xoá gì. Thêm --apply để xoá thật.)");
  await client.end();
  process.exit(0);
}

const deleted = await client.query(
  `DELETE FROM "Notification" WHERE ${whereSql}`,
  params
);
console.log(`\n✓ Đã xoá ${deleted.rowCount} thông báo.`);

await client.end();
