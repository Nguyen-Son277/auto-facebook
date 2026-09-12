"use server";

import { revalidatePath } from "next/cache";
import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { suggestMediaKeywords } from "@/lib/ai";
import { curatedMedia, getPexelsQuota, searchMedia } from "@/lib/pexels";
import { getPexelsConfig } from "@/lib/settings";
import type {
  KeywordState,
  LibraryState,
  MediaSearchState,
  MediaType,
} from "@/lib/pexels-types";

// ============================================================
// Tuần 4 — Tìm media Pexels & thư viện ảnh
// ============================================================

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

/** Tìm ảnh/video trên Pexels. Bỏ trống từ khóa → trả về danh sách phổ biến. */
export async function searchPexelsMedia(
  _prev: MediaSearchState,
  formData: FormData
): Promise<MediaSearchState> {
  await requireCurrentUser();

  const query = str(formData, "query");
  const mediaType: MediaType = str(formData, "mediaType") === "VIDEO" ? "VIDEO" : "IMAGE";
  const page = Math.max(Number(str(formData, "page")) || 1, 1);

  const res = query
    ? await searchMedia({ query, type: mediaType, page, perPage: 12 })
    : await curatedMedia(mediaType, 12);

  if (!res.ok) return { ok: false, error: res.error, mediaType, keyword: query };

  return {
    ok: true,
    items: res.items,
    keyword: query,
    mediaType,
    page: res.page,
    hasNextPage: res.hasNextPage,
    totalResults: res.totalResults,
    cached: res.cached,
    curated: !query,
  };
}

/** Dùng AI đọc nội dung bài đăng để gợi ý từ khóa tìm ảnh. */
export async function suggestKeywords(
  _prev: KeywordState,
  formData: FormData
): Promise<KeywordState> {
  await requireCurrentUser();

  const content = str(formData, "content");
  // Context thương hiệu (từ composer) — giúp AI gợi ý từ khóa bám ngành hàng
  // thay vì từ khóa chung chung. Form cũ không gửi → context rỗng như trước.
  const res = await suggestMediaKeywords(content, 6, {
    industry: str(formData, "industry"),
    products: str(formData, "products"),
  });
  if (!res.ok) return { ok: false, error: res.error };

  return {
    ok: true,
    keywords: res.keywords,
    error:
      res.keywords.length === 0 ? "AI không gợi ý được từ khóa nào." : undefined,
  };
}

/**
 * Lưu một ảnh/video Pexels vào thư viện cá nhân.
 * Nhận JSON của item qua hidden input "item" (do client gửi lên).
 */
export async function saveToLibrary(
  _prev: LibraryState,
  formData: FormData
): Promise<LibraryState> {
  const user = await requireCurrentUser();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(String(formData.get("item") ?? "")) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "Dữ liệu media không hợp lệ." };
  }

  const remoteUrl = String(parsed.remoteUrl ?? "").trim();
  if (!remoteUrl) return { ok: false, error: "Media thiếu URL file." };

  const providerId = String(parsed.id ?? parsed.providerId ?? "").trim() || null;
  const type = parsed.type === "VIDEO" ? "VIDEO" : "IMAGE";

  // Chống trùng: cùng provider + cùng providerId thì không lưu lại
  if (providerId) {
    const existing = await prisma.media.findFirst({
      where: { userId: user.id, postId: null, providerId },
      select: { id: true },
    });
    if (existing) {
      return { ok: true, message: "Media này đã có trong thư viện." };
    }
  }

  await prisma.media.create({
    data: {
      userId: user.id,
      postId: null,
      type,
      source: "PEXELS",
      remoteUrl,
      previewUrl: String(parsed.previewUrl ?? "") || null,
      width: typeof parsed.width === "number" ? parsed.width : null,
      height: typeof parsed.height === "number" ? parsed.height : null,
      duration: typeof parsed.duration === "number" ? parsed.duration : null,
      providerId,
      photographer: String(parsed.photographer ?? "") || null,
      photographerUrl: String(parsed.photographerUrl ?? "") || null,
      sourcePageUrl: String(parsed.pageUrl ?? parsed.sourcePageUrl ?? "") || null,
      alt: String(parsed.alt ?? "") || null,
    },
  });

  revalidatePath("/media");
  return {
    ok: true,
    message: type === "VIDEO" ? "Đã lưu video vào thư viện." : "Đã lưu ảnh vào thư viện.",
  };
}

/** Xóa một media khỏi thư viện. */
export async function deleteLibraryMedia(mediaId: string): Promise<void> {
  const user = await requireCurrentUser();
  await prisma.media.deleteMany({
    where: { id: mediaId, userId: user.id, postId: null },
  });
  revalidatePath("/media");
}

export type PexelsStatus = {
  configured: boolean;
  quotaUsed: number;
  quotaLimit: number;
  libraryCount: number;
};

/** Trạng thái tích hợp Pexels để hiển thị ở đầu trang. */
export async function getPexelsStatus(): Promise<PexelsStatus> {
  const user = await requireCurrentUser();
  const { apiKey } = await getPexelsConfig();
  const libraryCount = await prisma.media.count({
    where: { userId: user.id, postId: null },
  });
  const quota = getPexelsQuota();
  return {
    configured: Boolean(apiKey),
    quotaUsed: quota.used,
    quotaLimit: quota.limit,
    libraryCount,
  };
}
