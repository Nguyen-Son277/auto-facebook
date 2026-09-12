import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "uploads";
const maxBytes = Number(process.env.MAX_VIDEO_BYTES ?? 52428800);

if (!url || !key) {
  console.error("Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
if (listErr) {
  console.error("Không liệt kê được bucket:", listErr.message);
  process.exit(1);
}

console.log("Bucket hiện có:", buckets.map((b) => `${b.name}${b.public ? " (public)" : " (private)"}`).join(", ") || "(chưa có)");

if (buckets.some((b) => b.name === bucket)) {
  console.log(`✔ Bucket "${bucket}" đã tồn tại.`);
} else {
  const { error } = await supabase.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: maxBytes,
  });
  if (error) {
    console.error(`✗ Không tạo được bucket "${bucket}":`, error.message);
    process.exit(1);
  }
  console.log(`✔ Đã tạo bucket private "${bucket}" (giới hạn ${Math.round(maxBytes / 1024 / 1024)}MB).`);
}
