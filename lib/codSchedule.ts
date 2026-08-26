const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function weekdayLabel(weekday: number): string {
  return WEEKDAY_LABELS[weekday] ?? "";
}

/**
 * The next occurrence of a seller's fixed COD shipping weekday (0=Sunday .. 6=Saturday),
 * counting today if it matches. Purely a displayed schedule - nothing here
 * triggers real shipping, same as everywhere else in this app.
 */
export function nextCodShipDate(weekday: number, from: Date = new Date()): Date {
  const result = new Date(from);
  result.setHours(0, 0, 0, 0);
  const daysUntil = (weekday - result.getDay() + 7) % 7;
  result.setDate(result.getDate() + daysUntil);
  return result;
}

export function formatCodShipDate(weekday: number, from?: Date): string {
  const date = nextCodShipDate(weekday, from);
  return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}
