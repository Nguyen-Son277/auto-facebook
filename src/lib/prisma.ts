import "server-only";

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Tạo Prisma Client nối PostgreSQL (Supabase) qua driver adapter `pg`.
 *
 * - DATABASE_URL nên là connection string ĐÃ QUA POOLER (Supavisor, cổng
 *   6543, kèm `?pgbouncer=true`) khi chạy trên Vercel/serverless. Pooler giữ
 *   số kết nối thật tới Postgres ở mức thấp dù có nhiều lambda instance.
 * - `max` nhỏ (5) vì mỗi lambda/instance chỉ nên giữ vài kết nối; Supabase
 *   Free có giới hạn kết nối thấp.
 * - Prisma CLI (migrate/introspect) dùng DIRECT_URL trong prisma.config.ts,
 *   KHÔNG dùng biến này — pooler không hợp với prepared statement của CLI.
 */
function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL chưa cấu hình — cần connection string PostgreSQL của Supabase."
    );
  }

  const adapter = new PrismaPg({
    connectionString,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

  return new PrismaClient({ adapter });
}

// Singleton: tránh tạo nhiều connection khi Next.js hot-reload ở môi trường dev.
export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
