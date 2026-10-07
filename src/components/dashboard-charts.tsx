// ============================================================
// Biểu đồ nhỏ cho trang Tổng quan — tự vẽ bằng CSS/SVG thuần,
// không thêm thư viện ngoài và tự đổi màu theo theme sáng/tối.
// ============================================================

export type WeekDay = { key: string; label: string; count: number };

/**
 * Biểu đồ cột 7 ngày — cao theo số bài, cột bằng 0 vẫn hiện gạch mảnh
 * để thấy rõ khoảng trống. Có title cho từng cột khi rê chuột.
 */
export function WeekBars({
  days,
  ariaLabel,
}: {
  days: WeekDay[];
  ariaLabel: string;
}) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((sum, d) => sum + d.count, 0);

  return (
    <div>
      <div
        className="flex h-40 items-end gap-2 sm:gap-3"
        role="img"
        aria-label={`${ariaLabel} — tổng ${total} bài`}
      >
        {days.map((day, i) => {
          const ratio = day.count / max;
          const height = day.count === 0 ? 4 : Math.max(10, Math.round(ratio * 100));
          const isToday = i === days.length - 1;
          return (
            <div
              key={day.key}
              className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
              title={`${day.label}: ${day.count} bài`}
            >
              <span
                className={`text-[11px] font-semibold tabular-nums ${
                  day.count > 0 ? "text-gray-600" : "text-gray-300"
                }`}
              >
                {day.count}
              </span>
              <div className="flex h-24 w-full items-end">
                <div
                  className="ui-bar-grow w-full rounded-md"
                  style={
                    {
                      height: `${height}%`,
                      "--rise-delay": `${i * 60}ms`,
                      ...(day.count === 0
                        ? { backgroundColor: "var(--g-200)" }
                        : { backgroundImage: "var(--brand-gradient)" }),
                    } as unknown as React.CSSProperties
                  }
                />
              </div>
              <span
                className={`text-[11px] ${
                  isToday ? "font-semibold text-blue-600" : "text-gray-400"
                }`}
              >
                {day.label}
              </span>
            </div>
          );
        })}
      </div>
      <p className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-400">
        Số bài tạo trong 7 ngày gần nhất (theo ngày Việt Nam)
      </p>
    </div>
  );
}

export type StatusSegment = {
  label: string;
  value: number;
  /** Màu Tailwind (vd: emerald-500) — giữ nguyên ở cả 2 theme. */
  color: string;
};

/** Gói đoạn màu cho conic-gradient — tính tuần tự, không ghi đè biến ngoài render. */
function donutStops(active: StatusSegment[], total: number): string {
  return active
    .map((segment, i) => {
      const before = active
        .slice(0, i)
        .reduce((sum, prev) => sum + prev.value, 0);
      const from = (before / total) * 100;
      const to = ((before + segment.value) / total) * 100;
      return `var(--color-${segment.color}) ${from}% ${to}%`;
    })
    .join(", ");
}

/** Vòng tròn tỉ lệ trạng thái bài đăng + chú giải bên cạnh. */
export function StatusDonut({ segments }: { segments: StatusSegment[] }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const active = segments.filter((s) => s.value > 0);
  const stops = donutStops(active, total);

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div
        className="relative h-32 w-32 shrink-0 rounded-full"
        style={{ background: `conic-gradient(${stops})` }}
        role="img"
        aria-label={segments
          .filter((s) => s.value > 0)
          .map((s) => `${s.label}: ${s.value}`)
          .join(", ")}
      >
        <div className="absolute inset-[9px] flex flex-col items-center justify-center rounded-full bg-surface">
          <span className="text-2xl font-bold tabular-nums text-gray-900">{total}</span>
          <span className="ui-kicker">bài</span>
        </div>
      </div>

      <ul className="min-w-[9rem] flex-1 space-y-2">
        {segments.map((s) => {
          const pct = total === 0 ? 0 : Math.round((s.value / total) * 100);
          return (
            <li key={s.label} className="flex items-center gap-2 text-sm">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: `var(--color-${s.color})` }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-gray-600">{s.label}</span>
              <span className="font-semibold tabular-nums text-gray-900">{s.value}</span>
              <span className="w-9 text-right text-xs tabular-nums text-gray-400">
                {pct}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
