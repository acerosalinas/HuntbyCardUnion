import Link from "next/link";
import { Banknote, CheckCircle2, LayoutGrid, MessageCircle, PackageCheck, Star } from "lucide-react";
import { Button } from "@/components/ui/Button";

export const metadata = { title: "How Buying Works — Card Union" };

const STEPS = [
  {
    icon: LayoutGrid,
    title: "Browse and claim dibs",
    body: "Find a card you want and tap Add to Cart (or Make Offer for a lower price). Claiming reserves it - it doesn't charge you anything yet.",
  },
  {
    icon: MessageCircle,
    title: "The seller messages you",
    body: "Place your order and we send one Messenger message to the seller for you, with everything they need to know. They'll reply to arrange payment.",
  },
  {
    icon: Banknote,
    title: "Pay via GCash or bank transfer",
    body: "Card Union doesn't process payments - you send payment directly to the seller, off-platform, the way you agree with them over Messenger.",
  },
  {
    icon: CheckCircle2,
    title: "Admin confirms your payment",
    body: "Once the seller confirms they've received your payment, your order status updates to Paid and (if you gave us an email) you'll get a confirmation.",
  },
  {
    icon: PackageCheck,
    title: "Ship it, or stash it",
    body: "Choose per card whether the seller ships it to your address, or holds it for you to collect/combine with a future order - your call at Add to Cart.",
  },
  {
    icon: Star,
    title: "Leave a review",
    body: "Once you've received your card, leave the seller a review from My Dibs - it helps every other buyer on the platform.",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <span className="text-xs font-semibold uppercase tracking-[0.25em] text-gold">Getting Started</span>
      <h1 className="mt-1.5 text-2xl font-bold text-foreground sm:text-3xl">How Buying Works</h1>
      <p className="mt-2 text-sm text-foreground-muted">
        Card Union is a claim-and-coordinate marketplace, not a checkout-and-ship store - here&apos;s the whole flow,
        start to finish.
      </p>

      <ol className="mt-8 space-y-5">
        {STEPS.map(({ icon: Icon, title, body }, i) => (
          <li key={title} className="flex gap-4 rounded-2xl border border-card-border bg-card p-4">
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gold/40 bg-navy-950 text-gold">
                <Icon size={16} />
              </div>
              {i < STEPS.length - 1 && <div className="w-px flex-1 bg-card-border" />}
            </div>
            <div className="pb-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gold">Step {i + 1}</p>
              <h2 className="font-semibold text-foreground">{title}</h2>
              <p className="mt-1 text-sm text-foreground-muted">{body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-8 flex flex-col items-center gap-2 text-center">
        <Link href="/marketplace">
          <Button variant="gold">Start Browsing</Button>
        </Link>
      </div>
    </div>
  );
}
