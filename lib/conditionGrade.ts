export type ConditionCode = "NM" | "LP" | "MP" | "HP" | "DMG";

const CONDITION_CODES: ConditionCode[] = ["NM", "LP", "MP", "HP", "DMG"];

export const CONDITION_LABELS: Record<ConditionCode, string> = {
  NM: "Near Mint (NM)",
  LP: "Lightly Played (LP)",
  MP: "Moderately Played (MP)",
  HP: "Highly Played (HP)",
  DMG: "Damage (DMG)",
};

export const CONDITION_TONE: Record<ConditionCode, "condition-nm" | "condition-yellow" | "condition-hp" | "condition-dmg"> = {
  NM: "condition-nm",
  LP: "condition-yellow",
  MP: "condition-yellow",
  HP: "condition-hp",
  DMG: "condition-dmg",
};

export type ParsedConditionGrade =
  | { type: "RAW"; condition: ConditionCode }
  | { type: "GRADED"; grader: string; gradeNumber: string };

/** Parses the stored "Raw NM" / "PSA 10" string into a structured shape for display. */
export function parseConditionGrade(value: string): ParsedConditionGrade {
  const trimmed = value.trim();

  const rawMatch = /^raw\s*(.*)$/i.exec(trimmed);
  if (rawMatch) {
    const cond = rawMatch[1].trim().toUpperCase() as ConditionCode;
    return { type: "RAW", condition: CONDITION_CODES.includes(cond) ? cond : "NM" };
  }

  const gradedMatch = /^(\S+)\s+([\d.]+)/.exec(trimmed);
  if (gradedMatch) {
    return { type: "GRADED", grader: gradedMatch[1].toUpperCase(), gradeNumber: gradedMatch[2] };
  }

  return { type: "RAW", condition: "NM" };
}
