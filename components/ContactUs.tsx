import { CONTACT } from "@/lib/accessGate";

/** The two places to message us: TikTok and Facebook. */
export function ContactUs() {
  return (
    <ul className="space-y-2 text-sm">
      <li className="rounded-lg border border-card-border bg-card px-3 py-2">
        <span className="text-foreground-muted">TikTok: </span>
        <a href={CONTACT.tiktokUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-gold-ink hover:underline">
          {CONTACT.tiktokHandle}
        </a>
      </li>
      <li className="rounded-lg border border-card-border bg-card px-3 py-2">
        <span className="text-foreground-muted">Facebook: </span>
        <span className="font-semibold">{CONTACT.facebookName}</span>
      </li>
    </ul>
  );
}
