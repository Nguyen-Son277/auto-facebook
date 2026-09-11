// Smoke test: tạo user test + ký session token để curl thử /dashboard
// Chạy: node scripts/smoke-login.mjs  → in ra chuỗi cookie
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { openTestDb } from "./lib/test-db.mjs";

// Đọc SESSION_SECRET từ .env
const env = readFileSync(".env", "utf8");
const secret =
  env.match(/^SESSION_SECRET="([^"]*)"/m)?.[1] ?? "";

if (!secret) {
  console.error("SESSION_SECRET không tìm thấy trong .env");
  process.exit(1);
}

const db = openTestDb();
const email = "smoke@test.local";
const id = randomUUID();

db.prepare(
  'DELETE FROM "User" WHERE email = ?'
).run(email);

db.prepare(
  `INSERT INTO "User" (id, email, name, password, role, createdAt, updatedAt)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
).run(
  id,
  email,
  "Smoke Test",
  bcrypt.hashSync("test123", 12),
  "ADMIN",
  new Date().toISOString(),
  new Date().toISOString()
);

const token = await new SignJWT({ userId: id, email, name: "Smoke Test" })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("7d")
  .sign(new TextEncoder().encode(secret));

console.log(`session=${token}`);
db.close();
