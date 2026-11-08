import { round2 } from "./money";

/** One proof, reduced to what the day divider needs: when, how much, whose cards, and who paid. */
export interface DayEntry<T> {
  /** yyyy-mm-dd the customer paid (or, for a proof still waiting, the day it was sent). */
  date: string;
  item: T;
  total: number;
  /** How much of the total is for each card owner (e.g. A / S). */
  owners: { name: string; amount: number }[];
  /** The person who paid. */
  person: string;
}

export interface DayGroup<T> {
  date: string;
  total: number;
  owners: { name: string; amount: number }[];
  people: { name: string; amount: number; proofs: number }[];
  items: T[];
}

/** Groups proofs under one divider per day, newest day first, with the day's total split by card owner and by person. Items keep the order they came in. */
export function groupByDay<T>(entries: DayEntry<T>[]): DayGroup<T>[] {
  const days = new Map<string, DayEntry<T>[]>();
  for (const e of entries) days.set(e.date, [...(days.get(e.date) ?? []), e]);

  return [...days.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, list]) => {
      const owners = new Map<string, number>();
      const people = new Map<string, { amount: number; proofs: number }>();
      for (const e of list) {
        for (const o of e.owners) owners.set(o.name, (owners.get(o.name) ?? 0) + o.amount);
        const p = people.get(e.person) ?? { amount: 0, proofs: 0 };
        people.set(e.person, { amount: p.amount + e.total, proofs: p.proofs + 1 });
      }
      return {
        date,
        total: round2(list.reduce((n, e) => n + e.total, 0)),
        owners: [...owners.entries()].map(([name, amount]) => ({ name, amount: round2(amount) })).sort((a, b) => a.name.localeCompare(b.name)),
        people: [...people.entries()].map(([name, p]) => ({ name, amount: round2(p.amount), proofs: p.proofs })).sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name)),
        items: list.map((e) => e.item),
      };
    });
}

/** The calendar day (yyyy-mm-dd) a timestamp falls on in the Philippines, where the sellers and customers are. Done on the server so the page reads the same everywhere. */
export function manilaDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

/** "Sat, Nov 8, 2026" for a yyyy-mm-dd date, read as a calendar day (not shifted by the time zone). */
export function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
