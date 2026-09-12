import "server-only";

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { prisma } from "./prisma";

// ============================================================
// AppSettings — lưu cấu hình dịch vụ (AI / Pexels / Facebook) vào
// SQLite, mã hóa AES-256-GCM trước khi ghi. Khóa mã hóa được suy ra
// từ SESSION_SECRET qua scrypt + salt cố định của app.
// ============================================================

const ENC_PREFIX = "enc:v1:";

function getMasterKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET chưa cấu hình — không thể mã hóa cài đặt.");
  }
  return scryptSync(secret, "fb-marketing-auto:app-settings:v1", 32);
}

export function encryptValue(plain: string): string {
  const key = getMasterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + [
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptValue(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored; // cũ / chưa mã hóa
  const parts = stored.slice(ENC_PREFIX.length).split(":");
  const [ivB64, tagB64, ctB64] = parts;
  const key = getMasterKey();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

// ---------- Định nghĩa các key cài đặt hỗ trợ ----------

export const SETTING_KEYS = {
  AI: { baseUrl: "ai.baseUrl", apiKey: "ai.apiKey", model: "ai.model" },
  PEXELS: { apiKey: "pexels.apiKey" },
  APP: { onboardingDone: "app.onboardingDone", theme: "app.theme" },
  FACEBOOK: {
    appId: "facebook.appId",
    appSecret: "facebook.appSecret",
    graphVersion: "facebook.graphVersion",
    userToken: "facebook.userToken",
    userTokenExpiresAt: "facebook.userTokenExpiresAt",
  },
} as const;

// AI/Pexels là tài sản RIÊNG của từng người dùng — lưu trong UserSetting,
// KHÔNG fallback env và KHÔNG đọc AppSetting toàn cục. Env chỉ còn dùng
// cho hạ tầng (DATABASE_URL, SESSION_SECRET...) và Facebook legacy.
const KEY_TO_ENV: Record<string, string> = {
  "facebook.appId": "FACEBOOK_APP_ID",
  "facebook.appSecret": "FACEBOOK_APP_SECRET",
  "facebook.graphVersion": "FACEBOOK_GRAPH_VERSION",
};

const KEY_TO_GROUP: Record<string, string> = {
  "ai.baseUrl": "AI",
  "ai.apiKey": "AI",
  "ai.model": "AI",
  "pexels.apiKey": "PEXELS",
  "app.onboardingDone": "APP",
  "app.theme": "APP",
  "facebook.appId": "FACEBOOK",
  "facebook.appSecret": "FACEBOOK",
  "facebook.graphVersion": "FACEBOOK",
  "facebook.userToken": "FACEBOOK",
  "facebook.userTokenExpiresAt": "FACEBOOK",
};

// ---------- Đọc/ghi ----------

/** Lưu 1 key (mã hóa trước khi ghi). */
export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    update: { value: encryptValue(value) },
    create: { key, value: encryptValue(value), group: KEY_TO_GROUP[key] ?? "MISC" },
  });
}

/**
 * Đọc 1 key. Ưu tiên giá trị lưu trong DB (đã giải mã),
 * fallback về biến môi trường nếu DB chưa có.
 */
export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (row) return decryptValue(row.value);
  const envKey = KEY_TO_ENV[key];
  if (envKey && process.env[envKey]) return process.env[envKey]!;
  return null;
}

export type SettingsMap = {
  values: Record<string, string | null>; // giải mã đầy đủ — CHỈ dùng server-side
  masked: Record<string, string>;        // key bí mật → mask; key thường → giá trị thật (để làm defaultValue)
  savedKeys: Set<string>;                // các key đã có giá trị (DB hoặc env)
};

/** Những key là bí mật — bắt buộc mask trước khi render lên UI. */
const SECRET_KEYS = new Set<string>([
  "ai.apiKey",
  "pexels.apiKey",
  "facebook.appSecret",
  "facebook.userToken",
]);

export function maskSecret(value: string): string {
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••••••${value.slice(-4)}`;
}

/**
 * Đọc toàn bộ key của app: key bí mật được mask, key thường (Base URL, Model,
 * App ID, Graph version) trả về giá trị thật để đổ vào defaultValue của form.
 */
export async function getSettingsMeta(keys: string[]): Promise<SettingsMap> {
  const values: Record<string, string | null> = {};
  const masked: Record<string, string> = {};
  const savedKeys = new Set<string>();

  for (const key of keys) {
    const val = await getSetting(key);
    values[key] = val;
    if (val) {
      masked[key] = SECRET_KEYS.has(key) ? maskSecret(val) : val;
      savedKeys.add(key);
    } else {
      masked[key] = "";
    }
  }

  return { values, masked, savedKeys };
}

// ---------- Cấu hình theo TỪNG USER (AI / Pexels) ----------
//
// Key của ai nào người dùng nấy tự nhập, dùng cho riêng họ.
// Không có fallback env — tài khoản mới bắt đầu từ trang trắng.

/** Nhóm của các key user-level (AppSetting vẫn giữ Facebook legacy). */
const USER_SETTING_GROUP: Record<string, string> = {
  "ai.baseUrl": "AI",
  "ai.apiKey": "AI",
  "ai.model": "AI",
  "pexels.apiKey": "PEXELS",
};

/** Ghi 1 key của user (mã hóa như AppSetting). Giá trị rỗng = xóa key. */
export async function setUserSetting(
  userId: string,
  key: string,
  value: string
): Promise<void> {
  if (!value) {
    await prisma.userSetting.deleteMany({ where: { userId, key } });
    return;
  }
  await prisma.userSetting.upsert({
    where: { userId_key: { userId, key } },
    update: { value: encryptValue(value) },
    create: {
      userId,
      key,
      value: encryptValue(value),
      group: USER_SETTING_GROUP[key] ?? "MISC",
    },
  });
}

/** Đọc 1 key của user (giải mã); chưa có → null. */
export async function getUserSetting(
  userId: string,
  key: string
): Promise<string | null> {
  const row = await prisma.userSetting.findUnique({
    where: { userId_key: { userId, key } },
  });
  return row ? decryptValue(row.value) : null;
}

/** Meta để render form của user: key bí mật mask, key thường trả thật. */
export async function getUserSettingsMeta(
  userId: string,
  keys: string[]
): Promise<SettingsMap> {
  const values: Record<string, string | null> = {};
  const masked: Record<string, string> = {};
  const savedKeys = new Set<string>();

  for (const key of keys) {
    const val = await getUserSetting(userId, key);
    values[key] = val;
    if (val) {
      masked[key] = SECRET_KEYS.has(key) ? maskSecret(val) : val;
      savedKeys.add(key);
    } else {
      masked[key] = "";
    }
  }
  return { values, masked, savedKeys };
}

/** Cấu hình AI RIÊNG của user — chatCompletion/generatePostVariants cần userId. */
export async function getAiConfigForUser(userId: string) {
  const [baseUrl, apiKey, model] = await Promise.all([
    getUserSetting(userId, SETTING_KEYS.AI.baseUrl),
    getUserSetting(userId, SETTING_KEYS.AI.apiKey),
    getUserSetting(userId, SETTING_KEYS.AI.model),
  ]);
  return { baseUrl, apiKey, model };
}

/** Pexels API key RIÊNG của user. */
export async function getPexelsKeyForUser(userId: string): Promise<string | null> {
  return getUserSetting(userId, SETTING_KEYS.PEXELS.apiKey);
}

/**
 * User nào đã tự nhập key Pexels (để thông báo hệ thống biết ai còn trống).
 * Trả về danh sách userId CHƯA có key trong các user đưa vào.
 */
export async function usersMissingPexelsKey(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await prisma.userSetting.findMany({
    where: { userId: { in: userIds }, key: SETTING_KEYS.PEXELS.apiKey },
    select: { userId: true },
  });
  const has = new Set(rows.map((r) => r.userId));
  return userIds.filter((id) => !has.has(id));
}

/** User có đầy đủ bộ AI để tự động soạn bài? */
export async function userHasAiConfig(userId: string): Promise<boolean> {
  const { baseUrl, apiKey, model } = await getAiConfigForUser(userId);
  return Boolean(baseUrl && apiKey && model);
}

/** User có key Pexels? */
export async function userHasPexelsKey(userId: string): Promise<boolean> {
  return Boolean(await getPexelsKeyForUser(userId));
}

// ---------- Cấu hình Facebook toàn cục (legacy) ----------

/**
 * Bộ Facebook app mặc định cũ. Tính năng đa-app thật sự nằm ở
 * /facebook-apps (theo workspace); các hàm này chỉ còn phục vụ
 * luồng cũ chưa di dời hết.
 */
export async function getFacebookConfig() {
  const [appId, appSecret, graphVersion, userToken, userTokenExpiresAt] =
    await Promise.all([
      getSetting("facebook.appId"),
      getSetting("facebook.appSecret"),
      getSetting("facebook.graphVersion"),
      getSetting("facebook.userToken"),
      getSetting("facebook.userTokenExpiresAt"),
    ]);
  return { appId, appSecret, graphVersion, userToken, userTokenExpiresAt };
}
