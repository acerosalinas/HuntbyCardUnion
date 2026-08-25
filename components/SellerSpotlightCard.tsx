import Link from "next/link";
import { Store } from "lucide-react";
import { SellerProfile } from "@/types/marketplace";

export function SellerSpotlightCard({ profile, cardCount }: { profile: SellerProfile; cardCount: number }) {
  return (
    <Link
      href={`/sellers/${profile.handle}`}
      className="group flex w-56 flex-col items-center rounded-2xl border border-card-border bg-card p-5 text-center transition-transform duration-200 hover:-translate-y-1 hover:glow-gold"
    >
      <div className="mb-3 flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-2 border-gold bg-navy-950 text-gold">
        {profile.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary seller-supplied image URL
          <img src={profile.avatarUrl} alt={profile.displayName} loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <Store size={24} />
        )}
      </div>
      <p className="text-sm font-semibold text-foreground">{profile.displayName}</p>
      <p className="text-xs text-foreground-muted">
        {cardCount} listing{cardCount === 1 ? "" : "s"}
      </p>
      {profile.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap justify-center gap-1">
          {profile.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-navy-950 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
