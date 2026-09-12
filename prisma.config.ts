// Cấu hình Prisma CLI (migrate / introspect / generate).
//
// Prisma CLI cần kết nối TRỰC TIẾP (không qua transaction pooler) vì phải
// chạy prepared statement và giữ session. Runtime của app thì dùng
// DATABASE_URL (có thể là pooler) — xem src/lib/prisma.ts.
//
// - DIRECT_URL: Supabase session pooler (cổng 5432) hoặc direct connection.
// - Nếu chưa đặt DIRECT_URL (ví dụ máy chỉ có DATABASE_URL), fallback về
//   DATABASE_URL để lệnh generate vẫn chạy được.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
  },
});
