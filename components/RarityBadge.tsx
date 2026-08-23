import { Badge } from "@/components/ui/Badge";
import { rarityTone } from "@/lib/rarity";

export function RarityBadge({ rarity, franchise }: { rarity: string; franchise?: string | null }) {
  return <Badge tone={rarityTone(franchise, rarity)}>{rarity}</Badge>;
}
