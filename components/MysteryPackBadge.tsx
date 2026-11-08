import { Badge } from "@/components/ui/Badge";
import { MYSTERY_PACK_LABEL } from "@/lib/mysteryPack";

/** For a Fun Mystery Pack listing, in place of the condition/rarity badges (neither applies). */
export function MysteryPackBadge() {
  return <Badge tone="gold">{MYSTERY_PACK_LABEL}</Badge>;
}
