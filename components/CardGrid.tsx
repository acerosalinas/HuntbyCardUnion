import { CardItem } from "@/types/marketplace";
import { CardTile } from "@/components/CardTile";

export function CardGrid({
  cards,
  negotiatingCardIds,
}: {
  cards: CardItem[];
  negotiatingCardIds?: Set<string>;
}) {
  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-card-border py-14 text-center sm:py-20">
        <p className="text-foreground-muted">No cards match your search.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
      {cards.map((card) => (
        <CardTile key={card.id} card={card} isNegotiating={negotiatingCardIds?.has(card.id)} />
      ))}
    </div>
  );
}
