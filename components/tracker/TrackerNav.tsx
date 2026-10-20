"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const links = [
  { href: "/tracker/dashboard", label: "Dashboard", exact: false },
  { href: "/tracker", label: "Enter Sales", exact: true },
  { href: "/tracker/customers", label: "Customers & Balances", exact: false },
  { href: "/tracker/distribution", label: "Distribution", exact: false },
  { href: "/tracker/settings", label: "Settings", exact: false },
];

export function TrackerNav({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {links.map((l) => {
        const active = l.exact ? pathname === l.href : pathname?.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              active ? "border-gold bg-gold/10 text-foreground" : "border-card-border text-foreground-muted hover:text-foreground",
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </div>
  );
}
