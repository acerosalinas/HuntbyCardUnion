import Link from "next/link";
import { LegalPageLayout } from "@/components/LegalPageLayout";

export const metadata = { title: "Refund & Dispute Policy — Card Union" };

export default function RefundPolicyPage() {
  return (
    <LegalPageLayout title="Refund & Dispute Policy" updated="August 2026">
      <p>
        Because Card Union doesn&apos;t process payments, we can&apos;t issue refunds directly through the platform -
        any refund happens the same way the original payment did, between you and the seller. What we do provide is
        a structured dispute process so a problem order doesn&apos;t just fall through the cracks.
      </p>

      <section>
        <h2>1. When to open a dispute</h2>
        <ul>
          <li>
            <strong>Item Not Received</strong> - you paid and the seller confirmed it, but the card never arrived.
          </li>
          <li>
            <strong>Not as Described</strong> - the card doesn&apos;t match its listed condition, rarity, or photos.
          </li>
          <li>
            <strong>Damaged in Transit</strong> - it arrived damaged.
          </li>
          <li>
            <strong>Other</strong> - anything else that doesn&apos;t fit the categories above.
          </li>
        </ul>
        <p>
          You can open a dispute from <strong>My Dibs</strong> on any card you&apos;ve bought, and attach photo
          evidence to support it.
        </p>
      </section>

      <section>
        <h2>2. How it&apos;s resolved</h2>
        <p>
          Once opened, the seller&apos;s admin can respond with their side and evidence. If it&apos;s not resolved
          between you directly, an admin reviews both sides and marks the dispute either <strong>refund</strong> or{" "}
          <strong>dismissed</strong>. A refund resolution is bookkeeping only - the admin or seller still arranges the
          actual money back to you via GCash/bank transfer, the same way you originally paid.
        </p>
      </section>

      <section>
        <h2>3. Timelines</h2>
        <p>
          There&apos;s no fixed SLA today since resolutions are handled personally by our small admin team, but we
          aim to respond to every dispute promptly. You can message your seller directly via Messenger at any point
          to speed things along.
        </p>
      </section>

      <section>
        <h2>4. Final decisions</h2>
        <p>
          Once a dispute is marked resolved, that decision is final - it won&apos;t be silently reopened or
          reversed. If a genuinely new issue comes up on the same card, you can open a new dispute (limited to a
          couple of attempts per card, to keep the process fair for sellers).
        </p>
      </section>

      <section>
        <h2>5. Before you claim</h2>
        <p>
          Since sales are between individual sellers off-platform, check a card&apos;s listed condition and photos
          carefully before claiming, and keep your Messenger conversation with the seller as your own record of what
          was agreed.
        </p>
      </section>

      <p className="pt-2 text-xs">
        See also our{" "}
        <Link href="/terms" className="text-gold underline underline-offset-2">
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="text-gold underline underline-offset-2">
          Privacy Policy
        </Link>
        .
      </p>
    </LegalPageLayout>
  );
}
