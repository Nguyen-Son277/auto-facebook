import "server-only";

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Tạo Prisma Client nối PostgreSQL (Supabase) qua driver adapter `pg`.
 *
 * ⚠️ DATABASE_URL PHẢI là TRANSACTION POOLER (Supavisor cổng **6543**, kèm
 * `?pgbouncer=true`), KHÔNG phải session pooler (5432).
 *
 * Vì sao: session pooler giữ riêng 1 kết nối Postgres cho mỗi client và chỉ
 * cho tối đa 15 client. Trên Vercel mỗi lambda instance mở pool riêng, nên chỉ
 * vài instance là cạn và mọi truy vấn đổ lỗi:
 *   `(EMAXCONNSESSION) max clients reached in session mode - pool_size: 15`
 * Transaction pooler dùng chung 15 kết nối Postgres cho rất nhiều client.
 *
 * - `max` nhỏ vì mỗi lambda chỉ nên giữ vài kết nối; đổi bằng PRISMA_POOL_MAX.
 * - Prisma CLI (migrate/introspect) dùng DIRECT_URL trong prisma.config.ts —
 *   migrate cần session mode nên vẫn trỏ cổng 5432.
 */
const POOL_MAX = Number(process.env.PRISMA_POOL_MAX ?? 3);

/**
 * Lưới an toàn cho cấu hình sai: nếu DATABASE_URL vô tình trỏ SESSION pooler
 * của Supabase (cổng 5432) thì tự đổi sang TRANSACTION pooler (6543).
 *
 * Session pooler chỉ cho 15 client và app trên Vercel sẽ chết hàng loạt với
 * `(EMAXCONNSESSION) max clients reached in session mode`. Đổi cổng ở đây giúp
 * app vẫn chạy dù biến môi trường trên Vercel chưa được sửa — kèm cảnh báo để
 * nhắc sửa cho đúng.
 *
 * Chỉ áp dụng cho host pooler của Supabase; mọi connection string khác giữ nguyên.
 * DIRECT_URL (Prisma CLI migrate) KHÔNG đi qua đây nên vẫn dùng cổng 5432.
 */
function normalizeDatabaseUrl(raw: string): string {
  if (!/\.pooler\.supabase\.com:5432(\/|$|\?)/.test(raw)) return raw;

  const fixed =
    raw.replace(/(\.pooler\.supabase\.com):5432/, "$1:6543") +
    (raw.includes("?") ? "&pgbouncer=true" : "?pgbouncer=true");

  console.warn(
    "[prisma] DATABASE_URL đang trỏ session pooler (5432) — đã tự chuyển sang " +
      "transaction pooler (6543) để không cạn kết nối. " +
      "Hãy sửa biến môi trường DATABASE_URL cho đúng."
  );
  return fixed;
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL chưa cấu hình — cần connection string PostgreSQL của Supabase."
    );
  }

  const adapter = new PrismaPg({
    connectionString: normalizeDatabaseUrl(connectionString),
    max: POOL_MAX,
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
