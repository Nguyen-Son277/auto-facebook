import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// Supabase Storage — nơi lưu video người dùng tải lên.
//
// Vì sao không lưu trên đĩa: Vercel chạy serverless, ổ đĩa chỉ đọc và
// không bền giữa các lần gọi. Vì sao không đẩy file qua Route Handler:
// Vercel Function giới hạn body 4.5MB, nên trình duyệt phải upload TRỰC
// TIẾP lên Storage bằng signed upload URL do server cấp.
//
// Mọi object nằm trong <bucket>/<userId>/<storageKey>. userId là cuid nên
// tách thư mục theo user là đủ để không tham chiếu chéo file của nhau.
// ============================================================

/** Bucket mặc định — có thể đổi bằng SUPABASE_STORAGE_BUCKET. */
export const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "uploads";

/** Thời hạn (giây) của signed URL để xem trước / cho Facebook tải video. */
export const SIGNED_READ_TTL_SECONDS = 60 * 60; // 1 giờ

let cached: SupabaseClient | null = null;

/** Cấu hình Storage đã sẵn sàng chưa (đủ URL + service key). */
export function isStorageConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function getClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase Storage chưa cấu hình — cần SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  // service_role: chỉ dùng ở server, KHÔNG bao giờ lộ ra client.
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

function bucket() {
  return getClient().storage.from(STORAGE_BUCKET);
}

/** Đường dẫn object trong bucket: <userId>/<storageKey>. */
export function objectPath(userId: string, storageKey: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(userId)) {
    throw new Error("userId không hợp lệ để tạo đường dẫn lưu trữ.");
  }
  return `${userId}/${storageKey}`;
}

/** URL tuyệt đối để trình duyệt PUT file trực tiếp lên Storage. */
export async function createSignedUploadUrl(
  userId: string,
  storageKey: string
): Promise<string> {
  const { data, error } = await bucket().createSignedUploadUrl(
    objectPath(userId, storageKey)
  );
  if (error || !data) {
    throw new Error(
      `Không tạo được URL tải lên: ${error?.message ?? "Supabase trả về rỗng"}. ` +
        `Kiểm tra bucket "${STORAGE_BUCKET}" đã tồn tại chưa.`
    );
  }
  // signedUrl là đường dẫn tương đối (/object/upload/sign/...)
  const base = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  return data.signedUrl.startsWith("http") ? data.signedUrl : `${base}${data.signedUrl}`;
}

/** URL có chữ ký, hết hạn sau ttl giây — dùng để xem trước hoặc cho Facebook tải. */
export async function createSignedReadUrl(
  userId: string,
  storageKey: string,
  ttlSeconds: number = SIGNED_READ_TTL_SECONDS
): Promise<string> {
  const { data, error } = await bucket().createSignedUrl(
    objectPath(userId, storageKey),
    ttlSeconds
  );
  if (error || !data?.signedUrl) {
    throw new Error(`Không tạo được URL xem file: ${error?.message ?? "lỗi không rõ"}`);
  }
  return data.signedUrl;
}

/** Xóa object (bỏ qua nếu không tồn tại). */
export async function removeObject(userId: string, storageKey: string): Promise<void> {
  const { error } = await bucket().remove([objectPath(userId, storageKey)]);
  if (error) {
    throw new Error(`Không xóa được file: ${error.message}`);
  }
}

export type StoredObject = {
  name: string;
  size: number | null;
  updatedAt: string | null;
};

/** Liệt kê object trực tiếp trong thư mục của user. */
export async function listObjects(userId: string): Promise<StoredObject[]> {
  const { data, error } = await bucket().list(userId, {
    limit: 1000,
    sortBy: { column: "name", order: "asc" },
  });
  if (error) {
    throw new Error(`Không liệt kê được file: ${error.message}`);
  }
  return (data ?? [])
    // Supabase trả cả "thư mục ảo" (id = null); chỉ lấy file thật
    .filter((o) => o.id !== null)
    .map((o) => ({
      name: o.name,
      size: typeof o.metadata?.size === "number" ? o.metadata.size : null,
      updatedAt: o.updated_at ?? null,
    }));
}

/** Kích thước object, hoặc null nếu không tồn tại. */
export async function objectSize(
  userId: string,
  storageKey: string
): Promise<number | null> {
  const items = await listObjects(userId);
  const found = items.find((o) => o.name === storageKey);
  return found?.size ?? null;
}
