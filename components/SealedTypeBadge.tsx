import { Badge } from "@/components/ui/Badge";
import { SEALED_TYPE_LABELS, SealedType } from "@/lib/sealedType";

/** For a SEALED listing, in place of ConditionBadges/RarityBadge (neither applies to a sealed box/pack). */
export function SealedTypeBadge({ sealedType }: { sealedType: string | null }) {
  const label = sealedType && sealedType in SEALED_TYPE_LABELS ? SEALED_TYPE_LABELS[sealedType as SealedType] : "Sealed";
  return <Badge tone="gold">{label}</Badge>;
}
