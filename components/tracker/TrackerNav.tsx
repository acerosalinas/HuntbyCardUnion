"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const links = [
  { href: "/tracker/dashboard", label: "Dashboard", exact: false },
  { href: "/tracker", label: "Enter Sales", exact: true },
  { href: "/tracker/customers", label: "Customers & Balances", exact: false },
  { href: "/tracker/distribution", label: "Distribution", exact: false },
  { href: "/tracker/proofs", label: "Proofs", exact: false },
  { href: "/tracker/plans", label: "Installments", exact: false },
  { href: "/tracker/settings", label: "Settings", exact: false },
];

export function TrackerNav({ className, proofCount = 0, planCount = 0 }: { className?: string; proofCount?: number; planCount?: number }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Live Tracker sections" className={cn("flex flex-wrap gap-2", className)}>
      {links.map((l) => {
        const active = l.exact ? pathname === l.href : pathname?.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
              active ? "border-gold bg-gold/10 text-foreground" : "border-card-border text-foreground-muted hover:border-gold/50 hover:text-foreground",
            )}
          >
            {l.label}
            {l.href === "/tracker/plans" && planCount > 0 && (
              <span className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-gold px-1.5 text-xs font-bold tabular-nums text-navy-950" aria-label={`${planCount} waiting`}>{planCount}</span>
            )}
            {l.href === "/tracker/proofs" && proofCount > 0 && (
              <span className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-gold px-1.5 text-xs font-bold tabular-nums text-navy-950" aria-label={`${proofCount} waiting`}>{proofCount}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
