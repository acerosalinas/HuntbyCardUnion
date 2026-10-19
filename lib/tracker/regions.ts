export type IslandGroup = "LUZON" | "VISAYAS" | "MINDANAO";

export const ISLAND_GROUP_LABELS: Record<IslandGroup, string> = {
  LUZON: "Luzon",
  VISAYAS: "Visayas",
  MINDANAO: "Mindanao",
};

/** The Philippines' administrative regions, each wholly inside one island group. NIR (Negros Island Region, created 2024) takes Negros Occidental/Oriental + Siquijor, all Visayas. */
export const REGIONS: { value: string; label: string; group: IslandGroup }[] = [
  { value: "NCR", label: "NCR - National Capital Region", group: "LUZON" },
  { value: "CAR", label: "CAR - Cordillera Administrative Region", group: "LUZON" },
  { value: "I", label: "Region I - Ilocos Region", group: "LUZON" },
  { value: "II", label: "Region II - Cagayan Valley", group: "LUZON" },
  { value: "III", label: "Region III - Central Luzon", group: "LUZON" },
  { value: "IV-A", label: "Region IV-A - CALABARZON", group: "LUZON" },
  { value: "IV-B", label: "Region IV-B - MIMAROPA", group: "LUZON" },
  { value: "V", label: "Region V - Bicol Region", group: "LUZON" },
  { value: "VI", label: "Region VI - Western Visayas", group: "VISAYAS" },
  { value: "VII", label: "Region VII - Central Visayas", group: "VISAYAS" },
  { value: "VIII", label: "Region VIII - Eastern Visayas", group: "VISAYAS" },
  { value: "NIR", label: "NIR - Negros Island Region", group: "VISAYAS" },
  { value: "IX", label: "Region IX - Zamboanga Peninsula", group: "MINDANAO" },
  { value: "X", label: "Region X - Northern Mindanao", group: "MINDANAO" },
  { value: "XI", label: "Region XI - Davao Region", group: "MINDANAO" },
  { value: "XII", label: "Region XII - SOCCSKSARGEN", group: "MINDANAO" },
  { value: "XIII", label: "Region XIII - Caraga", group: "MINDANAO" },
  { value: "BARMM", label: "BARMM - Bangsamoro", group: "MINDANAO" },
];

/** Island group for a region value, or null if the region is empty/unknown - callers must then ask the user, never guess. */
export function islandGroupForRegion(region: string | null | undefined): IslandGroup | null {
  return REGIONS.find((r) => r.value === region)?.group ?? null;
}

/**
 * A rough hint from a ZIP's first digit, used ONLY to warn about a probable
 * typo - never to decide a fee. 5xxx is deliberately null: it spans Bicol,
 * Mindoro, Palawan, Romblon and Panay (Luzon AND Visayas).
 */
export function islandGroupHintFromZip(zip: string | null | undefined): IslandGroup | null {
  const digits = (zip ?? "").trim();
  if (!/^\d{4}$/.test(digits)) return null;
  const first = digits[0];
  if (first >= "1" && first <= "4") return "LUZON";
  if (first === "6") return "VISAYAS";
  if (first === "7" || first === "8" || first === "9") return "MINDANAO";
  return null;
}

/** Non-null warning text when the ZIP's hint disagrees with the island group the region gave. */
export function zipMismatchWarning(region: string | null | undefined, zip: string | null | undefined): string | null {
  const fromRegion = islandGroupForRegion(region);
  const fromZip = islandGroupHintFromZip(zip);
  if (!fromRegion || !fromZip || fromRegion === fromZip) return null;
  return `Region says ${ISLAND_GROUP_LABELS[fromRegion]} but the ZIP looks like ${ISLAND_GROUP_LABELS[fromZip]} - please double-check.`;
}

export interface ShippingRates {
  luzonFee: number;
  visayasMindanaoFee: number;
}

export function shippingFeeFor(group: IslandGroup | null, rates: ShippingRates): number | null {
  if (!group) return null;
  return group === "LUZON" ? rates.luzonFee : rates.visayasMindanaoFee;
}
