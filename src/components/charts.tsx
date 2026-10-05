// ============================================================
// BỘ VẼ BIỂU ĐỒ — SVG thuần + Tailwind, KHÔNG dùng thư viện ngoài.
//
// Vì sao tự vẽ:
//   - Repo chỉ có Next/React/Prisma; thêm recharts sẽ tăng bundle và lệch quy
//     ước "không UI library" của dự án.
//   - Mọi nét/màu đi qua `currentColor` + class `text-*`, nên biểu đồ tự đổi
//     theo theme sáng/tối nhờ bảng màu trong globals.css — không cần CSS mới.
//
// QUY ƯỚC:
//   - Component ở đây là TRÌNH BÀY THUẦN: không hook, không state, không
//     truy vấn. Nhờ vậy dùng được ở cả server và client component.
//   - Class màu Tailwind phải là chuỗi LITERAL trong map (không nối chuỗi
//     động), nếu không Tailwind sẽ không sinh CSS.
//   - Mọi toạ độ tính bằng src/lib/chart-geometry.ts (đã kiểm thử riêng).
//   - Tooltip dùng <title> gốc của SVG → không cần JavaScript.
// ============================================================

import {
  buildPolyline,
  formatCompact,
  labelStep,
  niceMax,
  runsOf,
  scaleX,
  scaleY,
  yTicks,
} from "@/lib/chart-geometry";

// ------------------------------------------------------------
// Biểu đồ vùng có trục — dùng cho "Số liệu cấp Page theo ngày".
// ------------------------------------------------------------

const AREA_W = 320;
const AREA_H = 110;
const PAD_LEFT = 38;
const PAD_RIGHT = 8;
const PAD_TOP = 10;
const PAD_BOTTOM = 22;
const INNER_W = AREA_W - PAD_LEFT - PAD_RIGHT;
const INNER_H = AREA_H - PAD_TOP - PAD_BOTTOM;

export function AreaChart({
  points,
  colorClass = "text-blue-600",
  unit = "",
  ariaLabel,
}: {
  /** Các điểm theo thứ tự thời gian (cũ → mới). `label` hiện ở trục X. */
  points: { label: string; value: number | null }[];
  colorClass?: string;
  unit?: string;
  ariaLabel: string;
}) {
  const values = points.map((p) => p.value);
  const max = niceMax(values, 3);
  const ticks = yTicks(max, 3);
  const step = labelStep(points.length, 7);
  const hasData = values.some((v) => typeof v === "number" && Number.isFinite(v));

  const xOf = (i: number) => PAD_LEFT + scaleX(i, points.length, INNER_W);
  const yOf = (v: number) => PAD_TOP + scaleY(v, max, INNER_H);

  return (
    <svg
      viewBox={`0 0 ${AREA_W} ${AREA_H}`}
      className="h-auto w-full"
      role="img"
      aria-label={ariaLabel}
    >
      {/* Lưới ngang + nhãn trục Y */}
      <g className="text-gray-200" stroke="currentColor" strokeWidth={1}>
        {ticks.map((t) => (
          <line key={t} x1={PAD_LEFT} x2={AREA_W - PAD_RIGHT} y1={yOf(t)} y2={yOf(t)} />
        ))}
      </g>
      <g className="text-gray-400" fill="currentColor" fontSize={8} textAnchor="end">
        {ticks.map((t) => (
          <text key={t} x={PAD_LEFT - 4} y={yOf(t)} dominantBaseline="middle">
            {formatCompact(t)}
          </text>
        ))}
      </g>

      {/* Vùng + đường: mỗi đoạn liền nhau vẽ riêng để không nối qua ngày thiếu */}
      {runsOf(values).map((run, ri) => {
        const pts = run.map((i) => ({ x: xOf(i), y: yOf(values[i] as number) }));
        const line = buildPolyline(pts);
        const area =
          pts.length > 1
            ? `${line} L${pts[pts.length - 1].x} ${PAD_TOP + INNER_H} L${pts[0].x} ${
                PAD_TOP + INNER_H
              } Z`
            : "";
        return (
          <g key={ri} className={colorClass}>
            {area ? <path d={area} fill="currentColor" fillOpacity={0.14} stroke="none" /> : null}
            {pts.length > 1 ? (
              <path
                d={line}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
            {pts.map((p, pi) => (
              <circle key={pi} cx={p.x} cy={p.y} r={2.4} fill="currentColor">
                <title>{`${points[run[pi]].label}: ${formatCompact(values[run[pi]])}${unit}`}</title>
              </circle>
            ))}
          </g>
        );
      })}

      {/* Nhãn trục X — giãn bớt để không chồng chữ */}
      <g className="text-gray-400" fill="currentColor" fontSize={8}>
        {points.map((p, i) => {
          if (i % step !== 0 && i !== points.length - 1) return null;
          const anchor = i === 0 ? "start" : i === points.length - 1 ? "end" : "middle";
          return (
            <text key={`${p.label}-${i}`} x={xOf(i)} y={AREA_H - 6} textAnchor={anchor}>
              {p.label}
            </text>
          );
        })}
      </g>

      {!hasData ? (
        <text
          x={AREA_W / 2}
          y={AREA_H / 2}
          textAnchor="middle"
          className="text-gray-400"
          fill="currentColor"
          fontSize={10}
        >
          Chưa có số liệu
        </text>
      ) : null}
    </svg>
  );
}

// ------------------------------------------------------------
// Sparkline — đường nhỏ không trục, dùng trong thẻ KPI.
// ------------------------------------------------------------

export function Sparkline({
  values,
  colorClass = "text-blue-600",
}: {
  values: (number | null)[];
  colorClass?: string;
}) {
  const finite = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (finite.length < 2) return null;

  const max = niceMax(values, 4);
  const w = 120;
  const h = 32;
  const pts = values.map((v, i) => ({
    x: scaleX(i, values.length, w),
    y:
      typeof v === "number" && Number.isFinite(v)
        ? scaleY(v, max, h)
        : h,
  }));

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={`h-8 w-full ${colorClass}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        d={buildPolyline(pts)}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// ------------------------------------------------------------
// Danh sách thanh ngang — dùng cho xếp hạng theo hướng.
// ------------------------------------------------------------

export type BarItem = {
  key: string;
  label: string;
  /** Số đã định dạng, hiện ở cuối dòng. */
  valueText: string;
  /** 0..100 (tính bằng barPct ở lib/chart-geometry). */
  barPct: number;
  /** Class Tailwind cho thanh, ví dụ "bg-emerald-500". */
  colorClass: string;
  note?: string;
  badgeText?: string;
  badgeClass?: string;
};

export function BarList({ items, ariaLabel }: { items: BarItem[]; ariaLabel: string }) {
  if (items.length === 0) return null;

  return (
    <ul className="space-y-2.5" aria-label={ariaLabel}>
      {items.map((it) => (
        <li key={it.key}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-800" title={it.label}>
              {it.label}
            </span>
            <span className="shrink-0 tabular-nums text-xs font-semibold text-gray-900">
              {it.valueText}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full rounded-full ${it.colorClass}`}
              style={{ width: `${Math.round(it.barPct)}%` }}
            />
          </div>
          {it.note || it.badgeText ? (
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
              {it.badgeText ? (
                <span className={`rounded-full px-1.5 py-0.5 ${it.badgeClass ?? "bg-gray-100 text-gray-600"}`}>
                  {it.badgeText}
                </span>
              ) : null}
              {it.note ? <span className="min-w-0 flex-1">{it.note}</span> : null}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------
// So sánh hai thanh trên mỗi dòng — "Bạn đặt vs Đang dùng",
// "Mốc lúc đổi vs Sau điều chỉnh".
// ------------------------------------------------------------

export type CompareRow = {
  key: string;
  label: string;
  primaryText: string;
  primaryPct: number;
  secondaryText?: string;
  secondaryPct?: number;
  note?: string;
  badgeText?: string;
  badgeClass?: string;
};

export function CompareBars({
  rows,
  primaryLabel,
  secondaryLabel,
  ariaLabel,
  primaryColorClass = "bg-blue-500",
  secondaryColorClass = "bg-emerald-500",
}: {
  rows: CompareRow[];
  primaryLabel: string;
  secondaryLabel: string;
  ariaLabel: string;
  primaryColorClass?: string;
  secondaryColorClass?: string;
}) {
  if (rows.length === 0) return null;

  return (
    <div aria-label={ariaLabel}>
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className={`inline-block h-2 w-4 rounded-full ${primaryColorClass}`} />
          {primaryLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`inline-block h-2 w-4 rounded-full ${secondaryColorClass}`} />
          {secondaryLabel}
        </span>
      </div>

      <ul className="mt-3 space-y-3">
        {rows.map((r) => (
          <li key={r.key}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-800" title={r.label}>
                {r.label}
              </span>
              {r.badgeText ? (
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${r.badgeClass ?? "bg-gray-100 text-gray-600"}`}>
                  {r.badgeText}
                </span>
              ) : null}
            </div>

            <div className="mt-1 space-y-1">
              <div className="flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={`h-full rounded-full ${primaryColorClass}`}
                    style={{ width: `${Math.round(r.primaryPct)}%` }}
                  />
                </div>
                <span className="w-14 shrink-0 text-right tabular-nums text-[11px] text-gray-600">
                  {r.primaryText}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={`h-full rounded-full ${secondaryColorClass}`}
                    style={{ width: `${Math.round(r.secondaryPct ?? 0)}%` }}
                  />
                </div>
                <span className="w-14 shrink-0 text-right tabular-nums text-[11px] text-gray-600">
                  {r.secondaryText ?? "—"}
                </span>
              </div>
            </div>

            {r.note ? <p className="mt-1 text-[11px] text-gray-500">{r.note}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------
// Dải khung giờ trên trục 0–24h — dùng cho "khung giờ ưu tiên".
// ------------------------------------------------------------

export function RangeBar({
  startMin,
  endMin,
  ariaLabel,
}: {
  startMin: number;
  endMin: number;
  ariaLabel: string;
}) {
  const total = 24 * 60;
  const left = Math.min(Math.max(startMin, 0), total);
  const right = Math.min(Math.max(endMin, left), total);
  const hours = [0, 6, 12, 18, 24];

  return (
    <div aria-label={ariaLabel}>
      <div className="relative h-3 overflow-hidden rounded-full bg-gray-100">
        <div
          className="absolute inset-y-0 rounded-full bg-indigo-500"
          style={{ left: `${(left / total) * 100}%`, width: `${((right - left) / total) * 100}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-gray-400">
        {hours.map((h) => (
          <span key={h}>{h}h</span>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Thanh tiến độ (ngân sách dò, tỉ lệ thử hướng mới).
// ------------------------------------------------------------

export function ProgressBar({
  value,
  max,
  colorClass = "bg-indigo-500",
  ariaLabel,
}: {
  value: number;
  max: number;
  colorClass?: string;
  ariaLabel: string;
}) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 1;
  const pct = Math.min(Math.max((value / safeMax) * 100, 0), 100);

  return (
    <div
      className="h-2 overflow-hidden rounded-full bg-gray-100"
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Trạng thái rỗng dùng chung cho các khối biểu đồ. */
export function EmptyChart({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 px-3 py-6 text-center text-sm text-gray-500">
      {text}
    </div>
  );
}
