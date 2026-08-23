import { Badge } from "@/components/ui/Badge";
import { rarityTone } from "@/lib/rarity";

export function RarityBadge({ rarity }: { rarity: string }) {
  return <Badge tone={rarityTone(rarity)}>{rarity}</Badge>;
}
