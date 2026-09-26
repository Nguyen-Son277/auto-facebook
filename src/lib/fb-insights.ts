import "server-only";

import { prisma } from "./prisma";
import { fbFetch, type GraphContext } from "./facebook";
import { resolveConnection } from "./facebook-connection";
import { notifyOncePer } from "./notify";
import { formatDateKey } from "./autopilot-plan";
import {
  ALL_POST_METRICS,
  ALL_PAGE_METRICS,
  INSIGHT_METRIC_GROUPS,
  isInvalidMetricError,
  isLowFansError,
  isNotFoundError,
  isTokenInvalidError,
  isMatureForLearning,
  insightFreshness,
  MINIMAL_DISTRIBUTION_METRIC,
  numericMetric,
  PAGE_METRIC_GROUPS,
  parseInsightPayload,
  parseInteractionSummary,
  sumNumericRecord,
  type MetricValue,
  type ParsedMetrics,
} from "./insights-core";

// ============================================================
// THU THẬP SỐ LIỆU HIỆU QUẢ TỪ FACEBOOK
//
// Đây là tầng DUY NHẤT gọi Graph API cho số liệu. Toàn bộ phần quyết định
// (xếp hạng, đề xuất, nhận xét) nằm ở các module thuần — nhờ vậy logic dễ sai
// nhất vẫn kiểm thử được mà không cần mạng.
//
// BA NGUYÊN TẮC CỦA TẦNG NÀY
//
// 1. KHÔNG BAO GIỜ NÉM LỖI RA NGOÀI. Hàm ở đây chạy trong vòng lặp scheduler;
//    ném lỗi sẽ làm hỏng cả nhịp đó (kể cả việc đăng bài đến hạn). Mọi lỗi
//    được ghi vào trạng thái của Page/bài và trả về bình thường.
//
// 2. HẠN MỨC CHẶT. Mỗi lượt chạy giới hạn số Page và số lệnh gọi, vì hàm này
//    chạy nền định kỳ cho MỌI Page đã bật tối ưu. Không có trần thì vài chục
//    Page là hết quota Graph API và Facebook bắt đầu chặn.
//
// 3. LÙI THEO LOẠI LỖI. Lỗi metric bị bỏ → xin lại nhóm nhỏ hơn. Lỗi thiếu
//    quyền / Page ít người thích / token hỏng → lùi 7 ngày (xem
//    insightRetryMs trong insights-core.ts) thay vì thử lại mỗi nhịp.
// ============================================================

/** Số Page tối đa được thu thập số liệu trong MỘT lượt chạy nền. */
export const MAX_PAGES_PER_INSIGHTS_RUN = 3;
/** Trần số lệnh gọi Graph API trong một lượt chạy. */
export const MAX_API_CALLS_PER_RUN = 60;
/** Số bài tối đa cập nhật tương tác mỗi Page mỗi lượt. */
export const MAX_POSTS_PER_PAGE_REFRESH = 25;
/** Số bài tối đa lấy insights sâu (tốn 1–2 lệnh/bài) mỗi Page mỗi lượt. */
export const MAX_DEEP_INSIGHTS_PER_RUN = 15;
/** Cửa sổ bài đã đăng cần theo dõi (ngày). */
const TRACKING_WINDOW_DAYS = 90;

export type RefreshOutcome = {
  pageId: string;
  pageName: string;
  /** Số bài được ghi số liệu. */
  updated: number;
  /** Số bài đã đủ chín và có số liệu phân phối. */
  deep: number;
  status: string;
  error?: string;
  /** Số lệnh gọi Graph API đã dùng. */
  calls: number;
};

// ============================================================
// Gọi Graph API
// ============================================================

/**
 * Một lệnh gọi insights, có thể thất bại theo cách "metric bị bỏ".
 *
 * Trả về `rejected: true` kèm danh sách metric bị từ chối thay vì ném lỗi —
 * nhờ vậy tầng gọi tự quyết định xin lại nhóm nhỏ hơn, còn module này không
 * phải biết chi tiết về từng metric.
 */
export type InsightFetchResult =
  | { ok: true; parsed: ParsedMetrics }
  | { ok: false; rejected: true; metrics: string[] }
  | { ok: false; rejected: false; error: unknown };

export async function fetchInsightsFor(
  objectId: string,
  metrics: string[],
  accessToken: string,
  conn: GraphContext | null
): Promise<InsightFetchResult> {
  try {
    const raw = await fbFetch(
      `${objectId}/insights`,
      accessToken,
      { metric: metrics.join(",") },
      { conn }
    );
    return { ok: true, parsed: parseInsightPayload(raw, metrics) };
  } catch (err) {
    if (isInvalidMetricError(err)) {
      return { ok: false, rejected: true, metrics };
    }
    return { ok: false, rejected: false, error: err };
  }
}

/**
 * Xin trọn bộ metric của một đối tượng, tự lùi khi Facebook từ chối metric.
 *
 * CHIẾN LƯỢC LÙI — hai bước, không hơn:
 *   1. Xin cả bộ. Facebook trả lỗi "invalid metric" nếu CHỈ MỘT metric trong
 *      danh sách đã bị ngừng hỗ trợ (lỗi 3001/1504028) → cả lệnh hỏng.
 *   2. Xin lại danh sách ĐÃ LỌC: bỏ những metric thuộc nhóm bị từ chối (dò
 *      lần lượt từng nhóm). Với nhóm distribution, thử thêm metric tối thiểu
 *      một lần vì đó là nhóm quan trọng nhất.
 *
 * Sau hai bước vẫn hỏng thì chấp nhận không có số liệu phân phối, KHÔNG thử
 * tiếp: mỗi lần thử là một lệnh gọi, và lỗi lặp lại thì gần như chắc chắn là
 * do quyền chứ không phải do metric.
 */
export async function fetchInsightsResilient(
  objectId: string,
  groups: { key: string; metrics: string[] }[],
  accessToken: string,
  conn: GraphContext | null,
  budget: { remaining: number }
): Promise<{
  values: Record<string, MetricValue>;
  missing: string[];
  calls: number;
  permissionError: boolean;
  lowFans: boolean;
}> {
  const all = groups.flatMap((g) => g.metrics);
  const empty = { values: {}, missing: all, calls: 0, permissionError: false, lowFans: false };

  if (budget.remaining <= 0) return { ...empty, missing: all };

  let calls = 0;
  budget.remaining--;
  calls++;

  const first = await fetchInsightsFor(objectId, all, accessToken, conn);

  if (first.ok) {
    return {
      values: first.parsed.values,
      missing: first.parsed.missing,
      calls,
      permissionError: false,
      lowFans: false,
    };
  }

  if (!first.rejected) {
    const err = first.error;
    return {
      ...empty,
      calls,
      permissionError: isTokenInvalidError(err),
      lowFans: isLowFansError(err),
    };
  }

  // ---- Bước 2: dò từng nhóm để tìm nhóm nào bị từ chối ----
  const values: Record<string, MetricValue> = {};
  const missing: string[] = [];

  for (const group of groups) {
    if (budget.remaining <= 0) {
      missing.push(...group.metrics);
      continue;
    }
    budget.remaining--;
    calls++;

    const res = await fetchInsightsFor(objectId, group.metrics, accessToken, conn);
    if (res.ok) {
      Object.assign(values, res.parsed.values);
      missing.push(...res.parsed.missing);
      continue;
    }
    if (res.rejected) {
      // Cả nhóm bị bỏ. Riêng nhóm phân phối thử lại với một metric tối thiểu —
      // mất nó thì chỉ còn xếp hạng theo tương tác, kém chính xác hơn hẳn.
      if (group.key === "distribution" && budget.remaining > 0) {
        budget.remaining--;
        calls++;
        const minimal = await fetchInsightsFor(
          objectId,
          [MINIMAL_DISTRIBUTION_METRIC],
          accessToken,
          conn
        );
        if (minimal.ok) {
          Object.assign(values, minimal.parsed.values);
          missing.push(...group.metrics.filter((m) => m !== MINIMAL_DISTRIBUTION_METRIC));
          continue;
        }
      }
      missing.push(...group.metrics);
      continue;
    }

    // Lỗi không phải metric → dừng luôn, ghi nhận lỗi quyền nếu là lỗi token
    missing.push(...group.metrics);
    if (isTokenInvalidError(res.error)) {
      return { values, missing, calls, permissionError: true, lowFans: false };
    }
    if (isLowFansError(res.error)) {
      return { values, missing, calls, permissionError: false, lowFans: true };
    }
  }

  return { values, missing, calls, permissionError: false, lowFans: false };
}

// ============================================================
// Tương tác (không cần read_insights)
// ============================================================

/**
 * Lấy cảm xúc / bình luận / chia sẻ của các bài gần đây của một Page.
 *
 * Vì sao dùng `/{page-id}/posts` thay vì đọc từng bài: MỘT lệnh gọi cho cả 50
 * bài, trong khi đọc từng bài tốn 50 lệnh. Đây là nhóm số liệu duy nhất lấy
 * được mà không cần `read_insights`, nên nó cũng là đường lùi khi thiếu quyền.
 *
 * `summary(true).limit(0)` = lấy TỔNG số lượng mà không kéo về danh sách
 * người đã tương tác — nếu không, response có thể nặng hàng trăm KB mỗi bài.
 */
export async function fetchRecentPostsInteractions(
  fbPageId: string,
  accessToken: string,
  conn: GraphContext | null,
  budget: { remaining: number }
): Promise<ReturnType<typeof parseInteractionSummary>> {
  if (budget.remaining <= 0) return new Map();
  budget.remaining--;

  const raw = await fbFetch(
    `${fbPageId}/posts`,
    accessToken,
    {
      fields:
        "id,created_time,reactions.summary(true).limit(0),comments.summary(true).limit(0),shares",
      limit: "50",
    },
    { conn }
  );

  return parseInteractionSummary(raw);
}

// ============================================================
// Làm mới số liệu cho một Page
// ============================================================

type PageRow = {
  id: string;
  name: string;
  fbPageId: string;
  accessToken: string;
  userId: string;
  workspaceId: string;
  connectionId: string | null;
  insightsStatus: string;
  insightsLastFetchedAt: Date | null;
};

async function graphContextFor(
  connectionId: string | null
): Promise<GraphContext | null> {
  if (!connectionId) return null;
  const resolved = await resolveConnection(connectionId);
  if (!resolved) return null;
  return {
    appId: resolved.appId,
    appSecret: resolved.appSecret,
    graphVersion: resolved.graphVersion,
  };
}

/**
 * Làm mới số liệu của MỘT Page.
 *
 * Trình tự có chủ đích:
 *   1. Cập nhật tương tác cho mọi bài PUBLISHED có fbPostId (rẻ, 1 lệnh/Page).
 *      Làm bước này TRƯỚC để dù các bước sau có lỗi thì Page vẫn có dữ liệu mới.
 *   2. Lấy insights "sâu" cho những bài đã đủ chín và tới hạn làm mới.
 *   3. Ghi snapshot cấp Page cho ngày hôm nay.
 *
 * Không bao giờ ném lỗi ra ngoài — mọi thất bại được ghi vào
 * `FacebookPage.insightsStatus` + `insightsLastError` và trả về trong outcome.
 */
export async function refreshInsightsForPage(
  pageId: string,
  opts: { now?: Date; budget?: { remaining: number } } = {}
): Promise<RefreshOutcome> {
  const now = opts.now ?? new Date();
  const budget = opts.budget ?? { remaining: MAX_API_CALLS_PER_RUN };

  const page = (await prisma.facebookPage.findUnique({
    where: { id: pageId },
    select: {
      id: true,
      name: true,
      fbPageId: true,
      accessToken: true,
      userId: true,
      workspaceId: true,
      connectionId: true,
      insightsStatus: true,
      insightsLastFetchedAt: true,
    },
  })) as PageRow | null;

  if (!page) {
    return {
      pageId,
      pageName: "",
      updated: 0,
      deep: 0,
      status: "ERROR",
      error: "Page không tồn tại.",
      calls: 0,
    };
  }

  const outcome: RefreshOutcome = {
    pageId,
    pageName: page.name,
    updated: 0,
    deep: 0,
    status: "OK",
    calls: 0,
  };

  const startedCalls = budget.remaining;
  const conn = await graphContextFor(page.connectionId);

  // Bài AutoPilot đã đăng trong cửa sổ theo dõi, mới nhất trước
  const windowStart = new Date(now.getTime() - TRACKING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const posts = await prisma.post.findMany({
    where: {
      pageId,
      origin: "AUTOPILOT",
      status: "PUBLISHED",
      fbPostId: { not: null },
      publishedAt: { gte: windowStart },
    },
    orderBy: { publishedAt: "desc" },
    take: 150,
    select: {
      id: true,
      fbPostId: true,
      publishedAt: true,
      insight: { select: { status: true, fetchedAt: true } },
    },
  });

  if (posts.length === 0) {
    // Chưa có bài nào lên sóng — không phải lỗi, chỉ là chưa có gì để đọc.
    await markPage(pageId, "OK", now, null);
    return outcome;
  }

  // ---------- Bước 1: tương tác (luôn chạy được) ----------
  try {
    const interactions = await fetchRecentPostsInteractions(
      page.fbPageId,
      page.accessToken,
      conn,
      budget
    );

    for (const post of posts.slice(0, MAX_POSTS_PER_PAGE_REFRESH)) {
      if (!post.fbPostId) continue;
      const hit = interactions.get(post.fbPostId);
      if (!hit) continue;

      await upsertInsight({
        post,
        page,
        fbPostId: post.fbPostId,
        reactions: hit.reactions,
        comments: hit.comments,
        shares: hit.shares,
        now,
      });
      outcome.updated++;
    }
  } catch (err) {
    if (isTokenInvalidError(err)) {
      await markPage(pageId, "TOKEN_INVALID", null, messageOf(err));
      await notifyInsightsIssue(page, "TOKEN_INVALID");
      outcome.status = "TOKEN_INVALID";
      outcome.error = messageOf(err);
      outcome.calls = startedCalls - budget.remaining;
      return outcome;
    }

    if (isLowFansError(err)) {
      await markPage(pageId, "LOW_FANS", now, messageOf(err));
      await notifyInsightsIssue(page, "LOW_FANS");
      outcome.status = "LOW_FANS";
      outcome.error = messageOf(err);
      outcome.calls = startedCalls - budget.remaining;
      return outcome;
    }

    // Bài bị xoá / không có quyền xem bài cụ thể → không chặn phần còn lại
    console.error(
      `[insights] không lấy được tương tác của Page ${page.name}: ${messageOf(err)}`
    );
  }

  // ---------- Bước 2: insights sâu cho bài đã chín ----------
  const mature = posts.filter(
    (p) => isMatureForLearning(p.publishedAt, now) && p.insight === null
  );
  const needsRefresh = posts.filter((p) => {
    if (!p.insight) return false;
    if (!isMatureForLearning(p.publishedAt, now)) return false;
    return insightFreshness(p.insight.status, p.insight.fetchedAt, now).stale;
  });

  const deepTargets = [...mature, ...needsRefresh].slice(0, MAX_DEEP_INSIGHTS_PER_RUN);

  let permissionError = false;
  let lowFans = false;

  for (const post of deepTargets) {
    if (budget.remaining <= 0) break;
    if (!post.fbPostId) continue;

    const res = await fetchInsightsResilient(
      post.fbPostId,
      INSIGHT_METRIC_GROUPS,
      page.accessToken,
      conn,
      budget
    );

    if (res.permissionError) {
      permissionError = true;
      break;
    }
    if (res.lowFans) {
      lowFans = true;
      break;
    }

    const status = res.missing.length === 0 ? "OK" : "PARTIAL";
    await upsertInsight({
      post,
      page,
      fbPostId: post.fbPostId,
      distribution: {
        impressions: numericMetric(res.values, "post_impressions"),
        mediaView: numericMetric(res.values, "post_media_view"),
        mediaViewUnique: numericMetric(res.values, "post_total_media_view_unique"),
        videoViews: numericMetric(res.values, "post_video_views"),
        videoAvgTimeMs: numericMetric(res.values, "post_video_avg_time_watched"),
        clicks: numericMetric(res.values, "post_clicks"),
      },
      // Tổng cảm xúc theo loại là nguồn chính xác hơn summary từ /posts, nên
      // dùng nó khi có — nhưng chỉ ghi đè khi thực sự lấy được số.
      reactionsFromMetrics: sumNumericRecord(res.values["post_reactions_by_type_total"]),
      missingMetrics: res.missing,
      status,
      now,
    });
    outcome.deep++;
  }

  // ---------- Bước 3: snapshot cấp Page ----------
  if (budget.remaining > 0) {
    try {
      const pageRes = await fetchInsightsResilient(
        page.fbPageId,
        PAGE_METRIC_GROUPS,
        page.accessToken,
        conn,
        budget
      );

      if (pageRes.permissionError) permissionError = true;
      if (pageRes.lowFans) lowFans = true;

      if (!permissionError && !lowFans) {
        await prisma.pageInsightSnapshot.upsert({
          where: { pageId_dayKey: { pageId, dayKey: formatDateKey(now) } },
          update: {
            workspaceId: page.workspaceId,
            fans: numericMetric(pageRes.values, "page_fans"),
            follows: numericMetric(pageRes.values, "page_follows"),
            pageImpressions: numericMetric(pageRes.values, "page_impressions"),
            mediaView: numericMetric(pageRes.values, "page_media_view"),
            mediaViewUnique: numericMetric(pageRes.values, "page_total_media_view_unique"),
            postEngagements: numericMetric(pageRes.values, "page_post_engagements"),
            pageViewsTotal: numericMetric(pageRes.values, "page_views_total"),
            topCitiesJson: topCitiesJson(pageRes.values["page_fans_city"]),
            missingMetrics: JSON.stringify(pageRes.missing),
            status: pageRes.missing.length === 0 ? "OK" : "PARTIAL",
            errorMessage: null,
            fetchedAt: now,
          },
          create: {
            pageId,
            workspaceId: page.workspaceId,
            dayKey: formatDateKey(now),
            fans: numericMetric(pageRes.values, "page_fans"),
            follows: numericMetric(pageRes.values, "page_follows"),
            pageImpressions: numericMetric(pageRes.values, "page_impressions"),
            mediaView: numericMetric(pageRes.values, "page_media_view"),
            mediaViewUnique: numericMetric(pageRes.values, "page_total_media_view_unique"),
            postEngagements: numericMetric(pageRes.values, "page_post_engagements"),
            pageViewsTotal: numericMetric(pageRes.values, "page_views_total"),
            topCitiesJson: topCitiesJson(pageRes.values["page_fans_city"]),
            missingMetrics: JSON.stringify(pageRes.missing),
            status: pageRes.missing.length === 0 ? "OK" : "PARTIAL",
            fetchedAt: now,
          },
        });
      }
    } catch (err) {
      console.error(
        `[insights] không lấy được số liệu cấp Page của ${page.name}: ${messageOf(err)}`
      );
    }
  }

  // ---------- Trạng thái cuối ----------
  let status = "OK";
  if (permissionError) status = "NO_PERMISSION";
  else if (lowFans) status = "LOW_FANS";
  else if (outcome.deep === 0 && outcome.updated > 0) status = "PARTIAL";

  await markPage(pageId, status, now, null);
  if (status === "NO_PERMISSION") await notifyInsightsIssue(page, "NO_PERMISSION");

  outcome.status = status;
  outcome.calls = startedCalls - budget.remaining;
  return outcome;
}

// ============================================================
// Ghi dữ liệu
// ============================================================

/** Ghi/cập nhật số liệu của một bài. Chỉ ghi đè trường khi có giá trị mới. */
async function upsertInsight(input: {
  post: { id: string; fbPostId: string | null; publishedAt: Date | null };
  page: { id: string; workspaceId: string };
  fbPostId: string;
  reactions?: number;
  comments?: number;
  shares?: number;
  distribution?: {
    impressions: number | null;
    mediaView: number | null;
    mediaViewUnique: number | null;
    videoViews: number | null;
    videoAvgTimeMs: number | null;
    clicks: number | null;
  };
  reactionsFromMetrics?: number | null;
  missingMetrics?: string[];
  status?: string;
  now: Date;
}) {
  const { post, page, now } = input;

  await prisma.postInsight.upsert({
    where: { postId: post.id },
    update: {
      fbPostId: input.fbPostId,
      ...(input.reactions !== undefined ? { reactions: input.reactions } : {}),
      ...(input.comments !== undefined ? { comments: input.comments } : {}),
      ...(input.shares !== undefined ? { shares: input.shares } : {}),
      ...(input.reactionsFromMetrics != null
        ? { reactions: input.reactionsFromMetrics }
        : {}),
      ...(input.distribution ?? {}),
      ...(input.missingMetrics ? { missingMetrics: JSON.stringify(input.missingMetrics) } : {}),
      ...(input.status ? { status: input.status } : {}),
      fetchedAt: now,
      errorMessage: null,
    },
    create: {
      postId: post.id,
      pageId: page.id,
      workspaceId: page.workspaceId,
      fbPostId: input.fbPostId,
      reactions: input.reactionsFromMetrics ?? input.reactions ?? 0,
      comments: input.comments ?? 0,
      shares: input.shares ?? 0,
      impressions: input.distribution?.impressions ?? null,
      mediaView: input.distribution?.mediaView ?? null,
      mediaViewUnique: input.distribution?.mediaViewUnique ?? null,
      videoViews: input.distribution?.videoViews ?? null,
      videoAvgTimeMs: input.distribution?.videoAvgTimeMs ?? null,
      clicks: input.distribution?.clicks ?? null,
      missingMetrics: input.missingMetrics ? JSON.stringify(input.missingMetrics) : null,
      status: input.status ?? "OK",
      fetchedAt: now,
    },
  });
}

async function markPage(
  pageId: string,
  status: string,
  fetchedAt: Date | null,
  error: string | null
) {
  await prisma.facebookPage
    .update({
      where: { id: pageId },
      data: {
        insightsStatus: status,
        ...(fetchedAt ? { insightsLastFetchedAt: fetchedAt } : {}),
        insightsLastError: error,
      },
    })
    .catch((err) =>
      console.error(
        `[insights] không ghi được trạng thái Page ${pageId}: ${messageOf(err)}`
      )
    );
}

/**
 * `page_fans_city` trả object { "Hồ Chí Minh": 1234, ... }.
 * Sắp xếp giảm dần và chỉ giữ 5 thành phố để không phình DB.
 */
function topCitiesJson(value: MetricValue | undefined): string | null {
  if (!value || typeof value !== "object") return null;
  const entries = Object.entries(value)
    .filter(([, count]) => typeof count === "number" && Number.isFinite(count))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([city, count]) => ({ city, count }));
  return entries.length > 0 ? JSON.stringify(entries) : null;
}

/**
 * Báo người dùng khi việc lấy số liệu không chạy được vì lý do CẦN HỌ HÀNH ĐỘNG.
 *
 * Dùng `notifyOncePer` (6 giờ) vì hàm này chạy mỗi nhịp scheduler: nếu báo mỗi
 * lần thì cùng một lỗi cấp quyền sẽ tạo hàng trăm thông báo giống nhau — đúng
 * lỗi đã từng xảy ra với thông báo AutoPilot (xem lib/scheduler.ts).
 */
async function notifyInsightsIssue(
  page: { name: string; userId: string },
  kind: "NO_PERMISSION" | "LOW_FANS" | "TOKEN_INVALID"
) {
  const payload =
    kind === "NO_PERMISSION"
      ? {
          title: "📉 Chưa đọc được lượt xem bài đăng (thiếu quyền read_insights)",
          body:
            `Page "${page.name}" chưa lấy được số lượt hiển thị/tiếp cận nên phần tối ưu chỉ xếp hạng theo tương tác. ` +
            "Thêm quyền read_insights cho Facebook App rồi đồng bộ lại ở trang Facebook Apps.",
          link: "/insights",
        }
      : kind === "LOW_FANS"
        ? {
            title: "📊 Page chưa đủ điều kiện lấy số liệu chi tiết",
            body:
              `Facebook chỉ cung cấp số liệu Insights cho Page có từ 100 lượt thích trở lên. ` +
              `Page "${page.name}" hiện chưa đủ, nên hệ thống xếp hạng theo tương tác (cảm xúc, bình luận, chia sẻ).`,
            link: "/insights",
          }
        : {
            title: "🔑 Token của Page đã hết hiệu lực nên không lấy được số liệu",
            body: `Hãy vào trang Facebook Apps để đồng bộ lại token cho Page "${page.name}".`,
            link: "/facebook-apps",
          };

  await notifyOncePer(page.userId, {
    type: "SYSTEM",
    ...payload,
  });
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ============================================================
// Chọn Page cần làm mới
// ============================================================

/**
 * Danh sách Page nên làm mới ở lượt chạy này.
 *
 * Thứ tự: Page CHƯA từng lấy (NULL trước) rồi tới Page cũ nhất. Nhờ vậy Page
 * mới bật tối ưu được lấy số liệu ngay lượt đầu, không phải xếp sau hàng chục
 * Page đã có dữ liệu — đúng cảm giác "vừa bật là thấy số liệu".
 *
 * Bỏ qua Page đã lùi theo lịch (lỗi quyền/ít người thích/token hỏng) chưa tới
 * hạn thử lại; Page `UNKNOWN`/chưa từng lấy luôn được xét.
 */
export async function pagesDueForInsights(
  now: Date,
  limit: number = MAX_PAGES_PER_INSIGHTS_RUN
): Promise<string[]> {
  const candidates = await prisma.facebookPage.findMany({
    where: {
      isActive: true,
      autopilot: { insightsEnabled: true },
    },
    orderBy: [{ insightsLastFetchedAt: { sort: "asc", nulls: "first" } }],
    take: limit * 4,
    select: {
      id: true,
      insightsStatus: true,
      insightsLastFetchedAt: true,
    },
  });

  const due: string[] = [];
  for (const page of candidates) {
    if (due.length >= limit) break;
    const { stale } = insightFreshness(
      page.insightsStatus,
      page.insightsLastFetchedAt,
      now
    );
    if (stale) due.push(page.id);
  }

  return due;
}

export { ALL_POST_METRICS, ALL_PAGE_METRICS, isNotFoundError };
