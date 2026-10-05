// ============================================================
// TOÁN HỌC BIỂU ĐỒ — hàm thuần, KHÔNG phụ thuộc React/Next/DB.
//
// Vì sao tách riêng:
//   - Component biểu đồ (components/charts.tsx) chỉ nên lo vẽ; mọi phép co
//     giãn trục, chia đoạn, làm tròn trần phải nằm ở đây để kiểm thử được
//     bằng `node --experimental-strip-types` (scripts/test-insights-charts.mjs)
//     mà không cần dev server hay database.
//   - Không import "@/..." để Node resolve được ngoài Next (xem tsconfig
//     allowImportingTsExtensions).
//
// Nguyên tắc an toàn: mọi hàm phải chịu được đầu vào rỗng, null, NaN,
// Infinity và mảng toàn 0 — biểu đồ không bao giờ được vẽ ra NaN.
// ============================================================

/** Giá trị số có thể thiếu (null/undefined) — đầu vào phổ biến từ DB. */
export type Numeric = number | null | undefined;

function isFiniteNumber(v: Numeric): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Kẹp n trong [min, max]; NaN → min (không bao giờ trả NaN). */
export function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}

/** Giá trị lớn nhất trong các số hữu hạn; null nếu không có số nào. */
export function maxOf(values: readonly Numeric[]): number | null {
  let max: number | null = null;
  for (const v of values) {
    if (!isFiniteNumber(v)) continue;
    if (max === null || v > max) max = v;
  }
  return max;
}

/** Bước chia "đẹp" (1 / 2 / 2,5 / 5 / 10 × luỹ thừa 10) không nhỏ hơn raw. */
function niceStep(raw: number): number {
  if (!isFiniteNumber(raw) || raw <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;
  const multiplier =
    normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10;
  return multiplier * magnitude;
}

/**
 * Trần trục Y "đẹp" để nhãn chia hết.
 *
 * Trả 1 khi mảng rỗng / toàn null / toàn 0 hoặc âm — nhờ vậy phép chia cho
 * max không bao giờ ra Infinity.
 */
export function niceMax(values: readonly Numeric[], divisions = 4): number {
  const max = maxOf(values) ?? 0;
  if (!(max > 0)) return 1;
  const count = Number.isFinite(divisions) && divisions > 0 ? Math.floor(divisions) : 4;
  return niceStep(max / count) * count;
}

/** Mốc trục Y từ 0 tới max (count + 1 giá trị, gồm cả 0 và max). */
export function yTicks(max: number, count = 4): number[] {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 4;
  const safe = isFiniteNumber(max) && max > 0 ? max : 1;
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push((safe / n) * i);
  return out;
}

/** Toạ độ Y (gốc trên-trái) cho một giá trị; max ≤ 0 coi như 1. */
export function scaleY(value: number, max: number, height: number): number {
  const safeMax = isFiniteNumber(max) && max > 0 ? max : 1;
  const safeHeight = isFiniteNumber(height) && height > 0 ? height : 0;
  const ratio = clamp(value / safeMax, 0, 1);
  return safeHeight - ratio * safeHeight;
}

/** Toạ độ X cho chỉ số i trong `count` điểm; 1 điểm → giữa trục. */
export function scaleX(index: number, count: number, width: number): number {
  const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 1;
  const safeWidth = isFiniteNumber(width) && width > 0 ? width : 0;
  if (safeCount <= 1) return safeWidth / 2;
  return (clamp(index, 0, safeCount - 1) / (safeCount - 1)) * safeWidth;
}

/** Chuỗi lệnh SVG cho một đường; mảng rỗng → chuỗi rỗng. */
export function buildPolyline(points: readonly { x: number; y: number }[]): string {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${round2(p.x)} ${round2(p.y)}`)
    .join(" ");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Các đoạn chỉ số LIỀN NHAU không null — để ngắt nét khi thiếu ngày thay vì
 * nối thẳng qua khoảng trống (nối qua sẽ tạo đường giả).
 */
export function runsOf(values: readonly Numeric[]): number[][] {
  const runs: number[][] = [];
  let current: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (isFiniteNumber(values[i])) {
      current.push(i);
    } else if (current.length > 0) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

/** Bước nhảy nhãn trục X để không quá `maxLabels` nhãn trên trục. */
export function labelStep(count: number, maxLabels: number): number {
  const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 1;
  const safeMax = Number.isFinite(maxLabels) && maxLabels > 0 ? Math.floor(maxLabels) : 1;
  if (safeCount <= safeMax) return 1;
  return Math.ceil(safeCount / safeMax);
}

/** Phần trăm độ dài thanh (0..100); max ≤ 0 hoặc value ≤ 0 → 0. */
export function barPct(value: Numeric, max: Numeric): number {
  if (!isFiniteNumber(value) || value <= 0) return 0;
  if (!isFiniteNumber(max) || max <= 0) return 0;
  return clamp((value / max) * 100, 0, 100);
}

/**
 * Số nguyên kiểu Việt Nam (phân cách nghìn bằng dấu chấm).
 *
 * KHÔNG dùng toLocaleString: hàm này chạy trong component được SSR rồi hydrate,
 * tự tách chuỗi cho kết quả giống hệt ở server và trình duyệt.
 */
export function formatInt(value: Numeric): string {
  if (!isFiniteNumber(value)) return "—";
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  return sign + String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Số thập phân kiểu Việt Nam (dấu phẩy), mặc định 1 chữ số. */
export function formatDecimal(value: Numeric, digits = 1): string {
  if (!isFiniteNumber(value)) return "—";
  const safeDigits = Number.isFinite(digits) && digits >= 0 ? Math.floor(digits) : 1;
  return value.toFixed(safeDigits).replace(".", ",");
}

/** % có dấu, làm tròn: "+12%", "-7%", "—" khi thiếu. */
export function formatSignedPct(value: Numeric): string {
  if (!isFiniteNumber(value)) return "—";
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

/** Nhãn trục Y gọn: 999 / 1,5K / 2,4M / 1,2B. */
export function formatCompact(value: Numeric): string {
  if (!isFiniteNumber(value)) return "—";
  const abs = Math.abs(value);
  if (abs < 1000) return formatInt(value);
  const units: [number, string][] = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const scaled = value / size;
      const digits = Math.abs(scaled) < 10 ? 1 : 0;
      return `${scaled.toFixed(digits).replace(".", ",")}${suffix}`;
    }
  }
  return formatInt(value);
}
