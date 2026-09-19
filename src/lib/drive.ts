import "server-only";

import { prisma } from "./prisma";
import { decryptValue, encryptValue } from "./settings";
import {
  IMAGE_MIMES,
  VIDEO_MIMES,
  isSupportedMime,
  mapDriveFiles,
  mapDriveFile,
  type DriveFile,
  type DriveFilePage,
} from "./drive-files";

// Phần thuần (MIME, đọc metadata Drive) nằm ở drive-files.ts để test độc lập.
export {
  isImageMime,
  isVideoMime,
  mediaKindFromMime,
  isSupportedMime,
  extensionForMime,
  safeFileName,
  mapDriveFile,
  mapDriveFiles,
} from "./drive-files";
export type { DriveFile, DriveFilePage } from "./drive-files";

// ============================================================
// GOOGLE DRIVE — nguồn media cá nhân (server-only).
//
// Luồng: người dùng bấm "Kết nối Drive" → OAuth authorization code (xem
// src/app/api/drive/*) → lưu refresh token (mã hóa AES-256-GCM) vào
// DriveConnection → các lần sau tự làm mới access token.
//
// VÌ SAO KHÔNG DÙNG SDK googleapis
// SDK kéo theo cả rừng dependency mà app chỉ cần 4 endpoint (oauth token,
// userinfo, files.list, files.get?alt=media). REST thuần bằng fetch giống
// cách lib/pexels.ts và lib/facebook.ts đang làm — ít phụ thuộc, dễ mock
// khi test (xem scripts/mock-drive-server.mjs).
//
// QUYỀN: scope "drive.file" là loại KHÔNG nhạy cảm (không cần Google duyệt)
// nhưng chỉ thấy file do app tạo hoặc do người dùng chọn qua Google Picker.
// Đó là lý do mỗi thương hiệu phải được gắn một thư mục cụ thể
// (BrandDriveFolder) thay vì app tự quét cả Drive.
// ============================================================

/** Scope tối thiểu: đọc/ghi file do người dùng chọn cho app. */
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/** Scope đầy đủ của app — email để hiển thị "đang nối tài khoản nào". */
export const DRIVE_SCOPES = [
  "openid",
  "email",
  "profile",
  DRIVE_FILE_SCOPE,
].join(" ");

/** Endpoint ghi đè được để test E2E (giống FB_GRAPH_BASE_URL, PEXELS_BASE_URL). */
const AUTH_URL = () =>
  process.env.GOOGLE_OAUTH_AUTH_URL ?? "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = () =>
  process.env.GOOGLE_OAUTH_TOKEN_URL ?? "https://oauth2.googleapis.com/token";
const DRIVE_API = () =>
  process.env.GOOGLE_DRIVE_API_URL ?? "https://www.googleapis.com/drive/v3";
// Giữ lại để tài liệu hóa endpoint có thể ghi đè khi test (hiện app đọc email
// từ id_token, không cần gọi endpoint này).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const USERINFO_URL = () =>
  process.env.GOOGLE_USERINFO_URL ?? "https://openidconnect.googleapis.com/v1/userinfo";

export function getDriveConfig() {
  return {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
    redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI ?? "",
  };
}

/** Đã đủ client id + secret để bắt đầu luồng OAuth chưa. */
export function isDriveConfigured(): boolean {
  const { clientId, clientSecret } = getDriveConfig();
  return Boolean(clientId && clientSecret);
}

/** Đã có Picker API key chưa (cần để người dùng chọn thư mục). */
export function isPickerConfigured(): boolean {
  return Boolean(process.env.GOOGLE_PICKER_API_KEY);
}

/** URL callback hiệu dụng — ưu tiên env, không thì suy ra từ origin của request. */
export function driveRedirectUri(origin?: string): string {
  const configured = getDriveConfig().redirectUri;
  if (configured) return configured;
  return origin ? `${origin}/api/drive/callback` : "";
}

/**
 * Đã xác định được redirect URI chưa.
 *
 * Cần kiểm tra TRƯỚC khi chuyển sang Google: nếu thiếu, Google chỉ hiện màn
 * hình "redirect_uri_mismatch" rất khó đoán nguyên nhân.
 */
export function hasDriveRedirect(origin?: string): boolean {
  return Boolean(driveRedirectUri(origin));
}

// ============================================================
// Lỗi
// ============================================================

export type DriveErrorCode =
  | "NOT_CONFIGURED"
  | "NEEDS_REAUTH"
  | "NO_PERMISSION"
  | "QUOTA"
  | "RATE_LIMIT"
  | "NOT_FOUND"
  | "HTTP"
  | "NETWORK";

export class DriveError extends Error {
  code: DriveErrorCode;
  status: number | undefined;
  /** Lỗi tạm thời (429/5xx/timeout) — gọi lại có thể thành công. */
  retryable: boolean;

  constructor(
    message: string,
    code: DriveErrorCode,
    options: { status?: number; retryable?: boolean } = {}
  ) {
    super(message);
    this.name = "DriveError";
    this.code = code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

/** Token bị thu hồi/hết hạn ⇒ phải bắt người dùng cấp quyền lại. */
export function needsReauth(err: unknown): boolean {
  return err instanceof DriveError && (err.code === "NEEDS_REAUTH" || err.code === "NO_PERMISSION");
}

/** Drive của người dùng đã hết dung lượng. */
export function isDriveFull(err: unknown): boolean {
  return err instanceof DriveError && err.code === "QUOTA";
}

/** Thông báo thân thiện cho người dùng cuối. */
export function driveErrorMessage(err: unknown): string {
  if (err instanceof DriveError) {
    switch (err.code) {
      case "NOT_CONFIGURED":
        return "Máy chủ chưa cấu hình Google Drive — liên hệ quản trị viên.";
      case "NEEDS_REAUTH":
        return "Kết nối Google Drive cần cấp quyền lại — vào Cài đặt rồi bấm “Cấp quyền lại”.";
      case "NO_PERMISSION":
        return "App chưa được cấp quyền với thư mục này — hãy chọn lại thư mục trên Drive.";
      case "QUOTA":
        return "Google Drive của bạn đã hết dung lượng hoặc vượt hạn mức API — dọn bớt file rồi thử lại.";
      case "RATE_LIMIT":
        return "Google Drive đang giới hạn truy cập — thử lại sau ít phút.";
      case "NOT_FOUND":
        return "Không tìm thấy tệp trên Google Drive (có thể đã bị xoá hoặc chuyển đi).";
      case "NETWORK":
        return "Không kết nối được Google Drive — kiểm tra mạng rồi thử lại.";
      default:
        return `Google Drive trả về lỗi: ${err.message}`;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

// ============================================================
// OAuth: đổi code lấy token, làm mới token
// ============================================================

export type DriveTokenSet = {
  accessToken: string;
  /** Có thể không có khi Google không trả refresh token (đã cấp trước đó). */
  refreshToken: string | null;
  /** Giây; 0 khi Google không trả. */
  expiresIn: number;
  scope: string | null;
  idToken: string | null;
};

function tokenRequestError(status: number, body: string): DriveError {
  // Google trả {"error":"invalid_grant"} khi refresh token bị thu hồi/hết hạn.
  if (body.includes("invalid_grant")) {
    return new DriveError(
      "Refresh token không còn hiệu lực (bị thu hồi hoặc quá hạn).",
      "NEEDS_REAUTH",
      { status }
    );
  }
  if (body.includes("invalid_client") || status === 401) {
    return new DriveError(
      "Google từ chối client id/secret — kiểm tra cấu hình OAuth.",
      "NOT_CONFIGURED",
      { status }
    );
  }
  return new DriveError(
    `Đổi token với Google thất bại (HTTP ${status}). ${body.slice(0, 200)}`,
    status === 429 ? "RATE_LIMIT" : "HTTP",
    { status, retryable: status >= 500 || status === 429 }
  );
}

/** POST tới token endpoint và chuẩn hóa kết quả. */
async function postToken(params: Record<string, string>): Promise<DriveTokenSet> {
  const { clientId, clientSecret } = getDriveConfig();
  if (!clientId || !clientSecret) {
    throw new DriveError(
      "Chưa cấu hình GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET.",
      "NOT_CONFIGURED"
    );
  }

  let res: Response;
  try {
    res = await fetch(TOKEN_URL(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...params, client_id: clientId, client_secret: clientSecret }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new DriveError(
      `Không gọi được Google: ${err instanceof Error ? err.message : String(err)}`,
      "NETWORK",
      { retryable: true }
    );
  }

  const text = await res.text();
  if (!res.ok) throw tokenRequestError(res.status, text);

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new DriveError("Google trả về dữ liệu token không phải JSON.", "HTTP");
  }

  return {
    accessToken: String(data.access_token ?? ""),
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
    expiresIn: Number(data.expires_in ?? 0),
    scope: typeof data.scope === "string" ? data.scope : null,
    idToken: typeof data.id_token === "string" ? data.id_token : null,
  };
}

/** Đổi authorization code (bước callback) lấy token. */
export async function exchangeDriveCode(code: string, origin?: string): Promise<DriveTokenSet> {
  return postToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: driveRedirectUri(origin),
  });
}

/** Làm mới access token từ refresh token. */
export async function refreshDriveToken(refreshToken: string): Promise<DriveTokenSet> {
  return postToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

/**
 * Giải mã payload của id_token để lấy email.
 * KHÔNG xác minh chữ ký — id_token này đến trực tiếp từ token endpoint qua
 * kênh TLS của chính chúng ta, nên chỉ dùng để hiển thị, không dùng để
 * quyết định quyền.
 */
export function emailFromIdToken(idToken: string | null): string | null {
  if (!idToken) return null;
  const part = idToken.split(".")[1];
  if (!part) return null;
  try {
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const payload = JSON.parse(json) as Record<string, unknown>;
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

/** Dựng URL đồng ý quyền của Google. */
export function buildDriveAuthUrl(state: string, origin?: string): string {
  const { clientId } = getDriveConfig();
  if (!clientId) {
    throw new DriveError("Chưa cấu hình GOOGLE_OAUTH_CLIENT_ID.", "NOT_CONFIGURED");
  }
  const url = new URL(AUTH_URL());
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", driveRedirectUri(origin));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", DRIVE_SCOPES);
  url.searchParams.set("state", state);
  // offline + consent: bắt buộc để Google trả refresh token (kể cả lần cấp lại)
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  return url.toString();
}

// ============================================================
// Lấy access token còn hạn (tự làm mới + ghi lại DB)
// ============================================================

/** Làm mới sớm 60 giây để không bị hết hạn giữa đường. */
const EXPIRY_SKEW_MS = 60 * 1000;

function decrypted(value: string | null | undefined): string {
  return value ? decryptValue(value) : "";
}

/**
 * Access token còn hạn của một connection. Hết hạn thì làm mới và lưu lại.
 * Ném DriveError("NEEDS_REAUTH") nếu refresh token không còn dùng được.
 */
export async function getAccessToken(connectionId: string): Promise<string> {
  const conn = await prisma.driveConnection.findUnique({ where: { id: connectionId } });
  if (!conn) {
    throw new DriveError("Kết nối Google Drive không tồn tại.", "NOT_CONFIGURED");
  }

  const current = decrypted(conn.accessToken);
  const expiresAt = conn.accessTokenExpiresAt?.getTime() ?? 0;
  if (current && expiresAt - EXPIRY_SKEW_MS > Date.now()) return current;

  const refreshToken = decrypted(conn.refreshToken);
  if (!refreshToken) {
    await markConnectionError(connectionId, "Không có refresh token — cần cấp quyền lại.", "NEEDS_REAUTH");
    throw new DriveError("Kết nối Drive thiếu refresh token.", "NEEDS_REAUTH");
  }

  let tokens: DriveTokenSet;
  try {
    tokens = await refreshDriveToken(refreshToken);
  } catch (err) {
    if (needsReauth(err)) {
      await markConnectionError(connectionId, driveErrorMessage(err), "NEEDS_REAUTH");
    }
    throw err;
  }

  await prisma.driveConnection.update({
    where: { id: connectionId },
    data: {
      accessToken: encryptValue(tokens.accessToken),
      accessTokenExpiresAt: new Date(Date.now() + (tokens.expiresIn > 0 ? tokens.expiresIn : 3600) * 1000),
      lastRefreshedAt: new Date(),
      status: "ACTIVE",
      lastError: null,
    },
  });

  return tokens.accessToken;
}

/** Ghi trạng thái lỗi của connection (không làm hỏng luồng đang chạy). */
export async function markConnectionError(
  connectionId: string,
  message: string,
  status: "ACTIVE" | "NEEDS_REAUTH" | "DISABLED" = "NEEDS_REAUTH"
): Promise<void> {
  await prisma.driveConnection
    .update({ where: { id: connectionId }, data: { status, lastError: message } })
    .catch(() => {
      // Ghi nhận lỗi thất bại không đáng để làm hỏng thao tác chính
    });
}

// ============================================================
// Drive API: liệt kê thư mục, tải file
// ============================================================

const FIELDS = [
  "nextPageToken",
  "files(id,name,mimeType,size,imageMediaMetadata(width,height),videoMediaMetadata(durationMillis),thumbnailLink,modifiedTime)",
].join(",");

/** Dịch lỗi HTTP của Drive thành DriveError có ngữ nghĩa. */
async function fileRequestError(res: Response, context: string): Promise<DriveError> {
  const body = await res.text().catch(() => "");
  const status = res.status;

  if (status === 401) {
    return new DriveError("Access token Google không hợp lệ.", "NEEDS_REAUTH", { status });
  }
  if (status === 403) {
    if (/storageQuotaExceeded|quotaExceeded/i.test(body)) {
      return new DriveError("Drive đã hết dung lượng.", "QUOTA", { status });
    }
    if (/rateLimitExceeded|userRateLimitExceeded/i.test(body)) {
      return new DriveError("Vượt hạn mức API của Google Drive.", "RATE_LIMIT", {
        status,
        retryable: true,
      });
    }
    return new DriveError(
      `Google Drive từ chối quyền truy cập (${context}).`,
      "NO_PERMISSION",
      { status }
    );
  }
  if (status === 404) {
    return new DriveError("Không tìm thấy tệp trên Google Drive.", "NOT_FOUND", { status });
  }
  if (status === 429) {
    return new DriveError("Google Drive đang giới hạn truy cập.", "RATE_LIMIT", {
      status,
      retryable: true,
    });
  }
  return new DriveError(
    `Google Drive trả về mã ${status} (${context}). ${body.slice(0, 200)}`,
    "HTTP",
    { status, retryable: status >= 500 }
  );
}

/** Gọi Drive API kèm access token + retry cho lỗi tạm thời. */
async function driveFetch(
  path: string,
  accessToken: string,
  params: Record<string, string> = {},
  init: { method?: string; headers?: Record<string, string> } = {}
): Promise<Response> {
  const url = new URL(`${DRIVE_API()}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let lastError: DriveError | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));
    try {
      const res = await fetch(url.toString(), {
        method: init.method ?? "GET",
        headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) return res;
      const err = await fileRequestError(res, path);
      lastError = err;
      if (!err.retryable) throw err;
    } catch (err) {
      if (err instanceof DriveError) {
        if (!err.retryable) throw err;
        lastError = err;
      } else {
        lastError = new DriveError(
          `Không gọi được Google Drive: ${err instanceof Error ? err.message : String(err)}`,
          "NETWORK",
          { retryable: true }
        );
      }
    }
  }
  throw lastError ?? new DriveError("Google Drive không phản hồi.", "NETWORK", { retryable: true });
}

/**
 * Liệt kê ảnh/video trực tiếp trong một thư mục Drive.
 *
 * Chỉ xin đúng field cần dùng để không tốn quota, và lọc file Google gốc
 * (Docs/Sheets — không tải được byte).
 */
export async function listFolderMedia(
  connectionId: string,
  folderId: string,
  options: { pageToken?: string; pageSize?: number; allowVideo?: boolean } = {}
): Promise<DriveFilePage> {
  const accessToken = await getAccessToken(connectionId);
  const mimes = options.allowVideo === false ? IMAGE_MIMES : [...IMAGE_MIMES, ...VIDEO_MIMES];
  const mimeQuery = mimes.map((m) => `mimeType = '${m}'`).join(" or ");

  const res = await driveFetch("/files", accessToken, {
    q: `'${folderId}' in parents and trashed = false and (${mimeQuery})`,
    fields: FIELDS,
    orderBy: "name_natural",
    pageSize: String(Math.min(Math.max(options.pageSize ?? 100, 1), 1000)),
    ...(options.pageToken ? { pageToken: options.pageToken } : {}),
  });

  return mapDriveFiles(await res.json(), options.allowVideo !== false);
}

/** Metadata một file — cũng là cách "kích hoạt" quyền drive.file sau Picker. */
export async function getFile(connectionId: string, fileId: string): Promise<DriveFile> {
  const accessToken = await getAccessToken(connectionId);
  const res = await driveFetch(`/files/${encodeURIComponent(fileId)}`, accessToken, {
    fields: "id,name,mimeType,size,imageMediaMetadata(width,height),videoMediaMetadata(durationMillis),thumbnailLink,modifiedTime",
  });
  return mapDriveFile((await res.json()) as Record<string, unknown>);
}

// ============================================================
// CHẨN ĐOÁN — "tại sao thư mục có ảnh mà app không thấy ảnh nào?"
//
// Khi người dùng báo thư mục trống, câu hỏi luôn là: Google trả về gì? Có 4 khả
// năng khác nhau và cách xử lý hoàn toàn khác nhau:
//   1. Truy vấn MIME quá chặt (ảnh là định dạng lạ như HEIC/AVIF/BMP/TIFF)
//   2. File nằm trong THƯ MỤC CON, không phải trực tiếp trong thư mục đã chọn
//   3. `in parents` không trả kết quả (Drive chưa cấp quyền với nội dung)
//   4. Thư mục thật sự trống
// Hàm này trả về ĐỦ dữ liệu để phân biệt 4 khả năng, thay vì bắt người dùng
// đoán. Chỉ đọc, không ghi.
// ============================================================

export type FolderDiagnostics = {
  /** File trực tiếp trong thư mục — KHÔNG lọc MIME. */
  directFiles: { name: string; mimeType: string; id: string }[];
  /** Thư mục con trực tiếp. */
  subfolders: { name: string; id: string }[];
  /** File khớp bộ lọc ảnh/video của app. */
  mediaFiles: { name: string; mimeType: string; id: string }[];
  /** Các loại MIME đếm được trong thư mục — để thấy ngay định dạng lạ. */
  mimeCounts: Record<string, number>;
  /** File nằm trong thư mục con (một cấp) — bằng chứng của khả năng số 2. */
  nestedMediaCount: number;
  /** Câu truy vấn đã gửi Google (để đối chiếu khi cần). */
  query: string;
  /** Tên + loại của chính thư mục đang xét — phát hiện gắn nhầm ID. */
  folderName: string;
  folderMime: string;
  /** Tổng số tệp app ĐỌC ĐƯỢC trên toàn Drive (bỏ điều kiện `in parents`). */
  driveWideCount: number;
  /** Ví dụ vài tệp app đọc được trên toàn Drive. */
  driveWideSample: { name: string; mimeType: string; parents: string[] }[];
};

/**
 * Liệt kê mọi ảnh/video mà APP ĐỌC ĐƯỢC, phạm vi toàn Drive (không lọc theo
 * thư mục cha).
 *
 * VÌ SAO CẦN: `drive.file` cấp quyền theo TỪNG tệp/thư mục mà người dùng đã
 * chọn. Nếu thư mục đã gắn trả về 0 tệp, câu hỏi tiếp theo luôn là: app có đọc
 * được tệp nào không? Danh sách này trả lời câu đó — và `parents` cho biết tệp
 * nằm trong thư mục nào, nhờ đó biết ngay thư mục đã gắn có phải là nơi chứa ảnh.
 */
export async function listAccessibleMedia(
  connectionId: string,
  type: "IMAGE" | "VIDEO" = "IMAGE"
): Promise<{ name: string; mimeType: string; parents: string[] }[]> {
  const accessToken = await getAccessToken(connectionId);
  const mimes = type === "VIDEO" ? VIDEO_MIMES : IMAGE_MIMES;
  const mimeQuery = mimes.map((m) => `mimeType = '${m}'`).join(" or ");

  const res = await driveFetch("/files", accessToken, {
    q: `trashed = false and (${mimeQuery})`,
    fields: "files(id,name,mimeType,parents)",
    pageSize: "100",
    orderBy: "modifiedTime desc",
  });

  const data = (await res.json()) as { files?: Record<string, unknown>[] };
  return (data.files ?? []).map((f) => ({
    name: String(f.name ?? "Không tên"),
    mimeType: String(f.mimeType ?? ""),
    parents: Array.isArray(f.parents) ? (f.parents as string[]).map(String) : [],
  }));
}

export async function diagnoseFolder(
  connectionId: string,
  folderId: string
): Promise<FolderDiagnostics> {
  const accessToken = await getAccessToken(connectionId);
  const query = `'${folderId}' in parents and trashed = false`;

  // Đọc chính thư mục trước: phát hiện ngay ca "ID trong link là TỆP ảnh, không
  // phải thư mục" (người dùng hay copy link ảnh khi tưởng là link thư mục).
  let folderName = "(không đọc được)";
  let folderMime = "(không rõ)";
  try {
    const meta = await getFile(connectionId, folderId);
    folderName = meta.name;
    folderMime = meta.mimeType;
  } catch {
    // Không đọc được metadata cũng là thông tin — để phần kết luận nói ra
  }

  const res = await driveFetch("/files", accessToken, {
    q: query,
    fields: "files(id,name,mimeType,size,modifiedTime)",
    pageSize: "200",
    // KHÔNG lọc MIME: cần thấy mọi thứ Google thực sự trả về
    orderBy: "folder,name_natural",
  });

  const data = (await res.json()) as { files?: Record<string, unknown>[] };
  const raw = Array.isArray(data.files) ? data.files : [];

  const FOLDER_MIME = "application/vnd.google-apps.folder";
  const directRaw = raw.filter((f) => f.mimeType !== FOLDER_MIME);
  const subfoldersRaw = raw.filter((f) => f.mimeType === FOLDER_MIME);

  const mimeCounts: Record<string, number> = {};
  for (const f of raw) {
    const mime = String(f.mimeType ?? "không rõ");
    mimeCounts[mime] = (mimeCounts[mime] ?? 0) + 1;
  }

  const mediaRaw = directRaw.filter((f) =>
    isSupportedMime(String(f.mimeType ?? ""), true)
  );

  // Đếm ảnh/video trong thư mục CON (một cấp) để phát hiện khả năng số 2.
  let nestedMediaCount = 0;
  for (const sub of subfoldersRaw.slice(0, 5)) {
    try {
      const subRes = await driveFetch("/files", accessToken, {
        q: `'${String(sub.id)}' in parents and trashed = false`,
        fields: "files(id,mimeType)",
        pageSize: "200",
      });
      const subData = (await subRes.json()) as { files?: Record<string, unknown>[] };
      nestedMediaCount += (subData.files ?? []).filter((f) =>
        isSupportedMime(String(f.mimeType ?? ""), true)
      ).length;
    } catch {
      // Thư mục con không đọc được thì bỏ qua — không làm hỏng chẩn đoán
    }
  }

  // App đọc được tệp nào trên toàn Drive? (bỏ `in parents`) — dữ liệu quyết định
  // giữa "quyền theo tệp" và "thư mục thật sự trống".
  let driveWide: { name: string; mimeType: string; parents: string[] }[] = [];
  try {
    const [images, videos] = await Promise.all([
      listAccessibleMedia(connectionId, "IMAGE"),
      listAccessibleMedia(connectionId, "VIDEO"),
    ]);
    driveWide = [...images, ...videos];
  } catch {
    driveWide = [];
  }

  const brief = (f: Record<string, unknown>) => ({
    id: String(f.id ?? ""),
    name: String(f.name ?? "Không tên"),
    mimeType: String(f.mimeType ?? ""),
  });

  return {
    directFiles: directRaw.slice(0, 50).map(brief),
    subfolders: subfoldersRaw.map((f) => ({ id: String(f.id ?? ""), name: String(f.name ?? "Không tên") })),
    mediaFiles: mediaRaw.slice(0, 50).map(brief),
    mimeCounts,
    nestedMediaCount,
    query,
    folderName,
    folderMime,
    driveWideCount: driveWide.length,
    driveWideSample: driveWide.slice(0, 10),
  };
}

/** Thư mục gốc trên Drive của connection (dùng để gắn thư mục cho Brand). */
export async function ensureFolderAccess(connectionId: string, folderId: string): Promise<DriveFile> {
  const file = await getFile(connectionId, folderId);
  if (file.mimeType !== "application/vnd.google-apps.folder") {
    throw new DriveError("Mục đã chọn không phải là thư mục trên Google Drive.", "NO_PERMISSION");
  }
  return file;
}

/**
 * Tải nội dung một file. Trả về `Response` để caller stream tiếp (không nạp
 * cả file vào RAM). `range` dùng khi cần tải từng phần.
 */
export async function downloadFile(
  connectionId: string,
  fileId: string,
  range?: string
): Promise<Response> {
  const accessToken = await getAccessToken(connectionId);

  let res: Response;
  try {
    res = await fetch(`${DRIVE_API()}/files/${encodeURIComponent(fileId)}?alt=media`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(range ? { Range: range } : {}),
      },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new DriveError(
      `Không tải được tệp từ Google Drive: ${err instanceof Error ? err.message : String(err)}`,
      "NETWORK",
      { retryable: true }
    );
  }

  if (!res.ok) throw await fileRequestError(res, `tải tệp ${fileId}`);
  return res;
}

/** Kích thước file theo byte (null nếu Drive không báo) — để kiểm giới hạn. */
export async function fileSize(connectionId: string, fileId: string): Promise<number | null> {
  const file = await getFile(connectionId, fileId);
  return file.size;
}
