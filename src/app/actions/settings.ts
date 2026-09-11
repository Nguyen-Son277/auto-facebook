"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/dal";
import { resetPexelsRateLimit } from "@/lib/pexels";
import {
  getAiConfig,
  getFacebookConfig,
  getPexelsConfig,
  setSetting,
  SETTING_KEYS,
} from "@/lib/settings";
import { exchangeForLongLivedToken, fetchUserPages } from "@/lib/facebook";
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
  await requireCurrentUser();

  const intent = intentOf(formData);
  const baseUrl = str(formData, "baseUrl");
  const apiKey = str(formData, "apiKey");
  const model = str(formData, "model");

  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    return { error: "Base URL phải bắt đầu bằng http:// hoặc https://" };
  }

  // ---- intent="load": chỉ tải danh sách model, không lưu gì ----
  if (intent === "load") {
    const fetched = await fetchAiModels({ baseUrl, apiKey });
    if (!fetched.ok) return { ok: false, error: fetched.error, models: [] };
    return {
      ok: true,
      message: `Đã tải ${fetched.count} model từ provider — chọn model bên dưới rồi bấm lưu.`,
      models: fetched.models,
    };
  }

  if (!baseUrl) return { error: "Base URL là bắt buộc." };

  await setSetting(SETTING_KEYS.AI.baseUrl, baseUrl.replace(/\/+$/, ""));
  if (model) await setSetting(SETTING_KEYS.AI.model, model);
  // Bỏ trống API key = giữ nguyên key đã lưu
  if (apiKey) await setSetting(SETTING_KEYS.AI.apiKey, apiKey);

  revalidatePath("/settings");

  // Tự tải danh sách model ngay sau khi lưu (không cần người dùng gõ model)
  const fetched = await fetchAiModels({});

  if (intent === "test") {
    const tested = await testAiConnection();
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

async function testAiConnection(): Promise<ActionState> {
  const { baseUrl, apiKey, model } = await getAiConfig();
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
  await requireCurrentUser();

  const apiKey = str(formData, "apiKey");
  if (apiKey) {
    await setSetting(SETTING_KEYS.PEXELS.apiKey, apiKey);
    // Key mới có hạn mức riêng — bỏ trạng thái tạm ngưng của key cũ,
    // nếu không người dùng đổi key xong vẫn bị chặn tới hết giờ.
    resetPexelsRateLimit();
  }

  const { apiKey: saved } = await getPexelsConfig();
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
// Facebook Graph API
// ============================================================

export async function saveFacebookSettings(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  await requireCurrentUser();

  const appId = str(formData, "appId");
  const appSecret = str(formData, "appSecret");
  const graphVersion = str(formData, "graphVersion") || "v21.0";
  const userToken = str(formData, "userToken");

  if (!appId || !appSecret) {
    return { error: "App ID và App Secret là bắt buộc." };
  }
  if (!/^v\d+\.\d+$/.test(graphVersion)) {
    return { error: `Graph API version không hợp lệ: "${graphVersion}" (ví dụ: v21.0)` };
  }

  await setSetting(SETTING_KEYS.FACEBOOK.appId, appId);
  await setSetting(SETTING_KEYS.FACEBOOK.appSecret, appSecret);
  await setSetting(SETTING_KEYS.FACEBOOK.graphVersion, graphVersion);

  revalidatePath("/settings");
  revalidatePath("/pages");

  if (intentOf(formData) === "save") {
    return { ok: true, message: `Đã lưu cấu hình Facebook (Graph ${graphVersion}).` };
  }

  // Kiểm tra kết nối: cần User Access Token để xác thực thật
  if (!userToken) {
    return {
      ok: true,
      message: "Đã lưu cấu hình. Dán User Access Token rồi bấm lại để kiểm tra kết nối.",
    };
  }

  try {
    const { accessToken, expiresInSeconds } = await exchangeForLongLivedToken(userToken);
    await setSetting(SETTING_KEYS.FACEBOOK.userToken, accessToken);
    await setSetting(
      SETTING_KEYS.FACEBOOK.userTokenExpiresAt,
      String(Date.now() + expiresInSeconds * 1000)
    );

    const pages = await fetchUserPages(accessToken);
    revalidatePath("/pages");
    return {
      ok: true,
      message: `Token hợp lệ — tài khoản quản lý ${pages.length} Page.`,
      details: pages.slice(0, 15).map((p) => `• ${p.name} (${p.id})`),
    };
  } catch (err) {
    return {
      ok: false,
      error: `Không xác thực được token: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ============================================================
// Trạng thái tổng hợp
// ============================================================

export async function getIntegrationStatus() {
  await requireCurrentUser();
  const [ai, pexels, fb] = await Promise.all([
    getAiConfig(),
    getPexelsConfig(),
    getFacebookConfig(),
  ]);
  return {
    ai: Boolean(ai.baseUrl && ai.apiKey && ai.model),
    pexels: Boolean(pexels.apiKey),
    facebook: Boolean(fb.appId && fb.appSecret),
  };
}
