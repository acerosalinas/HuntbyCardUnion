/** Longest sub username an admin can give a customer. The database check in supabase/migration_buyer_aliases.sql allows the same. */
export const ALIAS_MAX_LENGTH = 40;

/** What an admin typed, made safe to store: control characters removed, runs of spaces collapsed, trimmed, cut to the limit. Empty means "no sub username". */
export function cleanAlias(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, ALIAS_MAX_LENGTH);
}

/** A buyer as an admin list shows them: the sub username (when this admin gave one) beside the real @handle. */
export interface BuyerAliasInfo {
  buyerId: string | null;
  alias: string | null;
}
