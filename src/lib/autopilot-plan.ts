// ============================================================
// Logic THUẦN của chế độ tự động: xử lý khung giờ và chọn trụ cột.
//
// Tách riêng khỏi autopilot.ts (file đó có "server-only", không test được
// ngoài Next). Ở đây không import gì nên chạy và kiểm thử trực tiếp được
// bằng Node — quan trọng vì đây là phần dễ sai nhất của tính năng.
// ============================================================

export const MIN_POSTS_PER_DAY = 1;
export const MAX_POSTS_PER_DAY = 10;
export const MAX_PLAN_AHEAD_DAYS = 7;
export const MIN_GAP_MINUTES = 30;

/** Cấu hình tối thiểu để tính slot giờ. */
export type SlotConfig = {
  postsPerDay: number;
  windowStart: string;
  windowEnd: string;
  minGapMinutes: number;
};

/** "07:30" → 450 (phút tính từ 00:00). Trả null nếu sai định dạng. */
export function parseHm(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** 450 → "07:30" */
export function formatHm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ============================================================
// MÚI GIỜ NGHIỆP VỤ — khai báo TƯỜNG MINH, không dựa vào máy chạy.
//
// Vì sao: Vercel chạy UTC còn máy dev ở Việt Nam chạy +07. Trước đây các hàm
// dưới dùng `getHours`/`setHours`/`getDay` (giờ tiến trình), nên cùng một cấu
// hình "đăng lúc 07:00" lại cho ra hai mốc thời gian khác nhau tuỳ nơi chạy —
// bài hẹn trên máy +07 bị Vercel coi là còn xa 7 tiếng và không đăng.
//
// Nay mọi phép quy đổi ngày/giờ đều tính bằng Date.UTC + độ lệch cố định,
// nên kết quả GIỐNG HỆT nhau ở mọi múi giờ của tiến trình.
// ============================================================

/** Múi giờ nghiệp vụ của app: Việt Nam (UTC+7). */
export const APP_UTC_OFFSET_MINUTES = 7 * 60;
const OFFSET_MS = APP_UTC_OFFSET_MINUTES * 60 * 1000;

/** Các thành phần lịch theo giờ Việt Nam của một mốc thời gian. */
function vnParts(date: Date) {
  const t = new Date(date.getTime() + OFFSET_MS);
  return {
    year: t.getUTCFullYear(),
    month: t.getUTCMonth(), // 0-11
    day: t.getUTCDate(),
    weekday: t.getUTCDay(), // 0 = Chủ Nhật
    hours: t.getUTCHours(),
    minutes: t.getUTCMinutes(),
  };
}

/** Thứ trong tuần theo chuẩn Việt Nam: 1 = Thứ Hai … 7 = Chủ Nhật. */
export function isoDayOf(date: Date): number {
  const d = vnParts(date).weekday;
  return d === 0 ? 7 : d;
}

/** "1,2,3" → [1,2,3]; rỗng hoặc sai → cả tuần. */
export function parseDaysOfWeek(raw: string): number[] {
  const days = (raw ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
  return days.length > 0 ? Array.from(new Set(days)).sort((a, b) => a - b) : [1, 2, 3, 4, 5, 6, 7];
}

/**
 * Mốc thời gian của 00:00 giờ Việt Nam trong ngày chứa `date`.
 *
 * Trả về một instant tuyệt đối (không phải "nửa đêm theo máy chạy").
 */
export function startOfDay(date: Date): Date {
  const p = vnParts(date);
  return new Date(Date.UTC(p.year, p.month, p.day) - OFFSET_MS);
}

/** Cộng/trừ số ngày theo LỊCH Việt Nam (không phụ thuộc múi giờ máy chạy). */
export function addDays(date: Date, days: number): Date {
  const p = vnParts(date);
  return new Date(Date.UTC(p.year, p.month, p.day + days) - OFFSET_MS);
}

/** Ngày theo lịch Việt Nam, dạng "2026-09-14" — dùng làm khoá gom nhóm. */
export function formatDateKey(date: Date): string {
  const p = vnParts(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}`;
}

/** Năm/tháng theo lịch Việt Nam của một mốc thời gian (month: 1-12). */
export function vnYearMonth(date: Date): { year: number; month: number } {
  const p = vnParts(date);
  return { year: p.year, month: p.month + 1 };
}

/**
 * Instant của một mốc giờ Việt Nam cho trước (monthIndex: 0-11).
 * Dùng thay cho `new Date(y, m, d, ...)` — vốn phụ thuộc múi giờ máy chạy.
 */
export function vnTime(
  year: number,
  monthIndex: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0,
  ms = 0
): Date {
  return new Date(
    Date.UTC(year, monthIndex, day, hours, minutes, seconds, ms) - OFFSET_MS
  );
}

/**
 * Rải `count` mốc giờ trong một khoảng, mỗi mốc nằm trong đoạn chia đều của nó,
 * rồi ép giãn cách tối thiểu giữa các mốc.
 *
 * Tách ra để dùng chung cho cả đường thường và đường có ưu tiên khung giờ
 * (planTimeSlotsBiased) — nhờ vậy hai đường luôn cùng một cách rải, không lệch
 * nhau về sau. `gap` PHẢI được truyền vào (không dùng hằng số) vì đó là giãn
 * cách người dùng đặt, có thể lớn hơn mức tối thiểu.
 */
function slotsInRange(
  startMin: number,
  endMin: number,
  count: number,
  gap: number,
  random: () => number
): number[] {
  const span = endMin - startMin;
  if (span <= 0 || count <= 0) return [];

  const segLen = span / count;
  const slots: number[] = [];

  for (let i = 0; i < count; i++) {
    const segStart = startMin + i * segLen;
    // Chừa 25% cuối đoạn để bài không sát bài kế tiếp
    slots.push(Math.round(segStart + random() * segLen * 0.75));
  }

  // Ép khoảng cách tối thiểu: slot nào quá gần slot trước thì đẩy ra
  slots.sort((a, b) => a - b);
  for (let i = 1; i < slots.length; i++) {
    if (slots[i] - slots[i - 1] < gap) slots[i] = slots[i - 1] + gap;
  }

  return slots;
}

/**
 * Biến danh sách "số phút trong ngày" thành instant, bỏ những mốc không dùng
 * được: ngoài khung, trùng giờ bài đã có, hoặc quá sớm so với hiện tại.
 *
 * KHÔNG ép lại giãn cách ở đây — việc đó đã làm trong slotsInRange. Làm hai lần
 * sẽ đẩy slot ra xa gấp đôi mức người dùng đặt.
 */
function finalizeSlots(
  minutes: number[],
  date: Date,
  endMin: number,
  gap: number,
  notBefore: Date | null,
  takenMs: number[]
): Date[] {
  // Đổi giờ của bài đã có sang "số phút trong ngày" (theo lịch VN) để so sánh
  const midnight = startOfDay(date);
  const takenMinutes = takenMs
    .map((ms) => Math.round((ms - midnight.getTime()) / 60000))
    .filter((m) => m >= 0 && m <= 24 * 60);

  const result: Date[] = [];
  const used = [...takenMinutes];

  for (const slot of [...minutes].sort((a, b) => a - b)) {
    if (slot > endMin) continue; // đẩy ra ngoài khung thì bỏ

    // Bỏ slot trùng giờ với bài đã có — đây là lý do bài bị xếp sát nhau
    // khi bộ lập kế hoạch chạy nhiều lượt cho cùng một ngày.
    if (used.some((t) => Math.abs(t - slot) < gap)) continue;

    // 00:00 giờ VN + số phút trong ngày → instant tuyệt đối, giống nhau ở mọi máy
    const d = new Date(midnight.getTime() + slot * 60000);
    if (notBefore && d.getTime() < notBefore.getTime()) continue;

    used.push(slot);
    result.push(d);
  }

  return result;
}

/**
 * Chia khung giờ thành các slot rải đều cho một ngày.
 *
 * Vì sao không chọn ngẫu nhiên hoàn toàn? Vì ngẫu nhiên hay dồn 3 bài vào
 * cùng một giờ. Cách này chia khung thành `n` đoạn bằng nhau rồi lấy ngẫu
 * nhiên trong mỗi đoạn — vừa rải đều, vừa không lặp y hệt mỗi ngày.
 *
 * @param notBefore bỏ slot sớm hơn mốc này (dùng cho ngày hôm nay)
 * @param random    hàm ngẫu nhiên, tiêm vào để test tất định
 * @param takenMs   giờ đăng (epoch ms) của các bài ĐÃ có trong ngày — slot mới
 *                  phải tránh xa những mốc này, nếu không lần lập kế hoạch thứ
 *                  hai sẽ xếp bài chồng lên bài của lần đầu.
 */
export function planTimeSlots(
  config: SlotConfig,
  date: Date,
  notBefore: Date | null = null,
  random: () => number = Math.random,
  takenMs: number[] = []
): Date[] {
  const startMin = parseHm(config.windowStart) ?? 7 * 60;
  const endMin = parseHm(config.windowEnd) ?? 21 * 60;
  const span = endMin - startMin;
  if (span <= 0) return [];

  const gap = Math.max(config.minGapMinutes || 0, MIN_GAP_MINUTES);

  // Khung giờ quá hẹp thì giảm số bài cho vừa, không xếp chồng lên nhau
  const requested = Math.min(Math.max(config.postsPerDay || 1, 1), MAX_POSTS_PER_DAY);
  const maxFit = Math.max(Math.floor(span / gap) + 1, 1);
  const count = Math.min(requested, maxFit);
  if (count <= 0) return [];

  const minutes = slotsInRange(startMin, endMin, count, gap, random);

  return finalizeSlots(minutes, date, endMin, gap, notBefore, takenMs);
}

// ============================================================
// ƯU TIÊN KHUNG GIỜ THEO SỐ LIỆU
//
// Khi số liệu cho thấy một khung giờ có nhiều người xem hơn, dồn MỘT PHẦN bài
// vào khung đó. Cố ý chỉ một phần (mặc định 50%): giờ đăng tốt nhất thay đổi
// theo mùa và theo lịch sinh hoạt, nên phải luôn giữ bài ở các khung khác để
// còn phát hiện khi khung "tốt nhất" hết tốt. Dồn hết 100% là tự bịt mắt.
// ============================================================

export type TimeBiasWindow = {
  /** Phút tính từ 00:00 (giờ Việt Nam), đã cắt theo khung người dùng đặt. */
  startMin: number;
  endMin: number;
  /** Tỉ lệ số bài nên nằm trong khung này (0–1). */
  share: number;
};

/**
 * Như `planTimeSlots` nhưng dồn một phần bài vào khung giờ ưu tiên.
 *
 * `bias === null` → trả về ĐÚNG kết quả của `planTimeSlots`. Đây là điều kiện
 * quan trọng: Page chưa đủ dữ liệu (hoặc chưa bật tối ưu) phải có lịch đăng
 * giống hệt trước khi có tính năng, không chỉ "gần giống".
 */
export function planTimeSlotsBiased(
  config: SlotConfig,
  date: Date,
  notBefore: Date | null,
  random: () => number,
  takenMs: number[],
  bias: TimeBiasWindow | null
): Date[] {
  if (!bias) return planTimeSlots(config, date, notBefore, random, takenMs);

  const startMin = parseHm(config.windowStart) ?? 7 * 60;
  const endMin = parseHm(config.windowEnd) ?? 21 * 60;
  const span = endMin - startMin;
  if (span <= 0) return [];

  const gap = Math.max(config.minGapMinutes || 0, MIN_GAP_MINUTES);
  const requested = Math.min(Math.max(config.postsPerDay || 1, 1), MAX_POSTS_PER_DAY);
  const maxFit = Math.max(Math.floor(span / gap) + 1, 1);
  const count = Math.min(requested, maxFit);
  if (count <= 0) return [];

  // Khung ưu tiên phải GIAO với khung người dùng đặt, và phần giao phải đủ
  // rộng cho ít nhất một slot. Không thoả thì rơi về đường thường.
  const from = Math.max(bias.startMin, startMin);
  const to = Math.min(bias.endMin, endMin);
  if (to - from < gap || to <= from) {
    return planTimeSlots(config, date, notBefore, random, takenMs);
  }

  const biasedCount = Math.min(Math.max(Math.round(count * clampShare(bias.share)), 1), count - 1);
  // count = 1 thì không tách được: dồn hết vào khung ưu tiên là hợp lý
  const effectiveBiased = count === 1 ? 1 : biasedCount;

  const minutes: number[] = [];

  // Phần 1: trong khung ưu tiên. Không xếp nhiều hơn số slot band chứa được,
  // nếu không finalizeSlots sẽ phải loại bớt và ta lại mất bài.
  const bandFit = Math.max(Math.floor((to - from) / gap) + 1, 1);
  const biasedSlots = Math.min(effectiveBiased, bandFit);
  minutes.push(...slotsInRange(from, to, biasedSlots, gap, random));

  // Phần 2: phần còn lại của khung, TRỪ khung ưu tiên.
  //
  // ⚠️ PHẢI chừa một khoảng `gap` ở hai mép khung ưu tiên (lỗi thật đã gặp):
  // nếu xếp bài sát mép, slot ngoài và slot trong band có thể cách nhau 117
  // phút khi người dùng đặt giãn cách 120 → finalizeSlots loại slot đó và người
  // dùng mất bài mà không có cảnh báo. Chừa sẵn `gap` ở mép khiến mọi cặp slot
  // (trong band ↔ ngoài band) luôn thoả giãn cách ngay từ lúc sinh.
  //
  // Ba trường hợp, theo thứ tự kiểm tra — thứ tự này quan trọng:
  //   a. Cả hai bên đều đủ rộng  → chia số slot theo độ rộng từng bên.
  //   b. Chỉ MỘT bên đủ rộng     → dồn hết phần còn lại vào bên đó.
  //   c. Không bên nào đủ rộng   → lấy bù bên trong khung ưu tiên.
  const restCount = count - biasedSlots;
  if (restCount > 0) {
    const beforeEnd = from - gap;
    const afterStart = to + gap;
    const beforeSpan = Math.max(beforeEnd - startMin, 0);
    const afterSpan = Math.max(endMin - afterStart, 0);
    const beforeUsable = beforeSpan >= gap;
    const afterUsable = afterSpan >= gap;

    if (beforeUsable && afterUsable) {
      // (a) Chia theo độ rộng, đảm bảo cả hai bên đều nhận ít nhất 1 slot
      const totalRest = beforeSpan + afterSpan;
      let beforeCount = Math.round((restCount * beforeSpan) / totalRest);
      beforeCount = Math.min(Math.max(beforeCount, 1), restCount - 1);
      const afterCount = restCount - beforeCount;

      minutes.push(...slotsInRange(startMin, beforeEnd, beforeCount, gap, random));
      minutes.push(...slotsInRange(afterStart, endMin, afterCount, gap, random));
    } else if (beforeUsable) {
      // (b) Chỉ bên trước dùng được
      minutes.push(...slotsInRange(startMin, beforeEnd, restCount, gap, random));
    } else if (afterUsable) {
      // (b) Chỉ bên sau dùng được
      minutes.push(...slotsInRange(afterStart, endMin, restCount, gap, random));
    } else {
      // (c) Không còn chỗ ngoài khung ưu tiên → lấy bù bên trong
      const extraFit = Math.max(Math.floor((to - from) / gap) + 1 - biasedSlots, 0);
      if (extraFit > 0) {
        minutes.push(...slotsInRange(from, to, Math.min(restCount, extraFit), gap, random));
      }
    }
  }

  return finalizeSlots(minutes, date, endMin, gap, notBefore, takenMs);
}

function clampShare(share: number): number {
  if (!Number.isFinite(share)) return 0.5;
  return Math.min(Math.max(share, 0), 0.8);
}

/**
 * Chọn trụ cột cho GIAI ĐOẠN DÒ: phân bổ ĐỀU thay vì theo trọng số.
 *
 * Vì sao cần hàm riêng thay vì dùng `pickPillar`: `pickPillar` chia theo trọng
 * số người dùng đặt, mà chính trọng số đó là thứ chưa được kiểm chứng khi Page
 * mới bắt đầu. Dò để LẤY dữ liệu kiểm chứng, nên phải trải đều.
 *
 * Vẫn giữ hai hành vi tốt của `pickPillar`: chọn hướng ít dùng nhất, và tránh
 * lặp lại y hệt bài liền trước.
 */
export function pickPillarEvenly(
  pillars: PillarLike[],
  usage: Record<string, number>
): PillarLike | null {
  if (pillars.length === 0) return null;
  if (pillars.length === 1) return pillars[0];

  const countOf = (p: PillarLike) => usage[p.name] ?? 0;

  let best = pillars[0];
  for (const p of pillars) {
    if (countOf(p) < countOf(best)) best = p;
  }

  return best;
}


export type PillarLike = {
  id: string;
  name: string;
  weight: number;
  position: number;
  goal: string;
  description?: string | null;
};

/**
 * Chọn trụ cột cho slot tiếp theo — "weighted round-robin làm mượt".
 *
 * Mỗi trụ cột có tỉ trọng (%). Thuật toán chọn trụ cột có tỉ lệ
 * `số lần đã dùng / tỉ trọng` nhỏ nhất. Cách này tự cân bằng: trụ cột tỉ
 * trọng cao được chọn nhiều hơn, nhưng không bao giờ bị chọn liên tiếp
 * trong khi trụ cột khác chưa xuất hiện.
 */
export function pickPillar(pillars: PillarLike[], recentNames: string[]): PillarLike | null {
  if (pillars.length === 0) return null;
  if (pillars.length === 1) return pillars[0];

  const usage = new Map<string, number>();
  for (const name of recentNames) {
    usage.set(name, (usage.get(name) ?? 0) + 1);
  }

  const scoreOf = (p: PillarLike) => (usage.get(p.name) ?? 0) / Math.max(p.weight, 1);

  let best = pillars[0];
  for (const p of pillars) {
    if (scoreOf(p) < scoreOf(best)) best = p;
  }

  // Tránh lặp lại y hệt bài vừa đăng nếu còn lựa chọn khác
  if (recentNames[0] === best.name) {
    const alternative = pillars
      .filter((p) => p.name !== best.name)
      .sort((a, b) => scoreOf(a) - scoreOf(b))[0];
    if (alternative) return alternative;
  }

  return best;
}

/** Giới hạn số bài/ngày người dùng nhập. */
export function clampPostsPerDay(value: number): number {
  if (!Number.isFinite(value)) return 2;
  return Math.min(Math.max(Math.round(value), MIN_POSTS_PER_DAY), MAX_POSTS_PER_DAY);
}

/** Giới hạn số ngày lên kế hoạch trước. */
export function clampPlanAheadDays(value: number): number {
  if (!Number.isFinite(value)) return 2;
  return Math.min(Math.max(Math.round(value), 1), MAX_PLAN_AHEAD_DAYS);
}

// ============================================================
// XEN KẼ ẢNH / VIDEO
//
// Facebook KHÔNG cho đăng chung ảnh và video trong cùng một bài, nên
// "xen kẽ" ở đây nghĩa là luân phiên GIỮA CÁC BÀI.
//
// Vì sao không dùng random thuần?
//   Random thuần với tỉ lệ 25% hoàn toàn có thể ra 3 video liên tiếp rồi
//   suốt tuần không có video nào. Người dùng đặt "25% video" là muốn thấy
//   đều đặn khoảng 1/4 số bài là video.
//
// Cách làm: tính HẠN NGẠCH video cho mỗi ngày = round(số bài × tỉ lệ).
// Trong ngày, chọn ngẫu nhiên bài nào là video nhưng không vượt hạn ngạch,
// và khi số bài còn lại vừa đủ lấp hạn ngạch thì buộc phải là video.
// Nhờ vậy tỉ lệ đúng theo ngày mà thứ tự vẫn tự nhiên.
// ============================================================

export const MEDIA_MIX_VALUES = ["IMAGE_ONLY", "VIDEO_ONLY", "MIXED"] as const;
export type MediaMix = (typeof MEDIA_MIX_VALUES)[number];
export type MediaKind = "IMAGE" | "VIDEO";

/** Kẹp tỉ lệ video về khoảng hợp lệ. */
export function clampVideoPercent(value: number): number {
  if (!Number.isFinite(value)) return 25;
  return Math.min(Math.max(Math.round(value), 0), 100);
}

/**
 * Số bài video nên có trong một ngày.
 *
 * Làm tròn thường, nhưng nếu người dùng đặt tỉ lệ > 0 thì đảm bảo ít nhất
 * 1 video — đặt 10% mà ngày nào cũng 0 video thì thà tắt hẳn còn hơn.
 */
export function videoQuotaForDay(postsPerDay: number, videoPercent: number): number {
  const pct = clampVideoPercent(videoPercent);
  if (pct <= 0) return 0;
  if (pct >= 100) return postsPerDay;
  const raw = Math.round((postsPerDay * pct) / 100);
  return Math.min(Math.max(raw, 1), postsPerDay);
}

/**
 * Quyết định bài thứ `index` trong ngày dùng ảnh hay video.
 *
 * @param index          vị trí bài trong ngày, bắt đầu từ 0
 * @param postsPerDay    tổng số bài của ngày đó
 * @param videosUsed     số video đã dùng trong ngày (tính cả bài đã tạo trước)
 */
export function decideMediaKind(
  mix: string,
  index: number,
  postsPerDay: number,
  videoPercent: number,
  videosUsed: number,
  random: () => number = Math.random
): MediaKind {
  if (mix === "VIDEO_ONLY") return "VIDEO";
  if (mix !== "MIXED") return "IMAGE";

  const quota = videoQuotaForDay(postsPerDay, videoPercent);
  const remainingVideos = quota - videosUsed;

  if (remainingVideos <= 0) return "IMAGE";

  const remainingPosts = postsPerDay - index;
  // Số bài còn lại vừa đủ lấp hạn ngạch → buộc phải là video
  if (remainingVideos >= remainingPosts) return "VIDEO";

  // Còn dư chỗ: rút thăm theo tỉ lệ video còn thiếu trên số bài còn lại.
  // Cách này giữ đúng tỉ lệ tổng thể mà thứ tự vẫn ngẫu nhiên.
  return random() < remainingVideos / remainingPosts ? "VIDEO" : "IMAGE";
}

// ============================================================
// THỨ TỰ ƯU TIÊN NGÀY & CHÍNH SÁCH KHI LỖI
// ============================================================

/** Số lỗi LIÊN TIẾP đủ để dừng lập kế hoạch cho cả Page trong lượt hiện tại. */
export const MAX_CONSECUTIVE_SLOT_FAILURES = 2;

/** Đã đủ lỗi liên tiếp để bỏ cả Page trong lượt này chưa. */
export function shouldAbortPage(consecutiveFailures: number): boolean {
  return consecutiveFailures >= MAX_CONSECUTIVE_SLOT_FAILURES;
}

/**
 * Sắp xếp các ngày cần lập kế hoạch: ngày càng TRỐNG càng lên trước, bằng nhau
 * thì theo thứ tự thời gian.
 *
 * Vì sao cần: sau khi người dùng xoá bài của một ngày, ngày đó phải được trám
 * lại. Nếu cứ đi tuần tự theo thời gian, ngày trống sớm nhất luôn hứng lỗi AI
 * đầu tiên (thường là timeout do model "nguội") rồi bị bỏ trắng, trong khi các
 * ngày sau lại tạo được bình thường — đúng lỗi "xoá bài xong ngày đó không có
 * nội dung mới".
 */
export function orderDaysByNeed<T extends { day: Date; existing: number }>(
  items: T[],
  postsPerDay: number
): T[] {
  const target = postsPerDay > 0 ? postsPerDay : 1;
  return [...items].sort((a, b) => {
    const ratioA = a.existing / target;
    const ratioB = b.existing / target;
    if (ratioA !== ratioB) return ratioA - ratioB;
    return a.day.getTime() - b.day.getTime();
  });
}

// ============================================================
// ĐỊA BÀN HOẠT ĐỘNG
//
// Người dùng nhập danh sách khu vực thương hiệu phục vụ (mỗi dòng một mục),
// AutoPilot xoay vòng mỗi bài nhắm một khu vực để phủ từ khoá địa phương.
//
// Vì sao KHÔNG để AI tự sinh tên khu vực: tên phường/xã ở Việt Nam thay đổi
// rất nhiều sau các đợt sáp nhập tỉnh/xã, nên AI rất dễ bịa ra địa danh sai
// hoặc không còn tồn tại. Người dùng nhập gì thì AI chỉ được dùng đúng cái đó.
// ============================================================

/** Số địa bàn tối đa nhận vào — nhiều hơn sẽ làm loãng prompt. */
export const MAX_SERVICE_AREAS = 60;
/** Độ dài tối đa mỗi địa bàn (tên khu vực thật rất ngắn). */
export const MAX_SERVICE_AREA_CHARS = 80;

/**
 * Tách danh sách địa bàn người dùng nhập thành mảng sạch.
 *
 * Chấp nhận cả xuống dòng lẫn dấu phẩy làm dấu phân cách để người dùng dán
 * danh sách từ nhiều nguồn khác nhau mà không phải sửa lại.
 * Khử trùng không phân biệt hoa/thường nhưng GIỮ NGUYÊN chữ gốc của lần xuất
 * hiện đầu tiên — vì đó là cách viết người dùng muốn AI dùng trong bài.
 */
export function parseServiceAreas(raw: string | null | undefined): string[] {
  if (!raw) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const piece of raw.split(/[\n,;]+/)) {
    const area = piece.trim().replace(/\s+/g, " ").slice(0, MAX_SERVICE_AREA_CHARS);
    if (!area) continue;

    // Bỏ dấu + hạ chữ thường để so trùng ("Dĩ An" và "dĩ an" là một)
    const key = area
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(area);
    if (out.length >= MAX_SERVICE_AREAS) break;
  }

  return out;
}

/**
 * Chọn địa bàn cho bài tiếp theo — "xoay vòng làm mượt".
 *
 * Cùng triết lý với `pickPillar`: chọn địa bàn có số lần đã dùng ÍT NHẤT, nhờ
 * vậy danh sách được phủ đều theo thứ tự thay vì lặp mãi một khu vực. Nếu khu
 * vực ít dùng nhất lại trùng bài vừa đăng thì ưu tiên phương án khác, để hai
 * bài liền nhau không nhắm cùng một địa bàn.
 */
export function pickServiceArea(areas: string[], recentAreas: string[]): string | null {
  if (areas.length === 0) return null;
  if (areas.length === 1) return areas[0];

  const usage = new Map<string, number>();
  for (const name of recentAreas) {
    const key = name.trim().toLowerCase();
    usage.set(key, (usage.get(key) ?? 0) + 1);
  }

  const scoreOf = (area: string) => usage.get(area.trim().toLowerCase()) ?? 0;

  let best = areas[0];
  for (const area of areas) {
    if (scoreOf(area) < scoreOf(best)) best = area;
  }

  // Tránh nhắm lại đúng khu vực của bài liền trước nếu còn lựa chọn khác
  if (recentAreas[0]?.trim().toLowerCase() === best.trim().toLowerCase()) {
    const alternative = areas
      .filter((a) => a.trim().toLowerCase() !== best.trim().toLowerCase())
      .sort((a, b) => scoreOf(a) - scoreOf(b))[0];
    if (alternative) return alternative;
  }

  return best;
}
