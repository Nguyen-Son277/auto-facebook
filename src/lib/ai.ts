import "server-only";

import { getAiConfig } from "./settings";
import {
  buildKeywordMessages,
  buildPostMessages,
  parseMediaKeywords,
  parseVariants,
  type ChatMessage,
  type GenerateInput,
  type KeywordContext,
  type MediaKeyword,
  type PostVariant,
} from "./ai-prompts";

// ============================================================
// AI provider helper
//  - fetchAiModels: tải danh sách model từ {baseUrl}/models
//  - chatCompletion: gọi {baseUrl}/chat/completions
//  - generatePostVariants: sinh 2–3 phương án nội dung bài đăng
// ============================================================

export type AiModelsResult = {
  ok: boolean;
  models: string[];
  count: number;
  error?: string;
};

export type AiUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type ChatResult = {
  ok: boolean;
  content: string;
  model: string;
  usage?: AiUsage;
  error?: string;
};

/** Lỗi cấu hình dùng chung để thông báo cho người dùng biết cần vào Cài đặt. */
export const AI_NOT_CONFIGURED =
  "Chưa cấu hình AI Provider — vào trang Cài đặt để nhập Base URL + API Key và chọn model.";

export async function fetchAiModels(input?: {
  baseUrl?: string | null;
  apiKey?: string | null;
}): Promise<AiModelsResult> {
  const saved = await getAiConfig();
  const baseUrl = (input?.baseUrl?.trim() || saved.baseUrl || "").replace(/\/+$/, "");
  const apiKey = input?.apiKey?.trim() || saved.apiKey || "";

  if (!baseUrl) {
    return { ok: false, models: [], count: 0, error: "Chưa có Base URL." };
  }
  if (!apiKey) {
    return { ok: false, models: [], count: 0, error: "Chưa có API Key." };
  }

  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const body = await res.text();
      return {
        ok: false,
        models: [],
        count: 0,
        error: `Provider trả về ${res.status} khi tải danh sách model. ${body.slice(0, 200)}`,
      };
    }

    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    const models = Array.from(
      new Set(
        (data.data ?? [])
          .map((m) => m?.id)
          .filter((id): id is string => Boolean(id))
      )
    ).sort((a, b) => a.localeCompare(b));

    if (models.length === 0) {
      return {
        ok: false,
        models: [],
        count: 0,
        error: "Provider không trả về model nào — kiểm tra lại Base URL và API Key.",
      };
    }

    return { ok: true, models, count: models.length };
  } catch (err) {
    return {
      ok: false,
      models: [],
      count: 0,
      error: `Không tải được model từ ${baseUrl}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

// ============================================================
// Chat completion
// ============================================================

function readUsage(raw: unknown): AiUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  return {
    promptTokens: num(u.prompt_tokens),
    completionTokens: num(u.completion_tokens),
    totalTokens: num(u.total_tokens),
  };
}

/** Lấy nội dung text từ response chat/completions (chịu được vài biến thể). */
function readContent(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const choices = (raw as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const first = choices[0] as Record<string, unknown>;
  const message = first?.message as Record<string, unknown> | undefined;
  const fromMessage = message?.content;
  if (typeof fromMessage === "string") return fromMessage;
  // Một số provider trả content dạng mảng block
  if (Array.isArray(fromMessage)) {
    return fromMessage
      .map((b) =>
        typeof b === "string"
          ? b
          : typeof (b as Record<string, unknown>)?.text === "string"
            ? String((b as Record<string, unknown>).text)
            : ""
      )
      .join("");
  }
  if (typeof first?.text === "string") return first.text;
  return "";
}

/**
 * Gọi {baseUrl}/chat/completions.
 *
 * Tham số `temperature`/`maxTokens` là tùy chọn: một số model mới (reasoning)
 * từ chối các tham số này, nên nếu provider trả 400 vì lý do đó thì tự động
 * thử lại một lần mà không gửi chúng.
 */
export async function chatCompletion(input: {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}): Promise<ChatResult> {
  const { baseUrl, apiKey, model } = await getAiConfig();
  const url = (baseUrl ?? "").replace(/\/+$/, "");

  if (!url || !apiKey) {
    return { ok: false, content: "", model: model ?? "", error: AI_NOT_CONFIGURED };
  }
  if (!model) {
    return {
      ok: false,
      content: "",
      model: "",
      error: "Chưa chọn model — vào trang Cài đặt để tải danh sách model và chọn một model.",
    };
  }

  const buildBody = (withTuning: boolean) => {
    const body: Record<string, unknown> = { model, messages: input.messages };
    if (withTuning && typeof input.temperature === "number") {
      body.temperature = input.temperature;
    }
    if (withTuning && typeof input.maxTokens === "number") {
      body.max_tokens = input.maxTokens;
    }
    return JSON.stringify(body);
  };

  const call = async (withTuning: boolean) =>
    fetch(`${url}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: buildBody(withTuning),
      signal: AbortSignal.timeout(120_000),
    });

  try {
    let res = await call(true);
    let bodyText = await res.text();

    // Provider từ chối temperature/max_tokens → thử lại không kèm tham số đó
    if (
      !res.ok &&
      res.status === 400 &&
      (input.temperature !== undefined || input.maxTokens !== undefined) &&
      /max_tokens|temperature|unsupported|not supported/i.test(bodyText)
    ) {
      res = await call(false);
      bodyText = await res.text();
    }

    if (!res.ok) {
      return {
        ok: false,
        content: "",
        model,
        error: `Model "${model}" trả về lỗi ${res.status}. ${bodyText.slice(0, 300)}`,
      };
    }

    let data: unknown;
    try {
      data = JSON.parse(bodyText);
    } catch {
      return {
        ok: false,
        content: "",
        model,
        error: `Provider trả về dữ liệu không phải JSON: ${bodyText.slice(0, 200)}`,
      };
    }

    const content = readContent(data).trim();
    if (!content) {
      return {
        ok: false,
        content: "",
        model,
        error: "Model trả về nội dung rỗng — thử lại hoặc đổi model khác.",
      };
    }

    return {
      ok: true,
      content,
      model,
      usage: readUsage((data as Record<string, unknown>)?.usage),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      content: "",
      model,
      error: /abort|timeout/i.test(message)
        ? "Model phản hồi quá lâu (quá 120 giây) — thử lại hoặc chọn model nhanh hơn."
        : `Không gọi được AI Provider: ${message}`,
    };
  }
}

// ============================================================
// Sinh nội dung bài đăng
// ============================================================

export type GeneratePostResult = {
  ok: boolean;
  variants: PostVariant[];
  model?: string;
  usage?: AiUsage;
  error?: string;
};

export async function generatePostVariants(
  input: GenerateInput
): Promise<GeneratePostResult> {
  if (!input.topic.trim()) {
    return { ok: false, variants: [], error: "Vui lòng nhập chủ đề bài đăng." };
  }

  const res = await chatCompletion({
    messages: buildPostMessages(input),
    temperature: 0.8,
  });

  if (!res.ok) return { ok: false, variants: [], error: res.error };

  const variants = parseVariants(res.content);
  if (variants.length === 0) {
    return {
      ok: false,
      variants: [],
      error: "Không đọc được nội dung model trả về — thử bấm sinh lại.",
    };
  }

  return {
    ok: true,
    variants,
    model: res.model,
    usage: res.usage,
  };
}

// ============================================================
// Gợi ý từ khóa tìm ảnh/video từ nội dung bài đăng
// ============================================================

export type SuggestKeywordsResult = {
  ok: boolean;
  keywords: MediaKeyword[];
  model?: string;
  error?: string;
};

export async function suggestMediaKeywords(
  content: string,
  count = 6,
  context: KeywordContext = {}
): Promise<SuggestKeywordsResult> {
  const text = content.trim();
  if (text.length < 10) {
    return {
      ok: false,
      keywords: [],
      error: "Cần ít nhất 10 ký tự nội dung để AI gợi ý từ khóa tìm ảnh.",
    };
  }

  const res = await chatCompletion({
    messages: buildKeywordMessages(text, count, context),
    temperature: 0.4,
  });

  if (!res.ok) return { ok: false, keywords: [], error: res.error };

  const keywords = parseMediaKeywords(res.content);
  if (keywords.length === 0) {
    return {
      ok: false,
      keywords: [],
      error: "Không đọc được từ khóa AI trả về — thử bấm gợi ý lại.",
    };
  }

  return { ok: true, keywords, model: res.model };
}
