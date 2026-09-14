import "server-only";

import { prisma } from "./prisma";
import { formatDateTime } from "./format-date";
import { generatePostVariants, suggestMediaKeywords } from "./ai";
import { notify, notifyOncePer } from "./notify";
import { userHasAiConfig, userHasPexelsKey } from "./settings";
import {
  getPexelsQuota,
  hasPexelsBudget,
  searchMedia,
  MAX_PER_PAGE,
} from "./pexels";
import { contentScopeForPage, loadBrandContext, resolvePageBrand } from "./brand";
import {
  addDays,
  decideMediaKind,
  formatDateKey,
  formatHm,
  isoDayOf,
  parseDaysOfWeek,
  parseHm,
  pickPillar,
  planTimeSlots,
  startOfDay,
  videoQuotaForDay,
  MAX_PLAN_AHEAD_DAYS,
  MAX_POSTS_PER_DAY,
  type PillarLike,
} from "./autopilot-plan";

// Dùng lại logic thuần ở autopilot-plan.ts (kiểm thử được độc lập)
export {
  decideMediaKind,
  formatHm,
  isoDayOf,
  parseDaysOfWeek,
  parseHm,
  pickPillar,
  planTimeSlots,
  startOfDay,
  videoQuotaForDay,
};
export type { PillarLike };
import type { AttachedMedia } from "./posts";
import { GOALS, LENGTHS, TONES, type Goal, type PostLength, type Tone } from "./ai-prompts";

// ============================================================
// CHẾ ĐỘ TỰ ĐỘNG — bộ lập kế hoạch.
//
// Ý tưởng: người dùng chỉ đặt vài thông số (mỗi ngày mấy bài, khung giờ nào,
// có tự tìm ảnh không). Bộ lập kế hoạch này tự:
//   1. Chia khung giờ thành các slot rải đều, tránh dồn bài vào một lúc.
//   2. Chọn trụ cột nội dung theo tỉ trọng người dùng đặt, có xoay vòng.
//   3. Nhờ AI viết nội dung dựa trên hồ sơ thương hiệu.
//   4. Tự tìm ảnh/video trên Pexels nếu người dùng bật.
//   5. Tạo Post ở trạng thái SCHEDULED (tự đăng) hoặc PENDING_REVIEW (chờ duyệt).
//
// Sau đó scheduler hiện có (src/lib/scheduler.ts) lo phần đăng bài. Bộ lập kế
// hoạch KHÔNG gọi Facebook — nhờ vậy toàn bộ logic đăng bài vẫn nằm một chỗ.
// ============================================================

/** Số bài tối đa tạo ra trong một lần chạy (chặn chi phí AI bất ngờ). */
export const MAX_POSTS_PER_RUN = 12;
/** Nếu lần trước lỗi thì chờ ngần này mới thử lại (tránh spam AI khi hỏng). */
export const RETRY_AFTER_ERROR_MS = 15 * 60 * 1000;
/** Bài của hôm nay phải cách hiện tại ít nhất ngần này mới xếp lịch. */
export const MIN_LEAD_MS = 20 * 60 * 1000;
/** Số chủ đề gần đây đưa vào prompt để AI không lặp lại. */
const RECENT_TOPIC_LIMIT = 8;
/** Số bài gần đây dùng để tính xoay vòng trụ cột. */
const PILLAR_HISTORY = 12;
/** Số từ khóa tối đa xin AI cho mỗi bài. */
const KEYWORD_COUNT = 6;
/**
 * Số lần gọi Pexels tối đa cho MỘT bài.
 *
 * Trước đây mỗi từ khóa một request (tới 6 lần/bài) nên 3 bài/ngày × 2 Page
 * là đã ngốn phần lớn hạn mức 200/giờ. Nay mỗi lần lấy 24 kết quả nên
 * thường chỉ cần 1 lần là đủ 4 ảnh.
 */
export const MAX_PEXELS_CALLS_PER_POST = 3;

export type AutoPilotConfig = {
  id: string;
  userId: string;
  pageId: string;
  enabled: boolean;
  mode: string;
  postsPerDay: number;
  windowStart: string;
  windowEnd: string;
  daysOfWeek: string;
  minGapMinutes: number;
  autoMedia: boolean;
  mediaKind: string;
  /** IMAGE_ONLY | VIDEO_ONLY | MIXED — quyết định luân phiên ảnh/video. */
  mediaMix: string;
  /** Phần trăm bài dùng video khi mediaMix = MIXED. */
  videoPercent: number;
  photosPerPost: number;
  length: string;
  toneOverride: string | null;
  useHashtags: boolean;
  planAheadDays: number;
  lastPlannedAt: Date | null;
  lastPlanError: string | null;
  lastPlanCount: number;
  totalPlanned: number;
};

// ============================================================
// Tự tìm ảnh/video
// ============================================================

function toAttached(item: {
  id: string;
  type: "IMAGE" | "VIDEO";
  remoteUrl: string;
  previewUrl: string;
  width?: number;
  height?: number;
  duration?: number;
  pageUrl?: string;
  photographer?: string;
  photographerUrl?: string;
  alt?: string;
}): AttachedMedia {
  return {
    remoteUrl: item.remoteUrl,
    previewUrl: item.previewUrl || undefined,
    type: item.type,
    source: "PEXELS",
    providerId: item.id,
    photographer: item.photographer,
    photographerUrl: item.photographerUrl,
    sourcePageUrl: item.pageUrl,
    alt: item.alt,
    width: item.width,
    height: item.height,
    duration: item.duration,
  };
}

export type MediaPickResult = {
  media: AttachedMedia[];
  error?: string;
  /** Số lần thực sự gọi Pexels — để test kiểm chứng ngân sách. */
  calls?: number;
};

/** Ảnh nhỏ hơn ngần này hiển thị vỡ nét trên Facebook. */
const MIN_PHOTO_WIDTH = 1200;
/** Ảnh đã dùng trong ngần này ngày thì không dùng lại. */
const USED_MEDIA_WINDOW_DAYS = 60;

/** Lấy danh sách providerId đã dùng gần đây của một Page. */
async function loadUsedProviderIds(pageId: string): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - USED_MEDIA_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await prisma.usedMedia.findMany({
    where: { pageId, usedAt: { gte: cutoff } },
    select: { providerId: true },
  });
  return new Set(rows.map((r) => r.providerId));
}

/** Ghi nhận ảnh vừa dùng để lần sau không lặp lại. */
async function rememberUsedMedia(pageId: string, media: AttachedMedia[]): Promise<void> {
  for (const m of media) {
    if (!m.providerId) continue;
    // upsert: cùng một ảnh dùng lại thì chỉ cập nhật thời điểm
    await prisma.usedMedia
      .upsert({
        where: { pageId_providerId: { pageId, providerId: m.providerId } },
        create: { pageId, providerId: m.providerId, type: m.type },
        update: { usedAt: new Date() },
      })
      .catch(() => {
        // Ghi sổ chống trùng thất bại không đáng để hỏng cả bài
      });
  }
}

/**
 * Tự tìm media cho một bài.
 *
 * Ba vấn đề thực tế được xử lý ở đây:
 *
 * 1. ẢNH TRÙNG — Pexels xếp kết quả theo độ phổ biến nên cùng từ khóa luôn ra
 *    cùng tấm đầu. Giải pháp: lấy trang ngẫu nhiên, xáo trộn kết quả, và loại
 *    những providerId Page này đã dùng trong 60 ngày.
 *
 * 2. QUOTA — trước đây mỗi bài gọi tới 6 lần (một lần cho mỗi từ khóa). Nay
 *    lấy 24 kết quả mỗi lần và DỪNG NGAY khi đủ ảnh, tối đa 3 lần gọi.
 *
 * 3. ẢNH XẤU — lọc bỏ ảnh hẹp dưới 1200px và ưu tiên ảnh ngang cho tấm đầu.
 */
export async function pickMediaForContent(
  userId: string,
  content: string,
  config: Pick<AutoPilotConfig, "mediaKind" | "photosPerPost"> & {
    /** Có pageId thì mới chống trùng được (mỗi Page một lịch sử riêng). */
    pageId?: string;
    /** Ghi đè loại media cho bài này (dùng cho chế độ xen kẽ ảnh/video). */
    kindOverride?: "IMAGE" | "VIDEO";
    /** Bối cảnh ngành hàng để AI gợi từ khóa sát hơn. */
    industry?: string;
    products?: string;
  },
  random: () => number = Math.random
): Promise<MediaPickResult> {
  const kind = config.kindOverride ?? (config.mediaKind === "VIDEO" ? "VIDEO" : "IMAGE");
  const wanted = kind === "VIDEO" ? 1 : Math.min(Math.max(config.photosPerPost, 1), 4);

  // Hết quota → dừng sớm, KHÔNG gọi AI xin từ khóa (đỡ tốn tiền AI vô ích)
  if (!hasPexelsBudget(userId)) {
    const q = getPexelsQuota(userId);
    return {
      media: [],
      calls: 0,
      error: q.blocked
        ? "Đang tạm ngưng tìm ảnh vì đã chạm giới hạn Pexels — sẽ tự chạy lại sau."
        : `Chỉ còn ${q.remaining} lượt tìm ảnh Pexels trong giờ này — tạm ngưng để dành cho bạn dùng tay.`,
    };
  }

  const kw = await suggestMediaKeywords(userId, content, KEYWORD_COUNT, {
    industry: config.industry,
    products: config.products,
  });
  if (!kw.ok || kw.keywords.length === 0) {
    return { media: [], calls: 0, error: kw.error ?? "AI không gợi ý được từ khóa tìm ảnh." };
  }

  const used = config.pageId ? await loadUsedProviderIds(config.pageId) : new Set<string>();

  const picked: AttachedMedia[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];
  let calls = 0;

  // Vòng 1: loại cả ảnh đã dùng. Vòng 2 (nếu vẫn thiếu): chấp nhận ảnh cũ,
  // vì có ảnh cũ vẫn hơn là bài trắng trơn.
  for (let pass = 0; pass < 2 && picked.length < wanted; pass++) {
    for (const keyword of kw.keywords) {
      if (picked.length >= wanted) break;
      if (calls >= MAX_PEXELS_CALLS_PER_POST) break;

      calls++;
      const probe = await searchMedia({
        userId,
        query: keyword.query,
        type: kind,
        perPage: MAX_PER_PAGE,
        // Ảnh ngang hiển thị đẹp nhất trên dòng thời gian Facebook
        orientation: kind === "IMAGE" ? "landscape" : "",
        noCache: true,
        shuffle: true,
        random,
      });

      if (!probe.ok) {
        if (probe.error) errors.push(probe.error);
        // Bị chặn quota thì dừng hẳn, thử tiếp chỉ tốn công
        if (!hasPexelsBudget(userId)) break;
        continue;
      }

      for (const item of probe.items) {
        if (picked.length >= wanted) break;
        if (seen.has(item.remoteUrl)) continue;
        if (pass === 0 && item.id && used.has(item.id)) continue;
        if (kind === "IMAGE" && item.width && item.width < MIN_PHOTO_WIDTH) continue;

        seen.add(item.remoteUrl);
        picked.push(toAttached(item));
      }
    }
    if (calls >= MAX_PEXELS_CALLS_PER_POST) break;
  }

  if (picked.length === 0) {
    return {
      media: [],
      calls,
      error: errors[0] ?? "Không tìm được ảnh/video phù hợp trên Pexels.",
    };
  }

  if (config.pageId) await rememberUsedMedia(config.pageId, picked);

  return { media: picked, calls };
}

// ============================================================
// Lập kế hoạch cho một AutoPilot
// ============================================================

export type PlanOutcome = {
  pageId: string;
  pageName: string;
  created: number;
  /** Số slot còn thiếu nhưng chưa tạo được (do AI/Pexels lỗi). */
  skipped: number;
  error?: string;
  /** Bài tạo được nhưng thiếu ảnh — không phải lỗi chặn, vẫn cần báo. */
  mediaWarning?: string;
  /** Số bài bị thiếu ảnh trong lần chạy này. */
  missingMedia?: number;
};

/** Đếm số bài tự động đã có của một ngày (mọi trạng thái trừ bài đã hủy). */
async function countPlannedForDay(pageId: string, day: Date): Promise<number> {
  const from = startOfDay(day);
  // Cộng ngày theo LỊCH Việt Nam — không dùng setDate (phụ thuộc múi giờ máy chạy)
  const to = addDays(from, 1);

  return prisma.post.count({
    where: {
      pageId,
      origin: "AUTOPILOT",
      status: { in: ["PENDING_REVIEW", "SCHEDULED", "PUBLISHING", "PUBLISHED"] },
      OR: [
        { scheduledAt: { gte: from, lt: to } },
        { publishedAt: { gte: from, lt: to } },
      ],
    },
  });
}

/** Lấy chủ đề + trụ cột gần đây để AI không viết lặp lại. */
async function loadRecentContext(pageId: string) {
  const recent = await prisma.post.findMany({
    where: { pageId, origin: "AUTOPILOT" },
    orderBy: { createdAt: "desc" },
    take: PILLAR_HISTORY,
    select: { pillarName: true, topic: true },
  });

  return {
    pillarNames: recent.map((r) => r.pillarName ?? "").filter(Boolean),
    topics: recent
      .map((r) => r.topic)
      .filter((t): t is string => Boolean(t && t.trim()))
      .slice(0, RECENT_TOPIC_LIMIT),
  };
}

/**
 * Tạo một bài tự động cho một slot đã định.
 * Trả về true nếu tạo được, false nếu AI/Pexels thất bại (đã ghi lý do).
 */
async function createPlannedPost(input: {
  config: AutoPilotConfig;
  pageId: string;
  pageName: string;
  scheduledAt: Date;
  pillar: PillarLike;
  recentTopics: string[];
  /** Kiểu media đã được bộ lập kế hoạch quyết định (ảnh/video theo tỉ lệ). */
  kind: "IMAGE" | "VIDEO";
}): Promise<
  | { ok: true; topic: string; hook: string | null; mediaWarning?: string; kind: "IMAGE" | "VIDEO" }
  | { ok: false; error: string }
> {
  const { config, pillar } = input;

  const tone = (config.toneOverride ?? "") as Tone;
  const brand = await loadBrandContext(input.pageId, {
    focus: `${pillar.name}`,
    pageName: input.pageName,
  });

  // Chủ đề để AI tự chọn một góc cụ thể trong trụ cột này
  const topic = `Bài thuộc loại "${pillar.name}". Hãy tự chọn MỘT chủ đề cụ thể, thiết thực và hấp dẫn cho thương hiệu này.`;

  const res = await generatePostVariants({
    userId: config.userId,
    topic,
    tone: TONES.some((t) => t.value === tone) ? tone : "friendly",
    goal: (GOALS.some((g) => g.value === pillar.goal) ? pillar.goal : "engagement") as Goal,
    length: (LENGTHS.some((l) => l.value === config.length)
      ? config.length
      : "medium") as PostLength,
    pageName: input.pageName,
    variantCount: 1,
    brand: {
      ...(brand ?? {}),
      pillar: {
        name: pillar.name,
        description: pillar.description ?? undefined,
      },
    },
    recentTopics: input.recentTopics,
  });

  if (!res.ok || res.variants.length === 0) {
    return { ok: false, error: res.error ?? "AI không trả về nội dung." };
  }

  const variant = res.variants[0];

  // Hashtag: gộp hashtag AI gợi ý với hashtag nền tảng của thương hiệu
  let hashtags = config.useHashtags ? variant.hashtags : "";
  const base = brand?.baseHashtags?.trim();
  if (config.useHashtags && base) {
    hashtags = Array.from(
      new Set(
        `${hashtags} ${base}`
          .split(/\s+/)
          .map((t) => t.trim())
          .filter((t) => t.startsWith("#"))
      )
    ).join(" ");
  }

  // Tự tìm ảnh/video nếu người dùng bật. Lỗi Pexels KHÔNG làm hỏng bài —
  // đăng bài không ảnh vẫn tốt hơn là mất bài. NHƯNG phải báo cho người dùng
  // biết, nếu không họ tưởng đang có ảnh mà thực tế bài trắng trơn.
  //
  // kindOverride: kiểu media đã do bộ lập kế hoạch quyết định (chế độ xen kẽ),
  // ưu tiên hơn mediaKind cũ của cấu hình.
  let media: AttachedMedia[] = [];
  let mediaWarning: string | undefined;
  if (config.autoMedia) {
    const picked = await pickMediaForContent(config.userId, variant.content, {
      mediaKind: config.mediaKind,
      photosPerPost: config.photosPerPost,
      pageId: input.pageId,
      kindOverride: input.kind,
      // Đưa ngành hàng vào prompt gợi từ khóa → ảnh đúng sản phẩm hơn
      industry: brand?.industry ?? undefined,
      products: brand?.products ?? undefined,
    });
    media = picked.media;
    if (media.length === 0) {
      mediaWarning =
        picked.error ?? "Không tìm được ảnh — bài sẽ đăng dạng chỉ có chữ.";
    }
  }

  const status = config.mode === "AUTO" ? "SCHEDULED" : "PENDING_REVIEW";
  if (status === "PENDING_REVIEW") {
    // Người dùng phải biết có bài đang chờ mình duyệt — nếu không bài
    // nằm im tới ngày đăng mà không ai hay.
    await notify(config.userId, {
      type: "ACTIVITY",
      title: "🕓 AutoPilot có bài mới chờ bạn duyệt",
      body: `${variant.content.slice(0, 120)}… — hẹn lúc ${formatDateTime(input.scheduledAt)}`,
      link: "/autopilot",
    });
  }

  // Lấy workspace/brand của Page để Post luôn thuộc đúng tenant
  const pageRow = await prisma.facebookPage.findUnique({
    where: { id: input.pageId },
    select: { workspaceId: true, brandId: true },
  });

  const post = await prisma.post.create({
    data: {
      userId: config.userId,
      workspaceId: pageRow?.workspaceId ?? "ws-legacy",
      brandId: pageRow?.brandId ?? null,
      pageId: input.pageId,
      content: variant.content,
      hook: variant.hook || null,
      hashtags: hashtags.trim() || null,
      status,
      scheduledAt: input.scheduledAt,
      origin: "AUTOPILOT",
      pillarName: pillar.name,
      topic: variant.angle || pillar.name,
    },
  });

  for (const [i, m] of media.entries()) {
    await prisma.media.create({
      data: {
        postId: post.id,
        userId: config.userId,
        workspaceId: pageRow?.workspaceId ?? null,
        type: m.type,
        source: m.source,
        remoteUrl: m.remoteUrl,
        previewUrl: m.previewUrl ?? null,
        width: m.width ?? null,
        height: m.height ?? null,
        duration: m.duration ?? null,
        providerId: m.providerId ?? null,
        photographer: m.photographer ?? null,
        photographerUrl: m.photographerUrl ?? null,
        sourcePageUrl: m.sourcePageUrl ?? null,
        alt: m.alt ?? null,
        position: i,
      },
    });
  }

  return {
    ok: true,
    topic: variant.angle || pillar.name,
    hook: variant.hook || null,
    mediaWarning,
    kind: input.kind,
  };
}

/**
 * Lập kế hoạch cho một AutoPilot: tạo đủ số bài cho các ngày tới.
 *
 * Idempotent — chạy lại nhiều lần cũng không tạo trùng, vì mỗi lần đều đếm
 * số bài đã có của ngày đó rồi chỉ tạo phần còn thiếu.
 */
export async function planForAutoPilot(
  config: AutoPilotConfig,
  now: Date,
  pageName: string,
  budget: { remaining: number },
  random: () => number = Math.random
): Promise<PlanOutcome> {
  const outcome: PlanOutcome = {
    pageId: config.pageId,
    pageName,
    created: 0,
    skipped: 0,
  };

  // Trụ cột thuộc Brand của Page (fallback pageId cho dữ liệu cũ)
  const pageForBrand = await resolvePageBrand(config.pageId);
  const brandId = pageForBrand?.brandId ?? null;
  const pillars = await prisma.contentPillar.findMany({
    where: { ...contentScopeForPage(brandId, config.pageId), enabled: true },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      weight: true,
      position: true,
      goal: true,
    },
  });

  if (pillars.length === 0) {
    // Phân biệt rõ 2 nguyên nhân — Page chưa gắn Brand thì không thể có trụ cột,
    // nên báo "thiếu trụ cột" sẽ khiến người dùng đi sai hướng.
    outcome.error = brandId
      ? "Chưa có trụ cột nội dung nào — vào Hồ sơ thương hiệu để thêm hoặc tạo bộ mặc định."
      : "Page chưa gắn thương hiệu — vào trang Pages để gán Page vào một thương hiệu, rồi thêm trụ cột nội dung.";
    return outcome;
  }

  const days = parseDaysOfWeek(config.daysOfWeek);
  const ahead = Math.min(Math.max(config.planAheadDays, 1), MAX_PLAN_AHEAD_DAYS);
  const recent = await loadRecentContext(config.pageId);
  const recentNames = [...recent.pillarNames];
  const recentTopics = [...recent.topics];

  const leadCutoff = new Date(now.getTime() + MIN_LEAD_MS);
  let lastError: string | undefined;
  // Số video đã dùng trong từng ngày — để chế độ MIXED không vượt hạn ngạch
  const videosUsedByDay = new Map<string, number>();

  for (let offset = 0; offset < ahead; offset++) {
    if (budget.remaining <= 0) break;

    const day = addDays(startOfDay(now), offset);

    if (!days.includes(isoDayOf(day))) continue;

    const existing = await countPlannedForDay(config.pageId, day);
    let needed = Math.min(config.postsPerDay, MAX_POSTS_PER_DAY) - existing;
    if (needed <= 0) continue;

    // Đếm video đã có trong ngày (từ những lượt lập kế hoạch trước) để
    // hạn ngạch tính cho đúng tổng ngày, không chỉ từng lượt chạy.
    let videosUsed = videosUsedByDay.get(formatDateKey(day)) ?? 0;
    if (existing > 0) {
      const videoCount = await prisma.post.count({
        where: {
          pageId: config.pageId,
          origin: "AUTOPILOT",
          status: { in: ["PENDING_REVIEW", "SCHEDULED", "PUBLISHING", "PUBLISHED"] },
          OR: [
            { scheduledAt: { gte: day, lt: new Date(day.getTime() + 24 * 60 * 60 * 1000) } },
            { publishedAt: { gte: day, lt: new Date(day.getTime() + 24 * 60 * 60 * 1000) } },
          ],
          media: { some: { type: "VIDEO" } },
        },
      });
      videosUsed = videoCount;
    }

    // Giờ đăng của các bài ĐÃ có trong ngày — để slot mới không xếp sát chúng.
    // Không có bước này, lượt lập kế hoạch thứ hai sẽ chèn bài vào giữa các
    // bài của lượt đầu và phá vỡ khoảng cách tối thiểu người dùng đặt.
    const dayEnd = new Date(day.getTime() + 24 * 60 * 60 * 1000);
    const takenRows = await prisma.post.findMany({
      where: {
        pageId: config.pageId,
        origin: "AUTOPILOT",
        status: { in: ["PENDING_REVIEW", "SCHEDULED", "PUBLISHING", "PUBLISHED"] },
        scheduledAt: { gte: day, lt: dayEnd },
      },
      select: { scheduledAt: true },
    });
    const takenMs = takenRows
      .map((r) => r.scheduledAt?.getTime())
      .filter((t): t is number => typeof t === "number");

    // Với hôm nay: chỉ xếp được slot còn đủ xa hiện tại
    const notBefore = offset === 0 ? leadCutoff : null;
    const slots = planTimeSlots(config, day, notBefore, random, takenMs);
    if (slots.length === 0) continue;

    needed = Math.min(needed, slots.length, budget.remaining);

    for (let i = 0; i < needed; i++) {
      const pillar = pickPillar(pillars, recentNames);
      if (!pillar) break;

      // Ngày này bắt đầu từ bài đầu tiên (chỉ số 0) hay đã có bài từ lượt trước
      const dayStartIndex = Math.max(existing, 0);
      const kind = decideMediaKind(
        config.mediaMix ?? "IMAGE_ONLY",
        dayStartIndex + i,
        Math.min(config.postsPerDay, MAX_POSTS_PER_DAY),
        config.videoPercent ?? 25,
        videosUsed,
        random
      );

      const res = await createPlannedPost({
        config,
        pageId: config.pageId,
        pageName,
        scheduledAt: slots[i],
        pillar,
        recentTopics,
        kind,
      });

      if (res.ok) {
        outcome.created++;
        budget.remaining--;
        if (res.mediaWarning) {
          outcome.missingMedia = (outcome.missingMedia ?? 0) + 1;
          outcome.mediaWarning = res.mediaWarning;
        }
        if (kind === "VIDEO") {
          videosUsed++;
          videosUsedByDay.set(formatDateKey(day), videosUsed);
        }
        recentNames.unshift(pillar.name);
        // Ghi lại chủ đề vừa viết để lượt sau AI tránh lặp
        recentTopics.unshift(`${pillar.name} — ${res.topic}`);
        if (recentTopics.length > RECENT_TOPIC_LIMIT) recentTopics.pop();
      } else {
        outcome.skipped++;
        lastError = res.error;
        // Lỗi AI thường lặp lại ngay → dừng luôn cho Page này, thử lại sau
        break;
      }
    }
  }

  if (lastError) outcome.error = lastError;
  return outcome;
}

// ============================================================
// Vòng chạy cho toàn bộ hệ thống
// ============================================================

export type PlannerRunResult = {
  ranAt: string;
  pages: PlanOutcome[];
  created: number;
  skipped: number;
  skippedThrottled: number;
};

/** Chặn 2 lượt lập kế hoạch chạy chồng nhau (AI có thể chậm hàng phút). */
const RUN_GUARD = "__marketingAutopilotPlannerRunning" as const;

export function isPlannerRunning(): boolean {
  return Boolean((globalThis as Record<string, unknown>)[RUN_GUARD]);
}

/**
 * Chạy bộ lập kế hoạch cho MỌI Page đang bật chế độ tự động.
 *
 * Được gọi từ vòng lặp scheduler (src/lib/scheduler.ts) nhưng chạy song song,
 * KHÔNG chặn việc đăng bài — vì gọi AI có thể mất hàng chục giây.
 */
export async function runAutopilotPlanner(
  now: Date = new Date(),
  random: () => number = Math.random
): Promise<PlannerRunResult> {
  const result: PlannerRunResult = {
    ranAt: now.toISOString(),
    pages: [],
    created: 0,
    skipped: 0,
    skippedThrottled: 0,
  };

  // Lấy mọi autopilot đang bật. Page bị tắt sẽ được lọc ở vòng lặp dưới —
  // vẫn giữ cấu hình để người dùng bật lại Page là chạy tiếp.
  const all = await prisma.autoPilot.findMany({ where: { enabled: true } });

  const withPage = await Promise.all(
    all.map(async (c) => ({
      config: c as unknown as AutoPilotConfig,
      page: await prisma.facebookPage.findUnique({
        where: { id: c.pageId },
        select: { name: true, isActive: true },
      }),
    }))
  );

  const budget = { remaining: MAX_POSTS_PER_RUN };

  for (const { config, page } of withPage) {
    if (!page || !page.isActive) continue;
    if (budget.remaining <= 0) break;

    // Chủ Page chưa tự nhập key → không thể soạn bài. Báo MỘT lần/6 giờ
    // để họ vào Cài đặt, thay vì im lặng bỏ qua mãi mãi.
    const [hasAi, hasPexels] = await Promise.all([
      userHasAiConfig(config.userId),
      config.autoMedia ? userHasPexelsKey(config.userId) : Promise.resolve(true),
    ]);
    if (!hasAi) {
      await notifyOncePer(config.userId, {
        type: "SYSTEM",
        title: "⚙️ AutoPilot không chạy được vì bạn chưa cấu hình AI",
        body: `Page "${page.name}" đang bật tự động đăng nhưng tài khoản của bạn chưa có AI Provider (Base URL + API Key + model). Vào Cài đặt để nhập key của riêng bạn.`,
        link: "/settings",
      });
      continue;
    }
    if (!hasPexels) {
      await notifyOncePer(config.userId, {
        type: "SYSTEM",
        title: "⚙️ AutoPilot cần Pexels API Key cho bài có ảnh",
        body: `Page "${page.name}" bật tự tìm ảnh nhưng bạn chưa nhập Pexels API Key. Bài vẫn đăng được nhưng sẽ không có ảnh.`,
        link: "/settings",
      });
    }

    // Vừa lỗi gần đây → chờ, tránh gọi AI liên tục khi provider đang hỏng
    if (
      config.lastPlanError &&
      config.lastPlannedAt &&
      now.getTime() - config.lastPlannedAt.getTime() < RETRY_AFTER_ERROR_MS
    ) {
      result.skippedThrottled++;
      continue;
    }

    const outcome = await planForAutoPilot(config, now, page.name, budget, random);
    result.pages.push(outcome);
    result.created += outcome.created;
    result.skipped += outcome.skipped;

    await prisma.autoPilot
      .update({
        where: { id: config.id },
        data: {
          lastPlannedAt: now,
          // Ưu tiên báo lỗi chặn; nếu không có thì báo chuyện thiếu ảnh
          lastPlanError:
            outcome.error ??
            (outcome.missingMedia
              ? `${outcome.missingMedia} bài không tìm được ảnh: ${outcome.mediaWarning}`
              : null),
          lastPlanCount: outcome.created,
          totalPlanned: { increment: outcome.created },
        },
      })
      .catch((err) => {
        // Không chặn luồng nếu không ghi được sổ theo dõi — nhưng PHẢI log,
        // vì nuốt lỗi im lặng từng làm totalPlanned/lastPlanCount sai lệch
        // mà không ai biết (giao diện hiện "0 bài đã tạo" dù đã tạo thật).
        console.error(
          `[tự động] không ghi được sổ theo dõi cho Page ${config.pageId}: ` +
            (err instanceof Error ? err.message : String(err))
        );
      });
  }

  return result;
}

/** Bọc `runAutopilotPlanner` bằng khóa chống chạy chồng. */
export async function runAutopilotPlannerSafely(
  now: Date = new Date()
): Promise<PlannerRunResult | null> {
  const g = globalThis as Record<string, unknown>;
  if (g[RUN_GUARD]) return null;
  g[RUN_GUARD] = true;
  try {
    return await runAutopilotPlanner(now);
  } finally {
    g[RUN_GUARD] = false;
  }
}

// ============================================================
// Truy vấn cho giao diện
// ============================================================

export type AutoPilotOverview = {
  config: AutoPilotConfig | null;
  pageName: string | null;
  upcoming: {
    id: string;
    content: string;
    status: string;
    scheduledAt: string;
    pillarName: string | null;
    topic: string | null;
    mediaCount: number;
  }[];
  /** Số bài tạo tự động trong 7 ngày tới. */
  plannedNext7Days: number;
  /** Số bài đang chờ duyệt. */
  pendingReview: number;
};

export async function getAutoPilotOverview(
  userId: string,
  pageId: string | null
): Promise<AutoPilotOverview> {
  if (!pageId) {
    return { config: null, pageName: null, upcoming: [], plannedNext7Days: 0, pendingReview: 0 };
  }

  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [config, page, upcoming, plannedNext7Days, pendingReview] = await Promise.all([
    prisma.autoPilot.findUnique({ where: { pageId } }),
    prisma.facebookPage.findFirst({ where: { id: pageId, userId }, select: { name: true } }),
    prisma.post.findMany({
      where: {
        pageId,
        origin: "AUTOPILOT",
        status: { in: ["PENDING_REVIEW", "SCHEDULED"] },
      },
      orderBy: { scheduledAt: "asc" },
      take: 12,
      include: { _count: { select: { media: true } } },
    }),
    prisma.post.count({
      where: {
        pageId,
        origin: "AUTOPILOT",
        scheduledAt: { gte: now, lte: weekAhead },
        status: { in: ["PENDING_REVIEW", "SCHEDULED"] },
      },
    }),
    prisma.post.count({ where: { pageId, origin: "AUTOPILOT", status: "PENDING_REVIEW" } }),
  ]);

  return {
    config: config ? (config as unknown as AutoPilotConfig) : null,
    pageName: page?.name ?? null,
    upcoming: upcoming.map((p) => ({
      id: p.id,
      content: p.content,
      status: p.status,
      scheduledAt: p.scheduledAt?.toISOString() ?? "",
      pillarName: p.pillarName,
      topic: p.topic,
      mediaCount: p._count.media,
    })),
    plannedNext7Days,
    pendingReview,
  };
}

// ============================================================
// Danh sách mọi cấu hình tự động (trang quản lý tập trung)
// ============================================================

export type AutoPilotConfigRow = {
  pageId: string;
  pageName: string;
  isActive: boolean;
  brandId: string | null;
  brandName: string | null;
  enabled: boolean;
  mode: string;
  postsPerDay: number;
  windowStart: string;
  windowEnd: string;
  daysOfWeek: string;
  plannedNext7Days: number;
  lastPlanError: string | null;
  hasConfig: boolean;
};

/**
 * Mọi cấu hình autopilot của user — mỗi Page một dòng, kèm thông tin
 * Page/thương hiệu để hiển thị bảng quản lý. Page chưa có cấu hình cũng
 * được liệt kê (hasConfig = false) để người dùng thấy còn thiếu gì.
 */
export async function listAutoPilotConfigs(userId: string): Promise<AutoPilotConfigRow[]> {
  const pages = await prisma.facebookPage.findMany({
    where: { userId, isActive: true },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      isActive: true,
      brandId: true,
      brand: { select: { name: true } },
      autopilot: {
        select: {
          enabled: true,
          mode: true,
          postsPerDay: true,
          windowStart: true,
          windowEnd: true,
          daysOfWeek: true,
          lastPlanError: true,
        },
      },
    },
  });

  if (pages.length === 0) return [];

  const pageIds = pages.map((p) => p.id);

  // Đếm bài đã lên kế hoạch 7 ngày tới cho tất cả Page trong 1 query
  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const planned = await prisma.post.groupBy({
    by: ["pageId"],
    where: {
      pageId: { in: pageIds },
      origin: "AUTOPILOT",
      status: { in: ["SCHEDULED", "PENDING_REVIEW"] },
      scheduledAt: { gte: now, lte: in7Days },
    },
    _count: { _all: true },
  });
  const plannedByPage = new Map(planned.map((r) => [r.pageId, r._count._all]));

  return pages.map((p) => ({
    pageId: p.id,
    pageName: p.name,
    isActive: p.isActive,
    brandId: p.brandId,
    brandName: p.brand?.name ?? null,
    enabled: p.autopilot?.enabled ?? false,
    mode: p.autopilot?.mode ?? "REVIEW",
    postsPerDay: p.autopilot?.postsPerDay ?? 0,
    windowStart: p.autopilot?.windowStart ?? "07:00",
    windowEnd: p.autopilot?.windowEnd ?? "21:00",
    daysOfWeek: p.autopilot?.daysOfWeek ?? "0,1,2,3,4,5,6",
    plannedNext7Days: plannedByPage.get(p.id) ?? 0,
    lastPlanError: p.autopilot?.lastPlanError ?? null,
    hasConfig: Boolean(p.autopilot),
  }));
}
