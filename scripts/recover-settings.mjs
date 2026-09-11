// Khôi phục các cài đặt còn sót trong dev.db (giá trị đã mã hóa AES-256-GCM).
// Chỉ ĐỌC, không ghi. In ra giá trị đã giải mã để xác định cấu hình thật.
import fs from "node:fs";
import { createDecipheriv, scryptSync } from "node:crypto";

const env = fs.readFileSync(".env", "utf8");
const secret = env.match(/^SESSION_SECRET="([^"]*)"/m)?.[1];
if (!secret) throw new Error("Không đọc được SESSION_SECRET từ .env");
const key = scryptSync(secret, "fb-marketing-auto:app-settings:v1", 32);

const buf = fs.readFileSync("dev.db");
const s = buf.toString("latin1");

// enc:v1:<iv 16 b64>:<tag 24 b64>:<ciphertext b64>
// Lưu ý: phần tag có thể chứa '=' đệm nên phải có '=' trong lớp ký tự
const re = /enc:v1:([A-Za-z0-9+/]{16}):([A-Za-z0-9+/=]{24}):([A-Za-z0-9+/=]+)/g;

// Tên các key cấu hình có thể có
const KEY_NAMES = [
  "ai.baseUrl", "ai.apiKey", "ai.model",
  "pexels.apiKey",
  "facebook.userToken", "facebook.appId", "facebook.appSecret",
  "facebook.pageId", "scheduler.lastRunAt", "scheduler.enabled", "scheduler.lastSource",
];

function nearestKey(index) {
  let best = null;
  for (const k of KEY_NAMES) {
    // tìm lần xuất hiện gần nhất TRƯỚC vị trí ciphertext
    let from = 0;
    while (true) {
      const at = s.indexOf(k, from);
      if (at === -1 || at > index) break;
      if (!best || at > best.at) best = { k, at };
      from = at + 1;
    }
  }
  return best && index - best.at < 200 ? best.k : "(không rõ)";
}

const found = [];
let m;
while ((m = re.exec(s))) {
  const [, ivB64, tagB64] = m;
  const ctFull = m[3];
  let plain = null;
  for (let L = ctFull.length - (ctFull.length % 4); L >= 4; L -= 4) {
    try {
      const dec = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
      dec.setAuthTag(Buffer.from(tagB64, "base64"));
      plain = Buffer.concat([
        dec.update(Buffer.from(ctFull.slice(0, L), "base64")),
        dec.final(),
      ]).toString("utf8");
      break;
    } catch {
      /* thử độ dài ngắn hơn */
    }
  }
  if (plain === null) continue;
  found.push({ offset: m.index, key: nearestKey(m.index), value: plain });
}

// Bỏ trùng lặp hoàn toàn
const uniq = [];
const seen = new Set();
for (const f of found) {
  const sig = f.key + "\u0000" + f.value;
  if (seen.has(sig)) continue;
  seen.add(sig);
  uniq.push(f);
}

console.log(`Tìm thấy ${found.length} giá trị mã hóa, ${uniq.length} giá trị khác nhau:\n`);
for (const f of uniq) {
  console.log(`@${String(f.offset).padStart(6)}  ${f.key.padEnd(22)} = ${JSON.stringify(f.value)}`);
}
