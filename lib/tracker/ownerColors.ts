import type { OwnerLabel } from "./split";

/**
 * One colour per owner, by position in the owner list (1st green, 2nd pink,
 * ...), so "AC = green, Shane = pink" holds as long as they stay first and
 * second. Class strings are written out in full so Tailwind can see them.
 */
export interface OwnerColor {
  /** Tint for a whole card row. */
  row: string;
  /** Highlight behind the card name. */
  name: string;
  /** Owner chip: selected / not selected. */
  chipOn: string;
  chipOff: string;
  /** Solid "Add for ..." button. */
  button: string;
  /** Filled part of a progress bar. */
  bar: string;
  /** Lighter tone of the same colour, for the "expected" line. */
  barSoft: string;
}

const PALETTE: OwnerColor[] = [
  {
    row: "bg-emerald-500/10",
    name: "bg-emerald-500/25 text-emerald-900 dark:text-emerald-100",
    chipOn: "border-emerald-500 bg-emerald-500 text-white",
    chipOff: "border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300",
    button: "bg-emerald-600 text-white hover:bg-emerald-500",
    bar: "bg-emerald-500",
    barSoft: "bg-emerald-500/30",
  },
  {
    row: "bg-pink-500/10",
    name: "bg-pink-500/25 text-pink-900 dark:text-pink-100",
    chipOn: "border-pink-500 bg-pink-500 text-white",
    chipOff: "border-pink-500/40 text-pink-700 hover:bg-pink-500/15 dark:text-pink-300",
    button: "bg-pink-600 text-white hover:bg-pink-500",
    bar: "bg-pink-500",
    barSoft: "bg-pink-500/30",
  },
  {
    row: "bg-sky-500/10",
    name: "bg-sky-500/25 text-sky-900 dark:text-sky-100",
    chipOn: "border-sky-500 bg-sky-500 text-white",
    chipOff: "border-sky-500/40 text-sky-700 hover:bg-sky-500/15 dark:text-sky-300",
    button: "bg-sky-600 text-white hover:bg-sky-500",
    bar: "bg-sky-500",
    barSoft: "bg-sky-500/30",
  },
  {
    row: "bg-amber-500/10",
    name: "bg-amber-500/25 text-amber-900 dark:text-amber-100",
    chipOn: "border-amber-500 bg-amber-500 text-white",
    chipOff: "border-amber-500/40 text-amber-700 hover:bg-amber-500/15 dark:text-amber-300",
    button: "bg-amber-600 text-white hover:bg-amber-500",
    bar: "bg-amber-500",
    barSoft: "bg-amber-500/30",
  },
  {
    row: "bg-violet-500/10",
    name: "bg-violet-500/25 text-violet-900 dark:text-violet-100",
    chipOn: "border-violet-500 bg-violet-500 text-white",
    chipOff: "border-violet-500/40 text-violet-700 hover:bg-violet-500/15 dark:text-violet-300",
    button: "bg-violet-600 text-white hover:bg-violet-500",
    bar: "bg-violet-500",
    barSoft: "bg-violet-500/30",
  },
  {
    row: "bg-orange-500/10",
    name: "bg-orange-500/25 text-orange-900 dark:text-orange-100",
    chipOn: "border-orange-500 bg-orange-500 text-white",
    chipOff: "border-orange-500/40 text-orange-700 hover:bg-orange-500/15 dark:text-orange-300",
    button: "bg-orange-600 text-white hover:bg-orange-500",
    bar: "bg-orange-500",
    barSoft: "bg-orange-500/30",
  },
];

/** The colour for an owner code, or null for untagged cards / codes no longer in the list. */
export function ownerColor(code: string | null, labels: OwnerLabel[]): OwnerColor | null {
  if (!code) return null;
  const index = labels.findIndex((l) => l.code === code);
  return index === -1 ? null : PALETTE[index % PALETTE.length];
}
