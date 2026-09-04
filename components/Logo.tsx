import { cn } from "@/lib/utils";
import { DynamicLogoProps } from "@/types/marketplace";

export function Logo({ src, alt = "Hunt by Card Union", className, size = "sm", iconOnly = false }: DynamicLogoProps) {
  const isLarge = size === "lg";

  return (
    <span className={cn("inline-flex items-center gap-2 text-foreground", className)} aria-label={alt}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- caller-supplied logo URL, not a local asset
        <img
          src={src}
          alt=""
          className={cn("shrink-0 object-contain", isLarge ? "h-14 w-14 sm:h-20 sm:w-20" : "h-7 w-7 sm:h-9 sm:w-9")}
        />
      ) : (
        <svg
          width={isLarge ? "48" : "30"}
          height={isLarge ? "48" : "30"}
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={cn("shrink-0", isLarge && "sm:w-16 sm:h-16")}
        >
          <rect x="4" y="7" width="18" height="22" rx="2.5" fill="var(--color-navy-950)" className="dark:fill-(--color-ivory)" stroke="var(--color-gold)" strokeWidth="1.5" />
          <rect x="10" y="3" width="18" height="22" rx="2.5" fill="var(--color-gold)" fillOpacity="0.15" stroke="var(--color-gold)" strokeWidth="1.5" />
          <circle cx="19" cy="14" r="3.2" stroke="var(--color-gold)" strokeWidth="1.4" fill="none" />
        </svg>
      )}
      {!iconOnly && (
        <span className="flex min-w-0 flex-col leading-none">
          <span
            className={cn(
              "font-bold tracking-tight",
              isLarge ? "text-xl sm:text-4xl" : "text-xs whitespace-nowrap sm:text-lg",
            )}
          >
            Hunt <span className="font-normal">by Card Union</span>
          </span>
          <span
            className={cn(
              "font-semibold uppercase tracking-[0.25em] text-gold",
              isLarge ? "text-xs sm:text-sm" : "text-[9px]",
            )}
          >
            Marketplace
          </span>
        </span>
      )}
    </span>
  );
}
