"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { requireCurrentUser } from "@/lib/dal";
import { resetPexelsRateLimit } from "@/lib/pexels";
import {
  getAiConfigForUser,
  getFacebookConfig,
  getPexelsKeyForUser,
  getUserSetting,
  setUserSetting,
  SETTING_KEYS,
} from "@/lib/settings";
import { fetchAiModels } from "@/lib/ai";

export type ActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  details?: string[];
  /** Danh sách model tải từ provider (dùng để đổ vào dropdown chọn model). */
  models?: string[];
  /** Lỗi khi tải danh sách model (không làm hỏng thao tác lưu). */
  modelsError?: string;
} | null;

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

/** Nút nào được bấm: "load" (chỉ tải model), "save" (chỉ lưu) hay "test" (lưu & kiểm tra). */
const intentOf = (fd: FormData) => {
  const intent = str(fd, "intent");
  return intent === "test" || intent === "load" ? intent : "save";
};

// ============================================================
// AI Provider ([OI]-compatible)
// ============================================================

export async function saveAiSettings(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireCurrentUser();

  const intent = intentOf(formData);
  const baseUrl = str(formData, "baseUrl");
  const apiKey = str(formData, "apiKey");
  const model = str(formData, "model");

  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    return { error: "Base URL phải bắt đầu bằng http:// hoặc https://" };
  }

  // ---- intent="load": chỉ tải danh sách model, không lưu gì ----
  if (intent === "load") {
    const fetched = await fetchAiModels(user.id, { baseUrl, apiKey });
    if (!fetched.ok) return { ok: false, error: fetched.error, models: [] };
    return {
      ok: true,
      message: `Đã tải ${fetched.count} model từ provider — chọn model bên dưới rồi bấm lưu.`,
      models: fetched.models,
    };
  }

  if (!baseUrl) return { error: "Base URL là bắt buộc." };

  await setUserSetting(user.id, SETTING_KEYS.AI.baseUrl, baseUrl.replace(/\/+$/, ""));
  if (model) await setUserSetting(user.id, SETTING_KEYS.AI.model, model);
  // Bỏ trống API key = giữ nguyên key đã lưu
  if (apiKey) await setUserSetting(user.id, SETTING_KEYS.AI.apiKey, apiKey);

  revalidatePath("/settings");

  // Tự tải danh sách model ngay sau khi lưu (không cần người dùng gõ model)
  const fetched = await fetchAiModels(user.id);

  if (intent === "test") {
    const tested = await testAiConnection(user.id);
    return {
      ...tested,
      models: fetched.models,
      modelsError: fetched.ok ? undefined : fetched.error,
    };
  }

  return {
    ok: true,
    message: "Đã lưu cấu hình AI Provider.",
    models: fetched.models,
    modelsError: fetched.ok ? undefined : fetched.error,
  };
}

async function testAiConnection(userId: string): Promise<ActionState> {
  const { baseUrl, apiKey, model } = await getAiConfigForUser(userId);
  if (!baseUrl || !apiKey) {
    return { ok: false, error: "Thiếu Base URL hoặc API Key." };
  }
  if (!model) {
    return {
      ok: false,
      error: "Chưa chọn model — bấm \"Tải danh sách model\" rồi chọn model từ dropdown.",
    };
  }

  try {
    // 1) GET {baseUrl}/models — kiểm tra auth + danh sách model
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });

    const details: string[] = [];
    let modelListed = false;

    if (res.ok) {
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      const ids = (data.data ?? []).map((m) => m.id);
      modelListed = ids.some((id) => id === model);
      details.push(`Danh sách model: ${ids.length} mục.`);
      if (!modelListed) {
        details.push(
          `⚠ Model "${model}" không có trong /models — vẫn thử gọi thực tế bên dưới.`
        );
      }
    } else {
      details.push(`/models trả về ${res.status} — bỏ qua bước kiểm tra danh sách.`);
    }

    // 2) Chat ping thật với model đã chọn (xác nhận model dùng được, không chỉ tồn tại)
    const ping = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Trả lời đúng một từ: OK" }],
        max_tokens: 10,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (ping.ok) {
      const data = (await ping.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { total_tokens?: number };
        model?: string;
      };
      const reply = data.choices?.[0]?.message?.content?.trim() ?? "(không có nội dung)";
      details.push(`Model phản hồi: "${reply.slice(0, 80)}"`);
      if (data.usage?.total_tokens) {
        details.push(`Đã dùng ${data.usage.total_tokens} token cho lần kiểm tra này.`);
      }
      return {
        ok: true,
        message: `Kết nối AI thành công — model "${model}" hoạt động tốt`,
        details,
      };
    }

    const errBody = await ping.text();
    return {
      ok: false,
      error: `Model "${model}" không gọi được (chat/completions trả ${ping.status}).`,
      details: [...details, errBody.slice(0, 400)],
    };
  } catch (err) {
    return {
      ok: false,
      error: `Kết nối thất bại: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ============================================================
// Pexels API
// ============================================================

export async function savePexelsSettings(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireCurrentUser();

  const apiKey = str(formData, "apiKey");
  if (apiKey) {
    await setUserSetting(user.id, SETTING_KEYS.PEXELS.apiKey, apiKey);
    // Key mới có hạn mức riêng — bỏ trạng thái tạm ngưng của key cũ,
    // nếu không người dùng đổi key xong vẫn bị chặn tới hết giờ.
    resetPexelsRateLimit(user.id);
  }

  const saved = await getPexelsKeyForUser(user.id);
  if (!saved) return { error: "Vui lòng nhập Pexels API Key." };

  revalidatePath("/settings");

  if (intentOf(formData) === "save") {
    return { ok: true, message: "Đã lưu Pexels API Key." };
  }

  try {
    const res = await fetch("https://api.pexels.com/v1/curated?per_page=1", {
      headers: { Authorization: saved },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const data = (await res.json()) as { total_results?: number };
      return {
        ok: true,
        message: "Kết nối Pexels thành công ✓",
        details: [
          `Kho ảnh: ${data.total_results?.toLocaleString("vi-VN") ?? "?"} kết quả.`,
          "Giới hạn mặc định 200 request/giờ.",
        ],
      };
    }
    const body = await res.text();
    return { ok: false, error: `Pexels trả về mã ${res.status}`, details: [body.slice(0, 300)] };
  } catch (err) {
    return {
      ok: false,
      error: `Không thể kết nối Pexels: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ============================================================
// Xóa key đã lưu (user lấy lại key khác / thôi dùng dịch vụ)
// ============================================================

export async function clearUserSettingAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await requireCurrentUser();

  const group = str(formData, "group"); // "AI" | "PEXELS"
  const keys =
    group === "AI"
      ? Object.values(SETTING_KEYS.AI)
      : group === "PEXELS"
        ? Object.values(SETTING_KEYS.PEXELS)
        : [];
  if (keys.length === 0) return { error: "Nhóm cài đặt không hợp lệ." };

  for (const key of keys) await setUserSetting(user.id, key, "");
  if (group === "PEXELS") resetPexelsRateLimit(user.id);

  revalidatePath("/settings");
  return {
    ok: true,
    message:
      group === "AI"
        ? "Đã xóa cấu hình AI của bạn — tính năng soạn bài bằng AI tạm ngưng tới khi nhập lại."
        : "Đã xóa Pexels API Key của bạn.",
  };
}

// ============================================================
// Trạng thái tổng hợp
// ============================================================

export async function getIntegrationStatus() {
  const user = await requireCurrentUser();
  const [ai, pexelsKey, fb] = await Promise.all([
    getAiConfigForUser(user.id),
    getPexelsKeyForUser(user.id),
    getFacebookConfig(),
  ]);
  return {
    ai: Boolean(ai.baseUrl && ai.apiKey && ai.model),
    pexels: Boolean(pexelsKey),
    facebook: Boolean(fb.appId && fb.appSecret),
  };
}

// ============================================================
// Onboarding — tắt hướng dẫn ban đầu (đặt cờ vĩnh viễn)
// ============================================================

/** User bấm "Hoàn thành — không hiện lại" trên OnboardingGuide. */
export async function dismissOnboarding(): Promise<{ ok: boolean } | null> {
  const user = await requireCurrentUser();
  await setUserSetting(user.id, SETTING_KEYS.APP.onboardingDone, "1");
  revalidatePath("/dashboard");
  return { ok: true };
}

/** Trang dashboard đọc cờ này để quyết định có hiện onboarding không. */
export async function isOnboardingDone(): Promise<boolean> {
  const user = await requireCurrentUser();
  const done = await getUserSetting(user.id, SETTING_KEYS.APP.onboardingDone);
  return done === "1";
}

// ============================================================
// Theme Sáng / Tối / Hệ thống
// ============================================================

export type ThemePreference = "light" | "dark" | "system";

/** Đọc lựa chọn theme đã lưu (mặc định "system"). */
export async function getThemePreference(): Promise<ThemePreference> {
  const user = await requireCurrentUser();
  const saved = await getUserSetting(user.id, SETTING_KEYS.APP.theme);
  return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
}

/**
 * Lưu theme: UserSetting (nhớ theo tài khoản) + cookie (script no-flash
 * ở root layout đọc được ngay lần tải sau, không đụng DB).
 */
export async function setThemePreference(
  theme: ThemePreference
): Promise<{ ok: boolean } | null> {
  const user = await requireCurrentUser();
  if (theme !== "light" && theme !== "dark" && theme !== "system") {
    return { ok: false };
  }

  await setUserSetting(user.id, SETTING_KEYS.APP.theme, theme);

  const cookieStore = await cookies();
  cookieStore.set("theme", theme, {
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
  });

  return { ok: true };
}
