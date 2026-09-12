import "server-only";

import { getPexelsKeyForUser } from "./settings";
import type {
  MediaType,
  PexelsMediaItem,
  PexelsPhoto,
  PexelsVideo,
} from "./pexels-types";

export type { PexelsMediaItem, PexelsPhoto, PexelsVideo } from "./pexels-types";

// ============================================================
// Pexels API client (server-only)
// Docs: https://www.pexels.com/api/documentation/
//
// Pexels giới hạn 200 request/giờ (gói miễn phí) nên mọi kết quả
// tìm kiếm được cache trong bộ nhớ với TTL để tránh gọi trùng.
// ============================================================

const PEXELS_BASE = process.env.PEXELS_BASE_URL ?? "https://api.pexels.com";

/** Số request đã gọi trong cửa sổ 1 giờ gần nhất (dùng khi chưa có header thật). */
// Hạn mức Pexels tính theo API KEY nên mọi trạng thái đều gắn với userId —
// user này hết key của user khác không bị vạ lây.
const requestLogs = new Map<string, number[]>();
const RATE_LIMIT_PER_HOUR = 200;

/**
 * Quota đọc từ header thật của Pexels.
 *
 * Đếm nội bộ (requestLog) không đáng tin: nó reset mỗi lần restart server và
 * không biết các request đã gọi trước đó. Pexels trả về x-ratelimit-remaining
 * trong MỌI response nên đây mới là con số đúng.
 */
const liveQuotas = new Map<string, { limit: number; remaining: number; resetAt: number; at: number }>();

/**
 * Khi bị 429, Pexels cho biết lúc nào quota reset. Ghi lại để các lần gọi sau
 * FAIL NGAY mà không tốn thêm request — gọi tiếp lúc này chỉ càng bị chặn lâu.
 */
const blockedUntil = new Map<string, number>();

/** Dưới ngưỡng này thì bộ tự động ngừng tìm ảnh, chừa quota cho người dùng. */
export const PEXELS_SAFETY_FLOOR = 20;

/** Không bao giờ tự khóa quá 1 giờ (hạn mức Pexels tính theo cửa sổ 1 giờ). */
const MAX_BLOCK_MS = 60 * 60 * 1000;

const CACHE_TTL_MS = 60 * 60 * 1000; // 60 phút — tiết kiệm quota cho tìm kiếm thủ công
// Cache theo user: mỗi người một key, kết quả không được lẫn lộn.
const cache = new Map<string, { at: number; value: PexelsSearchResult }>();

/** Pexels cho tối đa 80 kết quả/trang; 24 là đủ đa dạng mà không nặng. */
export const MAX_PER_PAGE = 24;

export type PexelsSearchResult = {
  ok: boolean;
  items: PexelsMediaItem[];
  totalResults: number;
  page: number;
  perPage: number;
  hasNextPage: boolean;
  /** true nếu lấy từ cache (không tốn quota). */
  cached?: boolean;
  error?: string;
};

export type PexelsQuota = {
  used: number;
  limit: number;
  /** Số request còn lại — chính xác khi đọc được từ header. */
  remaining: number;
  /** true nếu lấy từ header thật của Pexels, false nếu chỉ là ước lượng nội bộ. */
  live: boolean;
  /** Thời điểm quota reset (epoch ms), nếu biết. */
  resetAt: number | null;
  /** true khi đang bị 429 và chưa tới giờ reset. */
  blocked: boolean;
};

export function getPexelsQuota(userId: string): PexelsQuota {
  const log = requestLogs.get(userId) ?? [];
  const cutoff = Date.now() - 60 * 60 * 1000;
  while (log.length > 0 && log[0] < cutoff) log.shift();
  requestLogs.set(userId, log);

  const live = liveQuotas.get(userId) ?? null;
  const blocked = (blockedUntil.get(userId) ?? 0) > Date.now();

  // Header thật đáng tin hơn hẳn số đếm nội bộ.
  // Lưu ý: Pexels trả -1 cho key không giới hạn hoặc khi qua CDN cache.
  if (live && live.limit > 0 && live.remaining >= 0) {
    return {
      used: Math.max(live.limit - live.remaining, 0),
      limit: live.limit,
      remaining: live.remaining,
      live: true,
      resetAt: live.resetAt || null,
      blocked,
    };
  }

  return {
    used: log.length,
    limit: RATE_LIMIT_PER_HOUR,
    remaining: Math.max(RATE_LIMIT_PER_HOUR - log.length, 0),
    live: false,
    resetAt: null,
    blocked,
  };
}

/**
 * Bỏ trạng thái tạm ngưng do 429.
 *
 * Gọi khi người dùng lưu API Key mới: key mới có hạn mức riêng nên không
 * có lý do gì bắt họ chờ hết cửa sổ của key cũ.
 */
export function resetPexelsRateLimit(userId: string): void {
  blockedUntil.delete(userId);
  liveQuotas.delete(userId);
  requestLogs.delete(userId);
  // Kết quả cache của key cũ cũng vô nghĩa với key mới
  for (const k of [...cache.keys()]) if (k.startsWith(userId + "|")) cache.delete(k);
}

/** Còn đủ quota để bộ tự động tìm ảnh không? */
export function hasPexelsBudget(userId: string): boolean {
  const q = getPexelsQuota(userId);
  if (q.blocked) return false;
  return q.remaining > PEXELS_SAFETY_FLOOR;
}

/**
 * Đọc quota từ header response.
 *
 * Pexels trả -1 khi key không giới hạn hoặc khi response đến từ CDN cache;
 * lúc đó bỏ qua để không hiểu nhầm là "hết quota".
 */
function readQuotaHeaders(userId: string, res: Response): void {
  const limit = Number(res.headers.get("x-ratelimit-limit") ?? "");
  const remaining = Number(res.headers.get("x-ratelimit-remaining") ?? "");
  const reset = Number(res.headers.get("x-ratelimit-reset") ?? "");

  if (!Number.isFinite(limit) || limit <= 0) return;
  if (!Number.isFinite(remaining) || remaining < 0) return;

  liveQuotas.set(userId, {
    limit,
    remaining,
    // Pexels trả epoch giây
    resetAt: Number.isFinite(reset) && reset > 0 ? reset * 1000 : 0,
    at: Date.now(),
  });
}

async function pexelsFetch(
  userId: string,
  path: string,
  params: Record<string, string | number | undefined>
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const apiKey = await getPexelsKeyForUser(userId);
  if (!apiKey) {
    return {
      ok: false,
      error: "Bạn chưa tự cấu hình Pexels API Key — vào trang Cài đặt để nhập key của riêng bạn.",
    };
  }

  // Đang bị chặn vì 429 → fail ngay, KHÔNG gửi request.
  // Gọi tiếp lúc này vừa vô ích vừa có thể kéo dài thời gian bị chặn.
  const blocked = blockedUntil.get(userId) ?? 0;
  if (Date.now() < blocked) {
    const waitMin = Math.ceil((blocked - Date.now()) / 60000);
    return {
      ok: false,
      error: `Đã hết lượt tìm ảnh Pexels trong giờ này. Thử lại sau khoảng ${waitMin} phút.`,
    };
  }

  const url = new URL(`${PEXELS_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  let log = requestLogs.get(userId);
  if (!log) {
    log = [];
    requestLogs.set(userId, log);
  }
  log.push(Date.now());

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(20_000),
    });

    // Ghi lại quota thật từ header (có trong cả response lỗi lẫn thành công)
    readQuotaHeaders(userId, res);

    if (!res.ok) {
      const body = await res.text();

      if (res.status === 429) {
        // Tôn trọng mốc reset Pexels báo về, nhưng KHÔNG tin quá 1 giờ:
        // hạn mức của Pexels là cửa sổ 1 giờ, một mốc xa hơn thế gần như
        // chắc chắn là header sai và sẽ khóa tính năng tìm ảnh vô cớ.
        const reset = liveQuotas.get(userId)?.resetAt ?? 0;
        const cap = Date.now() + MAX_BLOCK_MS;
        const until =
          reset > Date.now() ? Math.min(reset, cap) : Date.now() + 15 * 60 * 1000;
        blockedUntil.set(userId, until);
        const waitMin = Math.ceil((until - Date.now()) / 60000);
        return {
          ok: false,
          error: `Đã vượt giới hạn tìm ảnh của Pexels. Tạm ngưng ${waitMin} phút rồi tự động chạy lại.`,
        };
      }

      const hint =
        res.status === 401 ? " Pexels API Key không hợp lệ hoặc đã bị thu hồi." : "";
      return {
        ok: false,
        error: `Pexels trả về mã ${res.status}.${hint} ${body.slice(0, 200)}`,
      };
    }

    // Gọi thành công → bỏ cờ chặn nếu còn sót
    blockedUntil.delete(userId);
    return { ok: true, data: await res.json() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: /abort|timeout/i.test(message)
        ? "Pexels phản hồi quá lâu — thử lại."
        : `Không gọi được Pexels: ${message}`,
    };
  }
}

type RawPhoto = {
  id: number;
  width: number;
  height: number;
  url?: string;
  photographer?: string;
  photographer_url?: string;
  avg_color?: string;
  alt?: string;
  src?: Record<string, string>;
};

type RawVideo = {
  id: number;
  width: number;
  height: number;
  url?: string;
  image?: string;
  duration?: number;
  user?: { name?: string; url?: string };
  video_files?: Array<{
    id?: number;
    quality?: string;
    file_type?: string;
    width?: number;
    height?: number;
    link?: string;
  }>;
};

/** Chọn file video phù hợp để đăng Facebook (ưu tiên MP4, không quá nặng). */
function pickVideoFile(files?: RawVideo["video_files"]) {
  const mp4 = (files ?? []).filter(
    (f) => f.link && (f.file_type === "video/mp4" || f.link.endsWith(".mp4"))
  );
  if (mp4.length === 0) return (files ?? []).find((f) => f.link);

  // Ưu tiên bản ~HD (rộng ≤ 1920) để file không quá lớn
  const sorted = [...mp4].sort((a, b) => {
    const score = (f: (typeof mp4)[number]) =>
      f.width && f.width <= 1920 ? 1920 - f.width : 10_000 + (f.width ?? 0);
    return score(a) - score(b);
  });
  return sorted[0];
}

function mapPhoto(p: RawPhoto): PexelsPhoto {
  const src = p.src ?? {};
  return {
    id: String(p.id),
    type: "IMAGE",
    width: p.width,
    height: p.height,
    remoteUrl: src.large2x ?? src.large ?? src.original ?? src.medium ?? "",
    previewUrl: src.medium ?? src.small ?? src.tiny ?? "",
    avgColor: p.avg_color,
    alt: p.alt,
    pageUrl: p.url,
    photographer: p.photographer,
    photographerUrl: p.photographer_url,
  };
}

function mapVideo(v: RawVideo): PexelsVideo | null {
  const file = pickVideoFile(v.video_files);
  if (!file?.link) return null;
  return {
    id: String(v.id),
    type: "VIDEO",
    width: file.width ?? v.width,
    height: file.height ?? v.height,
    remoteUrl: file.link,
    previewUrl: v.image ?? "",
    duration: v.duration ?? 0,
    pageUrl: v.url,
    photographer: v.user?.name,
    photographerUrl: v.user?.url,
  };
}

export type SearchMediaInput = {
  /** Tìm bằng key Pexels của user nào. */
  userId: string;
  query: string;
  type?: MediaType;
  page?: number;
  perPage?: number;
  orientation?: "" | "landscape" | "portrait" | "square";
  /**
   * Bỏ qua cache.
   *
   * Bộ tự động cần ảnh KHÁC nhau giữa các bài; nếu dùng cache thì mọi bài
   * tạo trong cùng một giờ sẽ nhận đúng một bộ kết quả. Tìm kiếm thủ công
   * ở /media thì vẫn nên dùng cache để tiết kiệm quota.
   */
  noCache?: boolean;
  /** Xáo trộn kết quả trước khi trả về (dùng cho bộ tự động). */
  shuffle?: boolean;
  /** Nguồn ngẫu nhiên — cho phép test tái lập kết quả. */
  random?: () => number;
};

/**
 * Xáo trộn Fisher–Yates.
 *
 * Pexels trả kết quả theo độ phổ biến nên nếu luôn lấy từ đầu danh sách thì
 * mọi bài đăng sẽ dùng chung vài tấm ảnh. Xáo trộn để mỗi bài một khác.
 */
export function shuffleInPlace<T>(items: T[], random: () => number = Math.random): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * Chọn ngẫu nhiên một trang trong vùng an toàn.
 *
 * Chỉ lấy trong vài trang đầu: càng về sau ảnh càng ít liên quan tới từ khóa.
 * Đây là đánh đổi giữa "đa dạng" và "đúng nội dung".
 */
export const MAX_RANDOM_PAGES = 5;

export function pickRandomPage(
  totalResults: number,
  perPage: number,
  random: () => number = Math.random
): number {
  if (totalResults <= perPage) return 1;
  const pages = Math.min(Math.ceil(totalResults / perPage), MAX_RANDOM_PAGES);
  return Math.floor(random() * pages) + 1;
}

/**
 * Tìm ảnh hoặc video trên Pexels (có cache theo tham số tìm kiếm).
 */
export async function searchMedia(input: SearchMediaInput): Promise<PexelsSearchResult> {
  const type = input.type ?? "IMAGE";
  const query = input.query.trim();
  const page = Math.max(input.page ?? 1, 1);
  const perPage = Math.min(Math.max(input.perPage ?? 12, 1), 24);

  if (!query) {
    return {
      ok: false,
      items: [],
      totalResults: 0,
      page,
      perPage,
      hasNextPage: false,
      error: "Vui lòng nhập từ khóa tìm kiếm.",
    };
  }

  const cacheKey = [input.userId, type, query.toLowerCase(), page, perPage, input.orientation ?? ""].join("|");
  if (!input.noCache) {
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return { ...hit.value, cached: true };
    }
  }

  const path = type === "VIDEO" ? "/videos/search" : "/v1/search";
  const res = await pexelsFetch(input.userId, path, {
    query,
    page,
    per_page: perPage,
    orientation: input.orientation,
  });

  if (!res.ok || !res.data) {
    return {
      ok: false,
      items: [],
      totalResults: 0,
      page,
      perPage,
      hasNextPage: false,
      error: res.error,
    };
  }

  const data = res.data as {
    photos?: RawPhoto[];
    videos?: RawVideo[];
    total_results?: number;
    next_page?: string;
    page?: number;
    per_page?: number;
  };

  const items: PexelsMediaItem[] =
    type === "VIDEO"
      ? (data.videos ?? []).map(mapVideo).filter((v): v is PexelsVideo => v !== null)
      : (data.photos ?? [])
          .map(mapPhoto)
          .filter((p) => Boolean(p.remoteUrl) && Boolean(p.previewUrl));

  if (input.shuffle) shuffleInPlace(items, input.random ?? Math.random);

  const value: PexelsSearchResult = {
    ok: true,
    items,
    totalResults: data.total_results ?? items.length,
    page: data.page ?? page,
    perPage: data.per_page ?? perPage,
    // Pexels trả next_page = chuỗi URL khi còn trang; một số trường hợp trả về số
    hasNextPage: Boolean(data.next_page),
  };

  // Không cache kết quả đã xáo trộn — lần sau phải là thứ tự khác
  if (!input.noCache && !input.shuffle) {
    cache.set(cacheKey, { at: Date.now(), value });
  }
  return value;
}

/** Ảnh/video phổ biến (dùng khi chưa nhập từ khóa). */
export async function curatedMedia(
  userId: string,
  type: MediaType = "IMAGE",
  perPage = 12
): Promise<PexelsSearchResult> {
  const cacheKey = `${userId}|curated|${type}|${perPage}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { ...hit.value, cached: true };
  }

  const path = type === "VIDEO" ? "/videos/popular" : "/v1/curated";
  const res = await pexelsFetch(userId, path, { per_page: perPage });
  if (!res.ok || !res.data) {
    return {
      ok: false,
      items: [],
      totalResults: 0,
      page: 1,
      perPage,
      hasNextPage: false,
      error: res.error,
    };
  }

  const data = res.data as {
    photos?: RawPhoto[];
    videos?: RawVideo[];
    total_results?: number;
    next_page?: string;
  };

  const items: PexelsMediaItem[] =
    type === "VIDEO"
      ? (data.videos ?? []).map(mapVideo).filter((v): v is PexelsVideo => v !== null)
      : (data.photos ?? []).map(mapPhoto).filter((p) => Boolean(p.remoteUrl));

  const value: PexelsSearchResult = {
    ok: true,
    items,
    totalResults: data.total_results ?? items.length,
    page: 1,
    perPage,
    hasNextPage: Boolean(data.next_page),
  };

  cache.set(cacheKey, { at: Date.now(), value });
  return value;
}
