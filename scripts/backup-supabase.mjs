// ============================================================
// Sao lưu toàn bộ dữ liệu Supabase ra file JSON trong backups/.
//
// Chạy: npm run db:backup-supabase
//
// Vì sao cần: scripts/backup-db.mjs chỉ sao lưu file SQLite dev.db — đã lỗi
// thời từ khi dự án chuyển sang Supabase, nên trước các thao tác rủi ro
// (migration, dọn dữ liệu) không có bản lưu nào của DB thật.
//
// File ra: backups/supabase-<YYYYMMDD-HHMMSS>.json
//   { createdAt, database, tables: { "Ten": [ {...}, ... ] } }
//
// KHÔNG chứa _prisma_migrations (bảng nội bộ của Prisma, không phải dữ liệu).
// ============================================================

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error("✗ Thiếu DATABASE_URL / DIRECT_URL — kiểm tra file .env");
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const { rows: tableRows } = await client.query(
  `SELECT table_name
     FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name <> '_prisma_migrations'
    ORDER BY table_name`
);

const tables = {};
let totalRows = 0;

for (const { table_name } of tableRows) {
  // Tên bảng lấy từ information_schema nên an toàn; vẫn bọc nháy kép cho chắc.
  const { rows } = await client.query(`SELECT * FROM "${table_name}"`);
  tables[table_name] = rows;
  totalRows += rows.length;
  console.log(`  ${String(rows.length).padStart(5)} dòng  ${table_name}`);
}

await client.end();

const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace("T", "-")
  .slice(0, 15);

const dir = path.resolve("./backups");
fs.mkdirSync(dir, { recursive: true });

const dest = path.join(dir, `supabase-${stamp}.json`);
fs.writeFileSync(
  dest,
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      database: connectionString.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@"),
      tables,
    },
    null,
    2
  )
);

const sizeKb = Math.round(fs.statSync(dest).size / 1024);
console.log(`\n✓ Đã sao lưu ${tableRows.length} bảng, ${totalRows} dòng`);
console.log(`  ${dest}  (${sizeKb} KB)`);
console.log("\nKhôi phục: mở file JSON và INSERT lại theo bảng tương ứng.");
