import Link from "next/link";
import { Button } from "@/components/ui/Button";

export const metadata = { title: "How Buying Works — Card Union" };

const STEPS = [
  {
    title: "Browse and claim dibs",
    body: "Find a card you want and tap Add to Cart (or Make Offer for a lower price). Claiming reserves it - it doesn't charge you anything yet.",
  },
  {
    title: "The seller messages you",
    body: "Place your order and we send one Messenger message to the seller for you, with everything they need to know. They'll reply to arrange payment.",
  },
  {
    title: "Pay via GCash or bank transfer",
    body: "Card Union doesn't process payments - you send payment directly to the seller, off-platform, the way you agree with them over Messenger.",
  },
  {
    title: "Admin confirms your payment",
    body: "Once the seller confirms they've received your payment, your order status updates to Paid and (if you gave us an email) you'll get a confirmation.",
  },
  {
    title: "Ship it, or stash it",
    body: "Choose per card whether the seller ships it to your address, or holds it for you to collect/combine with a future order - your call at Add to Cart.",
  },
  {
    title: "Leave a review",
    body: "Once you've received your card, leave the seller a review from My Dibs - it helps every other buyer on the platform.",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">How buying works</h1>
      <p className="mt-3 max-w-prose text-foreground-muted">
        Card Union is a claim-and-coordinate marketplace, not a checkout-and-ship store. Here&apos;s the whole flow, start to finish.
      </p>

      <ol className="mt-10">
        {STEPS.map(({ title, body }, i) => (
          <li key={title} className="relative flex gap-5 pb-8 last:pb-0">
            {i < STEPS.length - 1 && <span aria-hidden="true" className="absolute left-4.5 top-11 bottom-1 w-px bg-card-border" />}
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy-950 font-display text-lg font-medium tabular-nums text-gold ring-1 ring-gold/40">
              {i + 1}
            </span>
            <div className="min-w-0 pt-0.5">
              <h2 className="text-lg font-semibold leading-snug text-foreground">{title}</h2>
              <p className="mt-1 max-w-prose text-foreground-muted">{body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-12">
        <Link href="/marketplace">
          <Button variant="gold">Start browsing</Button>
        </Link>
      </div>
    </div>
  );
}
