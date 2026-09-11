// Tạo/cập nhật schema cho DB test (mặc định ./test.db) mà KHÔNG đụng vào dev.db.
//
// Chạy: npm run test:db:prepare
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import Database from "better-sqlite3";
import { PROD_DB_PATH, TEST_DB_PATH } from "./lib/test-db.mjs";

if (TEST_DB_PATH === PROD_DB_PATH) {
  console.error("TỪ CHỐI: TEST_DB trùng DB thật.");
  process.exit(1);
}

console.log(`DB thật (không đụng tới) : ${PROD_DB_PATH}`);
console.log(`DB test (sẽ tạo/cập nhật): ${TEST_DB_PATH}`);

// Dùng đường dẫn tuyệt đối để Prisma và better-sqlite3 chắc chắn trỏ cùng file
const url = `file:${TEST_DB_PATH}`;

console.log("\nĐang áp migration lên DB test…");
execFileSync("npx", ["prisma", "migrate", "deploy"], {
  env: { ...process.env, DATABASE_URL: url },
  stdio: "inherit",
});

if (!fs.existsSync(TEST_DB_PATH)) {
  console.error(`\nKhông thấy ${TEST_DB_PATH} sau khi migrate.`);
  process.exit(1);
}

const db = new Database(TEST_DB_PATH);
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'")
  .all()
  .map((t) => t.name);
db.close();

console.log(`\n✔ DB test sẵn sàng — ${tables.length} bảng: ${tables.join(", ")}`);
console.log("Bước tiếp theo:");
console.log("  1) Chạy web server trỏ vào DB test (kèm mock):");
console.log("       npm run dev:test");
console.log("  2) Chạy mock: npm run mock:ai / PORT=4021 npm run mock:fb / npm run mock:pexels");
console.log("  3) Tạo user test: node scripts/smoke-login.mjs");
console.log("  4) Chạy test: npm run test:e2e:week6 …");
