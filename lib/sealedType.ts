export const SEALED_TYPES = ["BOOSTER_BOX", "BOOSTER_PACK", "ETB", "BUNDLE"] as const;
export type SealedType = (typeof SEALED_TYPES)[number];

export const SEALED_TYPE_LABELS: Record<SealedType, string> = {
  BOOSTER_BOX: "Booster Box",
  BOOSTER_PACK: "Booster Pack",
  ETB: "Elite Trainer Box",
  BUNDLE: "Bundle / Collection Box",
};

/** condition_grade/rarity stay NOT NULL in the DB even for a sealed listing (see supabase/schema.sql) - these are the fixed values written for one, never shown to buyers directly. */
export const SEALED_CONDITION_GRADE = "Sealed";
export const SEALED_RARITY = "Other";
