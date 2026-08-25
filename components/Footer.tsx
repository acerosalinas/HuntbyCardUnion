import Link from "next/link";

const LINKS = [
  { href: "/how-it-works", label: "How Buying Works" },
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/refund-policy", label: "Refund & Dispute Policy" },
];

export function Footer() {
  return (
    <footer className="border-t border-card-border">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-3 px-4 py-6 text-xs text-foreground-muted sm:flex-row sm:justify-between sm:px-6">
        <p>&copy; {new Date().getFullYear()} Hunt by Card Union.</p>
        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="transition-colors hover:text-gold">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
