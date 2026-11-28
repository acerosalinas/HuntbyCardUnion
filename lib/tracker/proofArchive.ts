import { dayLabel, manilaDay } from "./proofDays";

/** A reviewed proof stays in the "Reviewed" list for this many days after it was sent; after that it moves to the Archive. */
export const ARCHIVE_AFTER_DAYS = 7;

/** Whole days from one yyyy-mm-dd calendar day to a later one (read as plain calendar days, so no time-zone drift). */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** True when a proof sent on `day` is older than the archive window, counted from `today` (both yyyy-mm-dd, Philippine days). */
export function isArchived(day: string, today: string): boolean {
  return daysBetween(day, today) > ARCHIVE_AFTER_DAYS;
}

/** What a day divider says: "Today", "Yesterday", or the date, always followed by the date for the first two. */
export function dividerTitle(day: string, today: string): string {
  const age = daysBetween(day, today);
  if (age === 0) return `Today · ${dayLabel(day)}`;
  if (age === 1) return `Yesterday · ${dayLabel(day)}`;
  return dayLabel(day);
}

export interface DatedEntry<T> {
  /** ISO timestamp the proof was sent. */
  at: string;
  /** What the divider adds up for this proof. */
  amount: number;
  node: T;
}

export interface ProofDay<T> {
  day: string;
  count: number;
  total: number;
  entries: DatedEntry<T>[];
}

/** One group per Philippine calendar day, newest day first, newest proof first inside a day. */
export function groupProofsByDay<T>(entries: DatedEntry<T>[]): ProofDay<T>[] {
  const days = new Map<string, DatedEntry<T>[]>();
  for (const e of [...entries].sort((a, b) => b.at.localeCompare(a.at))) {
    const day = manilaDay(e.at);
    days.set(day, [...(days.get(day) ?? []), e]);
  }
  return [...days.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, list]) => ({ day, count: list.length, total: Math.round(list.reduce((n, e) => n + e.amount, 0) * 100) / 100, entries: list }));
}
