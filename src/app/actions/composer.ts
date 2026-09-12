"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { generatePostVariants, type AiUsage } from "@/lib/ai";
import { loadBrandContextByBrand } from "@/lib/brand";
import { parseAttachments, type AttachedMedia } from "@/lib/posts";
import {
  createAndPublishPost,
  deletePost as deletePostRecord,
  saveDraftPost,
  schedulePost,
} from "./publish";
import {
  GOALS,
  LENGTHS,
  TONES,
  type Goal,
  type PostLength,
  type PostVariant,
  type Tone,
} from "@/lib/ai-prompts";

// ============================================================
// Tuần 3 — AI viết nội dung
// ============================================================

export type GenerateState = {
  ok?: boolean;
  error?: string;
  message?: string;
  variants?: PostVariant[];
  model?: string;
  usage?: AiUsage;
} | null;

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

function pick<T extends string>(
  value: string,
  allowed: { value: T }[],
  fallback: T
): T {
  return allowed.some((o) => o.value === value) ? (value as T) : fallback;
}

/** Sinh 2–3 phương án nội dung từ chủ đề + tùy chọn giọng điệu/độ dài. */
export async function generateContent(
  _prev: GenerateState,
  formData: FormData
): Promise<GenerateState> {
  const user = await requireCurrentUser();

  const topic = str(formData, "topic");
  if (!topic) return { ok: false, error: "Vui lòng nhập chủ đề bài đăng." };
  if (topic.length < 5) {
    return { ok: false, error: "Chủ đề quá ngắn — nhập rõ hơn để AI viết đúng ý bạn." };
  }

  const variantCount = Number(str(formData, "variantCount")) || 3;

  // "Viết theo thương hiệu": nạp hồ sơ + trụ cột + tài liệu của brand được chọn
  // (sai workspace / brand không tồn tại → trả undefined, AI viết generic như cũ).
  const brandId = str(formData, "brandId");
  const brand = brandId
    ? await loadBrandContextByBrand(user.id, brandId, { focus: topic })
    : undefined;

  const res = await generatePostVariants({
    userId: user.id,
    topic,
    tone: pick<Tone>(str(formData, "tone"), TONES, "friendly"),
    goal: pick<Goal>(str(formData, "goal"), GOALS, "engagement"),
    length: pick<PostLength>(str(formData, "length"), LENGTHS, "medium"),
    audience: str(formData, "audience"),
    keywords: str(formData, "keywords"),
    pageName: str(formData, "pageName"),
    brand,
    variantCount,
  });

  if (!res.ok) return { ok: false, error: res.error };

  return {
    ok: true,
    message: `AI đã viết ${res.variants.length} phương án — chọn một phương án để dùng.`,
    variants: res.variants,
    model: res.model,
    usage: res.usage,
  };
}

// ============================================================
// Lưu nháp / đăng bài (một form, phân biệt bằng name="intent")
// ============================================================

export type SubmitState = {
  ok?: boolean;
  error?: string;
  message?: string;
  permalink?: string;
  /** "draft" | "publish" | "schedule" — để UI hiển thị thông báo phù hợp. */
  kind?: string;
} | null;

export async function submitPost(
  _prev: SubmitState,
  formData: FormData
): Promise<SubmitState> {
  const user = await requireCurrentUser();

  const rawIntent = str(formData, "intent");
  const intent =
    rawIntent === "draft" ? "draft" : rawIntent === "schedule" ? "schedule" : "publish";

  const input = {
    pageId: str(formData, "pageId"),
    content: str(formData, "content"),
    hashtags: str(formData, "hashtags"),
    attachments: parseAttachments(String(formData.get("media") ?? "")),
  };

  if (intent === "draft") {
    const outcome = await saveDraftPost(user.id, input);
    if (!outcome.ok) return { ok: false, error: outcome.error };
    return { ok: true, kind: "draft", message: "Đã lưu nháp — xem ở cột bên phải." };
  }

  if (intent === "schedule") {
    // <input type="datetime-local"> gửi chuỗi dạng "2026-03-15T20:00" (giờ địa
    // phương của người dùng). Đổi sang Date theo giờ máy chủ.
    const raw = str(formData, "scheduledAt");
    if (!raw) {
      return { ok: false, error: "Chưa chọn thời gian hẹn đăng." };
    }
    const scheduledAt = new Date(raw);
    const outcome = await schedulePost(user.id, input, scheduledAt);
    if (!outcome.ok) return { ok: false, error: outcome.error };
    return { ok: true, kind: "schedule", message: outcome.message };
  }

  const outcome = await createAndPublishPost(user.id, input);
  if (!outcome.ok) return { ok: false, error: outcome.error };
  return {
    ok: true,
    kind: "publish",
    message: outcome.message,
    permalink: outcome.permalink,
  };
}

/** Xóa một bài (nháp hoặc đã đăng). */
export async function removePost(postId: string): Promise<void> {
  await deletePostRecord(postId);
  revalidatePath("/composer");
}

/** Nạp lại nội dung một nháp đã lưu vào composer (dùng cho nút "Sửa"). */
export async function loadDraft(postId: string): Promise<{
  content: string;
  hashtags: string;
  pageId: string;
  attachments: AttachedMedia[];
} | null> {
  const user = await requireCurrentUser();
  const post = await prisma.post.findFirst({
    where: { id: postId, userId: user.id },
    include: { media: { orderBy: { position: "asc" } } },
  });
  if (!post) return null;
  return {
    content: post.content,
    hashtags: post.hashtags ?? "",
    pageId: post.pageId ?? "",
    attachments: post.media.map((m) => ({
      remoteUrl: m.remoteUrl,
      previewUrl: m.previewUrl ?? undefined,
      type: m.type === "VIDEO" ? ("VIDEO" as const) : ("IMAGE" as const),
      source:
        m.source === "PEXELS"
          ? ("PEXELS" as const)
          : m.source === "UPLOAD"
            ? ("UPLOAD" as const)
            : ("URL" as const),
      providerId: m.providerId ?? undefined,
      photographer: m.photographer ?? undefined,
      photographerUrl: m.photographerUrl ?? undefined,
      sourcePageUrl: m.sourcePageUrl ?? undefined,
      alt: m.alt ?? undefined,
      width: m.width ?? undefined,
      height: m.height ?? undefined,
      duration: m.duration ?? undefined,
    })),
  };
}
