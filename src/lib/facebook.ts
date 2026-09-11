import "server-only";

import { getSetting } from "./settings";
import { prisma } from "./prisma";

// ============================================================
// Facebook Graph API client (server-only)
// Docs: https://developers.facebook.com/docs/graph-api/
// ============================================================

/**
 * Base URL của Graph API. Mặc định là Facebook thật; có thể trỏ về server
 * giả khi chạy test E2E (đặt biến môi trường FB_GRAPH_BASE_URL).
 */
const GRAPH_BASE = process.env.FB_GRAPH_BASE_URL ?? "https://graph.facebook.com";

export type GraphPage = {
  id: string;
  name: string;
  access_token: string; // Page access token
  category: string;
  picture?: { data: { url: string } };
};

export class FacebookApiError extends Error {
  code: number | undefined;
  fbTraceId: string | undefined;

  constructor(message: string, code?: number, fbTraceId?: string) {
    super(message);
    this.name = "FacebookApiError";
    this.code = code;
    this.fbTraceId = fbTraceId;
  }
}

/**
 * Gọi Graph API.
 * - GET  → tham số đưa vào query string.
 * - POST → tham số đưa vào body (form-urlencoded), đúng chuẩn Graph API cho
 *          các thao tác ghi (đăng bài, upload ảnh...).
 */
async function fbFetch(
  path: string,
  accessToken: string,
  params: Record<string, string> = {},
  options: { method?: "GET" | "POST" } = {}
) {
  const version = (await getSetting("facebook.graphVersion")) ?? "v21.0";
  const method = options.method ?? "GET";
  const url = new URL(`${GRAPH_BASE}/${version}/${path}`);

  const init: RequestInit = { method };

  if (method === "GET") {
    url.searchParams.set("access_token", accessToken);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  } else {
    const body = new URLSearchParams({ ...params, access_token: accessToken });
    init.body = body;
    init.headers = { "Content-Type": "application/x-www-form-urlencoded" };
  }

  const res = await fetch(url.toString(), init);
  return parseGraphResponse(res);
}

/** Đọc response Graph API, ném FacebookApiError nếu có lỗi. */
async function parseGraphResponse(res: Response): Promise<Record<string, unknown>> {
  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new FacebookApiError(
      `Graph API trả về dữ liệu không phải JSON (HTTP ${res.status}).`
    );
  }

  if (!res.ok || data.error) {
    const err = data.error as Record<string, unknown> | undefined;
    throw new FacebookApiError(
      String(err?.message ?? `Graph API trả về mã ${res.status}`),
      typeof err?.code === "number" ? err.code : undefined,
      typeof err?.fbtrace_id === "string" ? err.fbtrace_id : undefined
    );
  }
  return data;
}

/** URL Graph API đầy đủ cho một path (dùng cho multipart). */
async function graphUrl(path: string): Promise<string> {
  const version = (await getSetting("facebook.graphVersion")) ?? "v21.0";
  return `${GRAPH_BASE}/${version}/${path}`;
}

/** Đổi short-lived user token (2h) sang long-lived (~60 ngày) cùng ngày hết hạn. */
export async function exchangeForLongLivedToken(shortToken: string): Promise<{
  accessToken: string;
  expiresInSeconds: number;
}> {
  const appId = await getSetting("facebook.appId");
  const appSecret = await getSetting("facebook.appSecret");
  if (!appId || !appSecret) {
    throw new FacebookApiError("Chưa cấu hình FACEBOOK_APP_ID / APP_SECRET.");
  }

  const version = (await getSetting("facebook.graphVersion")) ?? "v21.0";
  const url = new URL(`${GRAPH_BASE}/${version}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("fb_exchange_token", shortToken);

  const res = await fetch(url.toString());
  const data = (await res.json()) as Record<string, unknown>;

  if (!res.ok || data.error) {
    const err = data.error as Record<string, unknown> | undefined;
    throw new FacebookApiError(
      String(err?.message ?? `Đổi token thất bại mã ${res.status}`),
      typeof err?.code === "number" ? err.code : undefined
    );
  }

  return {
    accessToken: String(data.access_token),
    expiresInSeconds: Number(data.expires_in ?? 0),
  };
}

/** Lấy danh sách Pages do user quản lý (kèm Page access token). */
export async function fetchUserPages(userAccessToken: string): Promise<GraphPage[]> {
  const data = (await fbFetch("me/accounts", userAccessToken, {
    fields: "id,name,category,access_token,picture.type(normal)",
    limit: "100",
  })) as { data?: GraphPage[] };
  return data.data ?? [];
}

/**
 * Sync danh sách Pages vào DB cho user: upsert theo fbPageId.
 * - Page mới → tạo mới.
 * - Page cũ → cập nhật tên/category/avatar/token.
 * Trả về số lượng page.
 */
export async function syncPagesToDb(
  userId: string,
  userAccessToken: string,
  expiresInSeconds?: number
): Promise<number> {
  const pages = await fetchUserPages(userAccessToken);
  const expiresAt =
    expiresInSeconds && expiresInSeconds > 0
      ? new Date(Date.now() + expiresInSeconds * 1000)
      : null;

  for (const page of pages) {
    await prisma.facebookPage.upsert({
      where: { fbPageId: page.id },
      update: {
        userId,
        name: page.name,
        category: page.category ?? null,
        avatarUrl: page.picture?.data?.url ?? null,
        accessToken: page.access_token,
        tokenExpiresAt: expiresAt,
        isActive: true,
      },
      create: {
        userId,
        fbPageId: page.id,
        name: page.name,
        category: page.category ?? null,
        avatarUrl: page.picture?.data?.url ?? null,
        accessToken: page.access_token,
        tokenExpiresAt: expiresAt,
        isActive: true,
      },
    });
  }

  return pages.length;
}

export type PostResult = { success: true; fbPostId: string };

/** Đăng bài text-only lên Page. POST /{page-id}/feed */
export async function publishTextToPage(
  page: { fbPageId: string; accessToken: string },
  message: string
): Promise<string> {
  const data = (await fbFetch(
    `${page.fbPageId}/feed`,
    page.accessToken,
    { message },
    { method: "POST" }
  )) as { id: string };
  return data.id;
}

/** Đăng bài 1 ảnh lên Page. POST /{page-id}/photos (url=remote image) */
export async function publishPhotoToPage(
  page: { fbPageId: string; accessToken: string },
  message: string,
  imageUrl: string
): Promise<string> {
  const data = (await fbFetch(
    `${page.fbPageId}/photos`,
    page.accessToken,
    { url: imageUrl, caption: message, published: "true" },
    { method: "POST" }
  )) as { id: string };
  return data.id;
}

/** Đăng 1 video lên Page từ URL công khai. POST /{page-id}/videos với file_url. */
export async function publishVideoToPage(
  page: { fbPageId: string; accessToken: string },
  description: string,
  videoUrl: string
): Promise<string> {
  const data = (await fbFetch(
    `${page.fbPageId}/videos`,
    page.accessToken,
    { description, file_url: videoUrl },
    { method: "POST" }
  )) as { id: string };
  return data.id;
}

/**
 * Đăng video bằng cách TẢI FILE từ máy lên Graph API.
 * POST /{page-id}/videos dạng multipart/form-data với trường `source`.
 *
 * Dùng fs.openAsBlob để stream từ đĩa — không nạp cả video vào RAM,
 * nên file vài trăm MB vẫn đăng được.
 */
export async function uploadVideoToPage(
  page: { fbPageId: string; accessToken: string },
  description: string,
  filePath: string,
  fileName: string,
  mimeType: string
): Promise<string> {
  const { openAsBlob } = await import("node:fs");
  const blob = await openAsBlob(filePath, { type: mimeType });

  const form = new FormData();
  form.set("access_token", page.accessToken);
  form.set("description", description);
  form.set("source", blob, fileName);

  const url = await graphUrl(`${page.fbPageId}/videos`);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      body: form,
      // Video lớn có thể mất nhiều phút
      signal: AbortSignal.timeout(15 * 60 * 1000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new FacebookApiError(
      /abort|timeout/i.test(message)
        ? "Tải video lên Facebook quá lâu (quá 15 phút) — thử file nhỏ hơn."
        : `Không gửi được video lên Facebook: ${message}`
    );
  }

  const data = (await parseGraphResponse(res)) as { id: string };
  return data.id;
}

/** Đăng nhiều ảnh (tối đa 4) — flow: upload unpublished ảnh, rồi /feed kèm attached_media. */
export async function publishMultiPhotosToPage(
  page: { fbPageId: string; accessToken: string },
  message: string,
  imageUrls: string[]
): Promise<string> {
  if (imageUrls.length === 0) throw new FacebookApiError("Cần ít nhất 1 ảnh.");
  if (imageUrls.length === 1) return publishPhotoToPage(page, message, imageUrls[0]);

  // Bước 1: upload ảnh unpublished
  const photoIds: string[] = [];
  for (const url of imageUrls.slice(0, 4)) {
    const data = (await fbFetch(
      `${page.fbPageId}/photos`,
      page.accessToken,
      { url, published: "false" },
      { method: "POST" }
    )) as { id: string };
    photoIds.push(data.id);
  }

  // Bước 2: đăng feed kèm attached_media
  const params: Record<string, string> = { message };
  photoIds.forEach((id, i) => {
    params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
  });
  const data = (await fbFetch(
    `${page.fbPageId}/feed`,
    page.accessToken,
    params,
    { method: "POST" }
  )) as { id: string };
  return data.id;
}
