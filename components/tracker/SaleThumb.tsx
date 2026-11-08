import { catalogImageUrl } from "@/lib/pokemonCatalog";

/** Small picture of a live card (from the catalog it was picked from); tap it to open the large one. Renders nothing for a card typed in by name. */
export function SaleThumb({ image, name }: { image: string | null; name: string }) {
  const small = catalogImageUrl(image);
  if (!small) return null;
  return (
    <a href={catalogImageUrl(image, "high") ?? small} target="_blank" rel="noreferrer" aria-label={`View ${name} larger`} className="shrink-0 cursor-zoom-in overflow-hidden rounded border border-card-border">
      {/* eslint-disable-next-line @next/next/no-img-element -- small catalog picture from the card image host */}
      <img src={small} alt="" loading="lazy" className="h-14 w-10 object-cover" />
    </a>
  );
}
