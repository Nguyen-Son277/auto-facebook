import { addDays, formatDateKey, isoDayOf, MAX_PLAN_AHEAD_DAYS, MAX_POSTS_PER_DAY, parseDaysOfWeek, startOfDay } from "./autopilot-plan";

export type PlannedTime = { scheduledAt: Date | null; publishedAt: Date | null };
export type PlanningWindow = {
  from: Date;
  to: Date;
  days: Date[];
  today: Date;
};
export type DayDemand = { day: Date; existing: number; needed: number; isToday: boolean };

export function planningWindow(config: { daysOfWeek: string; planAheadDays: number; startDate?: Date | null }, now: Date): PlanningWindow {
  const today = startOfDay(now);
  const from = config.startDate && config.startDate > today ? startOfDay(config.startDate) : today;
  const ahead = Math.min(Math.max(config.planAheadDays, 1), MAX_PLAN_AHEAD_DAYS);
  const enabledDays = parseDaysOfWeek(config.daysOfWeek);
  const days = Array.from({ length: ahead }, (_, offset) => addDays(from, offset))
    .filter((day) => enabledDays.includes(isoDayOf(day)));
  return { from, to: addDays(from, ahead), days, today };
}

/** Mirrors the old OR date query: one row per day, even when both dates match. */
export function demandForWindow(window: PlanningWindow, rows: PlannedTime[], postsPerDay: number): DayDemand[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const keys = new Set([row.scheduledAt, row.publishedAt].filter((d): d is Date => d !== null).map(formatDateKey));
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return window.days.flatMap((day) => {
    const existing = counts.get(formatDateKey(day)) ?? 0;
    const needed = Math.min(postsPerDay, MAX_POSTS_PER_DAY) - existing;
    return needed > 0 ? [{ day, existing, needed, isToday: day.getTime() === window.today.getTime() }] : [];
  });
}
