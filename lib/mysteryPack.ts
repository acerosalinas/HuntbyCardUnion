/** Fun Mystery Pack: a listing of numbered packs. cards.quantity is the pack count and the buyer picks one number - see supabase/migration_mystery_pack.sql. */
export const MYSTERY_PACK_LABEL = "Fun Mystery Pack";
export const MYSTERY_MAX_PACKS = 10;

/** condition_grade/rarity/set_name stay NOT NULL in the DB for every listing - these are the fixed values written for a mystery pack, never shown to buyers. */
export const MYSTERY_CONDITION_GRADE = "Sealed";
export const MYSTERY_RARITY = "Other";
export const MYSTERY_SET_NAME = "Unknown Set";

/** Pack numbers 1..count. */
export const packNumbers = (count: number): number[] => Array.from({ length: Math.max(0, Math.min(MYSTERY_MAX_PACKS, count)) }, (_, i) => i + 1);
