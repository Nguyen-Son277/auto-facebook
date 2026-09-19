import "server-only";

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

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
//
// ⚠️ VÌ SAO CÓ "SCHEMA VERSION" TRONG KHÓA CACHE
// `prisma generate` ghi lại client vào src/generated/prisma, nhưng tiến trình dev
// đang chạy vẫn giữ object PrismaClient CŨ trong globalThis — hot-reload chỉ nạp
// lại module lib/prisma.ts, không dựng lại client. Kết quả: model mới (ví dụ
// `prisma.driveConnection`) là `undefined` và app chết với
//   "Cannot read properties of undefined (reading 'findUnique')".
// Đổi khóa cache khi schema thay đổi buộc dev server dựng client mới ngay lần
// import kế tiếp, thay vì phải restart tay mà không rõ nguyên nhân.
//
// QUY ƯỚC: mỗi migration thêm/đổi model hoặc cột thì tăng số này.
const SCHEMA_VERSION = "3-media-drive-folder";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  /** Phiên bản schema của client đang nằm trong globalThis. */
  prismaSchemaVersion?: string;
};

/**
 * Client dùng chung. Ở production chỉ tạo một lần cho cả tiến trình.
 *
 * Dùng `globalThis` để dev không mở thêm pool mỗi lần hot-reload, nhưng KHÓA
 * theo SCHEMA_VERSION: sau khi chạy `prisma generate` cho schema mới, lần import
 * kế tiếp sẽ thấy phiên bản khác và dựng lại client — tránh lỗi
 * "Cannot read properties of undefined" ở model vừa thêm.
 */
function getPrismaClient(): PrismaClient {
  if (
    globalForPrisma.prisma &&
    globalForPrisma.prismaSchemaVersion === SCHEMA_VERSION
  ) {
    return globalForPrisma.prisma;
  }

  const client = createPrismaClient();

  if (process.env.NODE_ENV !== "production") {
    // Cảnh báo khi thay client vì schema đổi — để không ai phải đoán nguyên nhân.
    if (globalForPrisma.prisma) {
      console.warn(
        `[prisma] Schema đã đổi (${globalForPrisma.prismaSchemaVersion} → ${SCHEMA_VERSION}) — ` +
          "đã dựng lại Prisma Client cho khớp."
      );
    }
    globalForPrisma.prisma = client;
    globalForPrisma.prismaSchemaVersion = SCHEMA_VERSION;
  }

  return client;
}

export const prisma = getPrismaClient();
