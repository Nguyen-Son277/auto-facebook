import "server-only";

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL ?? "file:./dev.db";
  // timeout = busy timeout: chờ tối đa 5s khi file DB đang bị tiến trình khác
  // khóa. Cần thiết vì worker tự động đăng bài là tiến trình riêng, chạy song
  // song với web server trên cùng file SQLite.
  const adapter = new PrismaBetterSqlite3({ url, timeout: 5000 });
  const client = new PrismaClient({ adapter });

  // Bật WAL để đọc và ghi không chặn nhau giữa worker và web server.
  // WAL là thuộc tính lưu trong file DB nên chỉ cần bật một lần là có hiệu lực.
  void client
    .$executeRawUnsafe("PRAGMA journal_mode=WAL")
    .catch(() => {
      // Không chặn khởi động nếu không bật được (ví dụ DB chỉ đọc)
    });

  return client;
}

// Singleton: tránh tạo nhiều connection khi Next.js hot-reload ở môi trường dev.
export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
