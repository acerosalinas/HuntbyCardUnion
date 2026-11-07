import { CardTile } from "@/components/CardTile";
import { CardItem } from "@/types/marketplace";

/**
 * The newest listings drifting sideways like a showcase. Reuses the vouch wall's marquee styles
 * (globals.css): the track holds two identical copies and slides exactly half its width, so the loop never jumps.
 * It pauses on hover or focus; with reduced motion it becomes a plain scrollable strip and the second copy is hidden.
 */
export function JustListedMarquee({ cards }: { cards: CardItem[] }) {
  // About 5 seconds per card keeps it readable at any list length.
  const duration = Math.max(40, cards.length * 5);

  return (
    <div className="vouch-marquee -mx-4 w-[calc(100%+2rem)] sm:mx-0 sm:w-full" role="region" aria-label="Newly listed cards">
      <div className="vouch-track" data-reverse="" style={{ ["--vouch-duration" as string]: `${duration}s` }}>
        {[0, 1].map((copy) => (
          <div
            key={copy}
            className="flex shrink-0 gap-3 pr-3 sm:gap-4 sm:pr-4"
            {...(copy === 1 ? { "aria-hidden": true, inert: true, "data-dup": "" } : {})}
          >
            {cards.map((card) => (
              <div key={card.id} className="w-40 shrink-0 sm:w-52">
                <CardTile card={card} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
