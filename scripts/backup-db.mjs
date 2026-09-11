// Sao lưu dev.db (dữ liệu thật) vào backups/, giữ lại N bản gần nhất.
//
// Chạy: npm run db:backup
// Nên chạy trước mỗi lần thao tác có rủi ro (test, migration, dọn dữ liệu).
import fs from "node:fs";
import path from "node:path";
import { PROD_DB_PATH } from "./lib/test-db.mjs";

const KEEP = Number(process.env.BACKUP_KEEP ?? 10);
const dir = path.resolve("./backups");

if (!fs.existsSync(PROD_DB_PATH)) {
  console.error(`Không thấy DB thật tại ${PROD_DB_PATH}`);
  process.exit(1);
}

fs.mkdirSync(dir, { recursive: true });

const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace("T", "-")
  .slice(0, 15);
const dest = path.join(dir, `dev-${stamp}.db`);

// Dùng API backup của SQLite để có bản sao nhất quán kể cả khi DB đang mở
const Database = (await import("better-sqlite3")).default;
const db = new Database(PROD_DB_PATH, { readonly: true });
await db.backup(dest);
db.close();

const size = fs.statSync(dest).size;
console.log(`✔ Đã sao lưu: ${dest} (${(size / 1024).toFixed(1)} KB)`);

// Dọn bớt bản cũ
const files = fs
  .readdirSync(dir)
  .filter((f) => f.startsWith("dev-") && f.endsWith(".db"))
  .sort()
  .reverse();

for (const old of files.slice(KEEP)) {
  fs.unlinkSync(path.join(dir, old));
  console.log(`  đã xoá bản cũ: ${old}`);
}
console.log(`Đang giữ ${Math.min(files.length, KEEP)} bản trong ${dir}/`);
