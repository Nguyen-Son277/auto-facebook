import "server-only";

import { decryptValue, getSetting } from "./settings";
import { prisma } from "./prisma";

// ============================================================
// Facebook Graph API client (server-only)
// Docs: https://developers.facebook.com/docs/graph-api/
//
// ĐA CONNECTION: mỗi hàm gọi Graph nhận graphVersion + appId/appSecret
// từ FacebookConnection của Page (xem lib/facebook-connection.ts), thay
// vì đọc cấu hình toàn cục. Mọi publish* nhận `conn` (graph version) để
// dùng đúng phiên bản API của App đã cấp token cho Page đó.
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

/** Cấu hình Graph API cần cho một lệnh gọi — lấy từ FacebookConnection. */
export type GraphContext = {
  appId?: string | null;
  appSecret?: string | null;
  graphVersion?: string | null;
};

export class FacebookApiError extends Error {
  code: number | undefined;
  /**
   * Mã phụ của Graph API. Cần thiết vì nhiều lỗi QUAN TRỌNG dùng chung code
   * thô: `invalid metric` là code 3001 + subcode 1504028, còn code 100 vừa là
   * "object không tồn tại" vừa là nhiều lỗi tham số khác nhau. Không có subcode
   * thì không phân biệt được để chọn cách lùi đúng (xem lib/insights-core.ts).
   */
  subcode: number | undefined;
  fbTraceId: string | undefined;

  constructor(message: string, code?: number, fbTraceId?: string, subcode?: number) {
    super(message);
    this.name = "FacebookApiError";
    this.code = code;
    this.fbTraceId = fbTraceId;
    this.subcode = subcode;
  }
}

/** Graph version hiệu dụng: ưu tiên conn, fallback AppSetting rồi v21.0. */
async function effectiveVersion(conn?: GraphContext | null): Promise<string> {
  if (conn?.graphVersion) return conn.graphVersion;
  return (await getSetting("facebook.graphVersion")) ?? "v21.0";
}

/**
 * Gọi Graph API.
 * - GET  → tham số đưa vào query string.
 * - POST → tham số đưa vào body (form-urlencoded), đúng chuẩn Graph API cho
 *          các thao tác ghi (đăng bài, upload ảnh...).
 *
 * Export để module Insights (lib/fb-insights.ts) dùng CHUNG một client: nhờ vậy
 * nó thừa hưởng nguyên phần xử lý lỗi (FacebookApiError có code + subcode) và
 * cách chọn graph version theo connection của Page — không viết lại lần hai.
 */
export async function fbFetch(
  path: string,
  accessToken: string,
  params: Record<string, string> = {},
  options: { method?: "GET" | "POST"; conn?: GraphContext | null } = {}
) {
  const version = await effectiveVersion(options.conn);
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
      typeof err?.fbtrace_id === "string" ? err.fbtrace_id : undefined,
      // error_subcode là trường riêng của Graph API, không nằm trong message
      typeof err?.error_subcode === "number" ? err.error_subcode : undefined
    );
  }
  return data;
}

/** URL Graph API đầy đủ cho một path (dùng cho multipart). */
async function graphUrl(path: string, conn?: GraphContext | null): Promise<string> {
  const version = await effectiveVersion(conn);
  return `${GRAPH_BASE}/${version}/${path}`;
}

/** Đổi short-lived user token (2h) sang long-lived (~60 ngày) cùng ngày hết hạn. */
export async function exchangeForLongLivedToken(
  shortToken: string,
  conn?: GraphContext | null
): Promise<{
  accessToken: string;
  expiresInSeconds: number;
}> {
  let appId = conn?.appId ?? null;
  let appSecret = conn?.appSecret ?? null;
  if (!appId || !appSecret) {
    appId = await getSetting("facebook.appId");
    appSecret = await getSetting("facebook.appSecret");
  }
  if (!appId || !appSecret) {
    throw new FacebookApiError("Chưa cấu hình App ID / App Secret cho connection.");
  }

  const version = await effectiveVersion(conn);
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
export async function fetchUserPages(
  userAccessToken: string,
  conn?: GraphContext | null
): Promise<GraphPage[]> {
  const data = (await fbFetch("me/accounts", userAccessToken, {
    fields: "id,name,category,access_token,picture.type(normal)",
    limit: "100",
  }, { conn })) as { data?: GraphPage[] };
  return data.data ?? [];
}

/**
 * Sync danh sách Pages vào DB **theo connection của workspace**:
 * upsert theo (workspaceId, fbPageId).
 * - Page mới → tạo mới, gắn connectionId.
 * - Page cũ → cập nhật tên/category/avatar/token, KHÔNG đổi connectionId
 *   (trừ khi fbPageId chưa từng có trong workspace này).
 *
 * Lưu ý: nếu cùng một Page xuất hiện qua connection khác trong cùng
 * workspace, unique (workspaceId, fbPageId) giữ nguyên bản ghi gốc —
 * không tạo trùng. Người dùng chuyển connection qua action riêng.
 */
export async function syncPagesToDb(
  userId: string,
  workspaceId: string,
  connectionId: string,
  userAccessToken: string,
  expiresInSeconds?: number
): Promise<number> {
  const conn = await prisma.facebookConnection.findUnique({ where: { id: connectionId } });
  if (!conn || conn.workspaceId !== workspaceId) {
    throw new Error("Connection không thuộc workspace này.");
  }

  const graphCtx: GraphContext = {
    appId: decryptValue(conn.appId),
    appSecret: decryptValue(conn.appSecret),
    graphVersion: decryptValue(conn.graphVersion) || "v21.0",
  };

  const pages = await fetchUserPages(userAccessToken, graphCtx);
  const expiresAt =
    expiresInSeconds && expiresInSeconds > 0
      ? new Date(Date.now() + expiresInSeconds * 1000)
      : null;

  for (const page of pages) {
    await prisma.facebookPage.upsert({
      where: { workspaceId_fbPageId: { workspaceId, fbPageId: page.id } },
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
        workspaceId,
        connectionId,
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
  message: string,
  conn?: GraphContext | null
): Promise<string> {
  const data = (await fbFetch(
    `${page.fbPageId}/feed`,
    page.accessToken,
    { message },
    { method: "POST", conn }
  )) as { id: string };
  return data.id;
}

/** Đăng bài 1 ảnh lên Page. POST /{page-id}/photos (url=remote image) */
export async function publishPhotoToPage(
  page: { fbPageId: string; accessToken: string },
  message: string,
  imageUrl: string,
  conn?: GraphContext | null
): Promise<string> {
  const data = (await fbFetch(
    `${page.fbPageId}/photos`,
    page.accessToken,
    { url: imageUrl, caption: message, published: "true" },
    { method: "POST", conn }
  )) as { id: string };
  return data.id;
}

/** Đăng 1 video lên Page từ URL công khai. POST /{page-id}/videos với file_url. */
export async function publishVideoToPage(
  page: { fbPageId: string; accessToken: string },
  description: string,
  videoUrl: string,
  conn?: GraphContext | null
): Promise<string> {
  const data = (await fbFetch(
    `${page.fbPageId}/videos`,
    page.accessToken,
    { description, file_url: videoUrl },
    { method: "POST", conn }
  )) as { id: string };
  return data.id;
}

/**
 * Đăng video bằng URL công khai (hoặc signed URL của Supabase Storage).
 *
 * Trên Vercel không có ổ đĩa bền nên KHÔNG còn đường upload multipart từ
 * file local: video được đưa cho Facebook dưới dạng `file_url` để Facebook
 * tự tải về (xem lib/deliver.ts).
 */

/**
 * Đăng nhiều ảnh (tối đa 4) — flow: upload unpublished ảnh, rồi /feed kèm attached_media.
 */
export async function publishMultiPhotosToPage(
  page: { fbPageId: string; accessToken: string },
  message: string,
  imageUrls: string[],
  conn?: GraphContext | null
): Promise<string> {
  if (imageUrls.length === 0) throw new FacebookApiError("Cần ít nhất 1 ảnh.");
  if (imageUrls.length === 1) return publishPhotoToPage(page, message, imageUrls[0], conn);

  // Bước 1: upload ảnh unpublished
  const photoIds: string[] = [];
  for (const url of imageUrls.slice(0, 4)) {
    const data = (await fbFetch(
      `${page.fbPageId}/photos`,
      page.accessToken,
      { url, published: "false" },
      { method: "POST", conn }
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
    { method: "POST", conn }
  )) as { id: string };
  return data.id;
}

// ============================================================
// UPLOAD BINARY (multipart/form-data)
//
// VÌ SAO CẦN
// Hai trường hợp Facebook KHÔNG thể tự tải ảnh qua `url`:
//   - Ảnh/video trong Google Drive riêng tư: `webContentLink` cần cookie phiên.
//   - File không có URL công khai nào để Facebook truy cập.
// Cách chắc chắn: chuyển chính nội dung tệp lên Graph API. Multi-photo thì
// upload `published=false` (unpublished) rồi /feed kèm attached_media; đúng
// luồng Facebook mô tả cho ảnh đã tải lên.
// ============================================================

/** Nội dung tệp để gửi kèm multipart. */
export type BinaryUpload = {
  data: Blob | ReadableStream<Uint8Array>;
  filename: string;
  mimeType: string;
  /** Byte, nếu biết — giúp Facebook xử lý nhanh hơn. */
  size?: number | null;
};

/**
 * Gọi Graph API bằng multipart/form-data (khác fbFetch vốn dùng
 * form-urlencoded). Không tự set Content-Type để fetch tự sinh boundary và
 * gửi theo dạng stream — nhờ vậy video lớn KHÔNG bị nạp hết vào RAM.
 */
async function fbUpload(
  path: string,
  accessToken: string,
  fields: Record<string, string>,
  fileField: string,
  file: BinaryUpload,
  conn?: GraphContext | null
): Promise<Record<string, unknown>> {
  const version = await effectiveVersion(conn);
  const form = new FormData();

  if (file.data instanceof Blob) {
    form.append(fileField, file.data, file.filename);
  } else {
    // Node 18+: ReadableStream phải bọc lại để undici gửi được theo luồng.
    const { Readable } = await import("node:stream");
    const nodeStream = Readable.fromWeb(file.data as Parameters<typeof Readable.fromWeb>[0]);
    form.append(
      fileField,
      new Blob([nodeStream as unknown as BlobPart], { type: file.mimeType }),
      file.filename
    );
  }

  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append("access_token", accessToken);

  const res = await fetch(`${GRAPH_BASE}/${version}/${path}`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  return parseGraphResponse(res);
}

/**
 * Upload ảnh dạng binary lên Page.
 *
 * `published = true` → đăng ngay thành bài 1 ảnh (POST /photos).
 * `published = false` → chỉ upload lấy photo id (để ghép bài nhiều ảnh).
 */
export async function publishPhotoBinaryToPage(
  page: { fbPageId: string; accessToken: string },
  file: BinaryUpload,
  options: { caption?: string; published: boolean; conn?: GraphContext | null } = {
    published: true,
  }
): Promise<string> {
  const fields: Record<string, string> = {
    published: options.published ? "true" : "false",
  };
  if (options.caption) fields.caption = options.caption;

  const data = (await fbUpload(
    `${page.fbPageId}/photos`,
    page.accessToken,
    fields,
    "source",
    file,
    options.conn
  )) as { id?: string };

  if (!data.id) throw new FacebookApiError("Facebook không trả về ID ảnh sau khi tải lên.");
  return data.id;
}

/** Upload video dạng binary lên Page (POST /videos với field `source`). */
export async function publishVideoBinaryToPage(
  page: { fbPageId: string; accessToken: string },
  file: BinaryUpload,
  options: { description?: string; conn?: GraphContext | null } = {}
): Promise<string> {
  const fields: Record<string, string> = {};
  if (options.description) fields.description = options.description;

  const data = (await fbUpload(
    `${page.fbPageId}/videos`,
    page.accessToken,
    fields,
    "source",
    file,
    options.conn
  )) as { id?: string };

  if (!data.id) throw new FacebookApiError("Facebook không trả về ID video sau khi tải lên.");
  return data.id;
}

/**
 * Ghép nhiều ảnh đã upload unpublished thành một bài feed.
 * Tách riêng để dùng chung cho cả đường URL và đường binary.
 */
export async function publishFeedWithPhotoIds(
  page: { fbPageId: string; accessToken: string },
  message: string,
  photoIds: string[],
  conn?: GraphContext | null
): Promise<string> {
  const params: Record<string, string> = { message };
  photoIds.forEach((id, i) => {
    params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
  });
  const data = (await fbFetch(`${page.fbPageId}/feed`, page.accessToken, params, {
    method: "POST",
    conn,
  })) as { id: string };
  return data.id;
}
