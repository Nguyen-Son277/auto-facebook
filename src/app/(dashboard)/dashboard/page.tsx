import { formatDateTime, APP_TIME_ZONE } from "@/lib/format-date";
import Link from "next/link";
import { requireCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import PageHeader from "@/components/page-header";
import SchedulerBanner from "@/components/scheduler-banner";
import OnboardingGuide from "@/components/onboarding-guide";
import { StatusDonut, WeekBars, type WeekDay } from "@/components/dashboard-charts";
import { getUserSetting, SETTING_KEYS } from "@/lib/settings";
import { getSchedulerStatus } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

/** Khóa ngày "YYYY-MM-DD" theo múi giờ Việt Nam — dù server chạy UTC. */
function dayKeyOf(value: Date | string): string {
  return new Date(value).toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE });
}

/** Đổi "YYYY-MM-DD" → nhãn thứ trong tuần tiếng Việt ("Th 2", "Th 3"…). */
function weekdayLabel(key: string): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString("vi-VN", {
    weekday: "short",
    timeZone: "UTC",
  });
}

/** Ngày dài không dấu ("Thứ Hai, 06/10/2025") — đồng bộ server/trình duyệt. */
function longToday(): string {
  const now = new Date();
  const weekday = now.toLocaleDateString("vi-VN", {
    weekday: "long",
    timeZone: APP_TIME_ZONE,
  });
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${now.toLocaleDateString(
    "vi-VN",
    { timeZone: APP_TIME_ZONE }
  )}`;
}

export default async function DashboardPage() {
  const user = await requireCurrentUser();

  // Cửa sổ 7 ngày theo ngày Việt Nam (để biểu đồ không lệch ngày)
  const todayKey = dayKeyOf(new Date());
  const dayKeys: string[] = [];
  for (let i = 6; i >= 0; i--) {
    dayKeys.push(
      new Date(Date.parse(`${todayKey}T00:00:00Z`) - i * DAY_MS).toISOString().slice(0, 10)
    );
  }
  const windowStart = new Date(`${dayKeys[0]}T00:00:00+07:00`);
  const prevWindowStart = new Date(windowStart.getTime() - 7 * DAY_MS);

  const [
    pagesCount,
    postsTotal,
    published,
    scheduled,
    drafts,
    failed,
    recentPosts,
    scheduler,
    onboardingDone,
    weekPosts,
    prevWeekCount,
  ] = await Promise.all([
    prisma.facebookPage.count({ where: { userId: user.id, isActive: true } }),
    prisma.post.count({ where: { userId: user.id } }),
    prisma.post.count({ where: { userId: user.id, status: "PUBLISHED" } }),
    prisma.post.count({ where: { userId: user.id, status: "SCHEDULED" } }),
    prisma.post.count({ where: { userId: user.id, status: "DRAFT" } }),
    prisma.post.count({ where: { userId: user.id, status: "FAILED" } }),
    prisma.post.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { page: true, media: true },
    }),
    getSchedulerStatus(user.id),
    getUserSetting(user.id, SETTING_KEYS.APP.onboardingDone),
    prisma.post.findMany({
      where: { userId: user.id, createdAt: { gte: windowStart } },
      select: { createdAt: true },
    }),
    prisma.post.count({
      where: { userId: user.id, createdAt: { gte: prevWindowStart, lt: windowStart } },
    }),
  ]);

  const showOnboarding = onboardingDone !== "1";

  // ---- Biểu đồ 7 ngày ----
  const byDay = new Map<string, number>(dayKeys.map((k) => [k, 0]));
  for (const post of weekPosts) {
    const key = dayKeyOf(post.createdAt);
    if (byDay.has(key)) byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  const week: WeekDay[] = dayKeys.map((key) => ({
    key,
    label: weekdayLabel(key),
    count: byDay.get(key) ?? 0,
  }));
  const weekTotal = week.reduce((sum, d) => sum + d.count, 0);
  const delta =
    prevWeekCount === 0
      ? null
      : Math.round(((weekTotal - prevWeekCount) / prevWeekCount) * 100);

  const publishedShare =
    postsTotal === 0 ? 0 : Math.round((published / postsTotal) * 100);

  const stats = [
    {
      label: "Pages đã kết nối",
      value: pagesCount,
      icon: "📄",
      tone: "ui-tile-blue",
      href: "/pages",
      sub: pagesCount > 0 ? "Sẵn sàng nhận bài đăng" : "Chưa có Page nào",
    },
    {
      label: "Tổng số bài",
      value: postsTotal,
      icon: "📝",
      tone: "ui-tile-violet",
      href: "/calendar",
      sub: drafts > 0 ? `${drafts} bản nháp chưa đăng` : "Không còn bản nháp",
    },
    {
      label: "Đã đăng",
      value: published,
      icon: "✅",
      tone: "ui-tile-emerald",
      href: "/history?status=PUBLISHED",
      sub: postsTotal > 0 ? `${publishedShare}% tổng số bài` : "Chưa có bài nào",
    },
    {
      label: "Đang chờ lịch",
      value: scheduled,
      icon: "⏰",
      tone: "ui-tile-amber",
      href: "/calendar",
      sub:
        scheduler.nextScheduledAt
          ? `Bài kế tiếp ${formatDateTime(scheduler.nextScheduledAt).slice(0, -3)}`
          : scheduled > 0
            ? "Chờ tới giờ đăng"
            : "Không có lịch hẹn nào",
    },
  ];

  const statusBadge: Record<string, { label: string; cls: string }> = {
    DRAFT: { label: "Nháp", cls: "bg-gray-100 text-gray-600" },
    SCHEDULED: { label: "Đã lên lịch", cls: "bg-amber-100 text-amber-700" },
    PUBLISHING: { label: "Đang đăng", cls: "bg-blue-100 text-blue-700" },
    PUBLISHED: { label: "Đã đăng", cls: "bg-emerald-100 text-emerald-700" },
    FAILED: { label: "Lỗi", cls: "bg-red-100 text-red-700" },
  };

  const quickActions = [
    {
      href: "/composer",
      icon: "✍️",
      tone: "ui-tile-blue",
      title: "Soạn bài mới",
      desc: "AI viết nội dung + tìm ảnh phù hợp",
      primary: true,
    },
    {
      href: "/pages",
      icon: "🔗",
      tone: "ui-tile-cyan",
      title: "Kết nối Page",
      desc: "Thêm Page Facebook để nhận bài đăng",
    },
    {
      href: "/autopilot",
      icon: "🤖",
      tone: "ui-tile-violet",
      title: "Bật tự động đăng",
      desc: "Để AI lên lịch và đăng theo lịch bạn đặt",
    },
  ];

  return (
    <div>
      <PageHeader
        title={`Xin chào, ${user.name ?? "bạn"} 👋`}
        description={`${longToday()} · Tổng quan hoạt động đăng bài của bạn`}
        actions={
          <>
            <Link href="/calendar" className="ui-btn ui-btn-ghost">
              <span aria-hidden>📅</span>
              Lịch đăng
            </Link>
            <Link href="/composer" className="ui-btn ui-btn-primary">
              <span aria-hidden>✍️</span>
              Soạn bài mới
            </Link>
          </>
        }
      />

      <div className="space-y-6">
      {showOnboarding && <OnboardingGuide />}

      {/* ===== Thẻ thống kê ===== */}
      <section aria-label="Chỉ số tổng quan" className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {stats.map((s, i) => (
          <Link
            key={s.label}
            href={s.href}
            className="ui-card ui-card-hover ui-rise block p-4 sm:p-5"
            style={{ "--rise-delay": `${i * 70}ms` } as unknown as React.CSSProperties}
          >
            <div className="flex items-start justify-between gap-3">
              <span className={`ui-tile ${s.tone}`} aria-hidden>
                {s.icon}
              </span>
              <span aria-hidden className="text-gray-300 transition group-hover:translate-x-0.5">
                →
              </span>
            </div>
            <p className="ui-stat-value mt-4">{s.value}</p>
            <p className="mt-1 text-sm font-semibold text-gray-700">{s.label}</p>
            <p className="mt-1 truncate text-xs text-gray-400">{s.sub}</p>
          </Link>
        ))}
      </section>

      {/* ===== Biểu đồ ===== */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="ui-card ui-rise p-5 lg:col-span-2" style={{ "--rise-delay": "240ms" } as unknown as React.CSSProperties}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="ui-section-title">Nhịp đăng 7 ngày qua</h2>
              <p className="text-xs text-gray-500">Số bài được tạo trong tuần này</p>
            </div>
            <span
              className={`ui-chip ${
                delta === null
                  ? "bg-gray-100 text-gray-500"
                  : delta >= 0
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-red-100 text-red-700"
              }`}
            >
              {weekTotal} bài tuần này
              {delta !== null && (
                <span aria-hidden>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}%</span>
              )}
            </span>
          </div>
          <WeekBars days={week} ariaLabel="Bài tạo theo ngày trong 7 ngày qua" />
        </div>

        <div className="ui-card ui-rise p-5" style={{ "--rise-delay": "320ms" } as unknown as React.CSSProperties}>
          <div className="mb-4">
            <h2 className="ui-section-title">Trạng thái bài đăng</h2>
            <p className="text-xs text-gray-500">Cả {postsTotal} bài của bạn</p>
          </div>
          {postsTotal === 0 ? (
            <div className="flex h-36 flex-col items-center justify-center rounded-xl bg-sunken text-center">
              <span className="text-2xl" aria-hidden>
                🌱
              </span>
              <p className="mt-2 text-sm text-gray-500">
                Chưa có bài nào — bắt đầu từ{" "}
                <Link href="/composer" className="font-medium text-blue-600 hover:underline">
                  Soạn bài
                </Link>
                .
              </p>
            </div>
          ) : (
            <StatusDonut
              segments={[
                { label: "Đã đăng", value: published, color: "emerald-500" },
                { label: "Đã lên lịch", value: scheduled, color: "amber-500" },
                { label: "Bản nháp", value: drafts, color: "blue-500" },
                { label: "Lỗi", value: failed, color: "red-400" },
              ]}
            />
          )}
        </div>
      </section>

      <SchedulerBanner status={scheduler} canManage={user.role === "ADMIN"} />

      {/* ===== Gần đây + thao tác nhanh ===== */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="ui-card lg:col-span-2">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <div>
              <h2 className="ui-section-title">Bài đăng gần đây</h2>
              <p className="text-xs text-gray-500">5 bài mới nhất trong không gian làm việc</p>
            </div>
            <Link
              href="/history"
              className="ui-btn ui-btn-soft ui-btn-sm"
            >
              Xem tất cả →
            </Link>
          </div>

          {recentPosts.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <div className="ui-tile ui-tile-lg ui-tile-slate mx-auto" aria-hidden>
                📝
              </div>
              <p className="mt-3 text-sm font-medium text-gray-700">Chưa có bài nào</p>
              <p className="mt-1 text-sm text-gray-500">
                Bắt đầu bằng cách{" "}
                <Link href="/composer" className="font-medium text-blue-600 hover:underline">
                  soạn bài mới
                </Link>
                .
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {recentPosts.map((post) => {
                const badge = statusBadge[post.status] ?? statusBadge.DRAFT;
                return (
                  <li key={post.id}>
                    <Link
                      href={`/posts/${post.id}`}
                      className="flex items-center gap-4 px-5 py-3 transition hover:bg-gray-50"
                    >
                      {post.media[0]?.previewUrl || post.media[0]?.remoteUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={post.media[0].previewUrl ?? post.media[0].remoteUrl}
                          alt=""
                          className="h-11 w-11 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <span className="ui-tile ui-tile-sm ui-tile-slate" aria-hidden>
                          📝
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">
                          {post.content || "(Chưa có nội dung)"}
                        </p>
                        <p className="truncate text-xs text-gray-500">
                          {post.page?.name ?? "Chưa chọn Page"} ·{" "}
                          {formatDateTime(post.createdAt)}
                        </p>
                      </div>
                      <span
                        className={`ui-chip shrink-0 ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                      <span aria-hidden className="text-sm text-gray-300">
                        ›
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Cột phải: thao tác nhanh + bản nháp */}
        <div className="space-y-4">
          <div className="ui-card p-5">
            <h2 className="ui-section-title">Thao tác nhanh</h2>
            <ul className="mt-3 space-y-2">
              {quickActions.map((a) => (
                <li key={a.href}>
                  <Link
                    href={a.href}
                    className={`group flex items-center gap-3 rounded-xl border p-3 transition hover:border-blue-300 hover:bg-blue-50/40 ${
                      a.primary ? "border-blue-200 bg-blue-50/50" : "border-gray-200"
                    }`}
                  >
                    <span className={`ui-tile ui-tile-sm ${a.tone}`} aria-hidden>
                      {a.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-gray-900">
                        {a.title}
                      </span>
                      <span className="block truncate text-xs text-gray-500">{a.desc}</span>
                    </span>
                    <span
                      aria-hidden
                      className="text-sm text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-blue-500"
                    >
                      ›
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="ui-card p-5">
            <h2 className="ui-section-title">Việc còn lại</h2>
            <ul className="mt-3 space-y-2.5 text-sm">
              <li className="flex items-start gap-2.5">
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    drafts > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                  }`}
                  aria-hidden
                >
                  {drafts > 0 ? drafts : "✓"}
                </span>
                <span className="text-gray-600">
                  {drafts > 0 ? (
                    <>
                      <strong className="font-semibold text-gray-900">{drafts} bản nháp</strong>{" "}
                      chưa hoàn thành.
                    </>
                  ) : (
                    "Không còn bản nháp nào."
                  )}
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    failed > 0 ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
                  }`}
                  aria-hidden
                >
                  {failed > 0 ? failed : "✓"}
                </span>
                <span className="text-gray-600">
                  {failed > 0 ? (
                    <>
                      <strong className="font-semibold text-gray-900">{failed} bài đăng lỗi</strong>{" "}
                      — xem lại ở{" "}
                      <Link href="/history?status=FAILED" className="font-medium text-blue-600 hover:underline">
                        Lịch sử đăng
                      </Link>
                      .
                    </>
                  ) : (
                    "Không có bài nào bị lỗi."
                  )}
                </span>
              </li>
            </ul>
          </div>
        </div>
      </section>
      </div>
    </div>
  );
}
