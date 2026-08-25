import Link from "next/link";
import { LegalPageLayout } from "@/components/LegalPageLayout";

export const metadata = { title: "Terms of Service — Card Union" };

export default function TermsPage() {
  return (
    <LegalPageLayout title="Terms of Service" updated="August 2026">
      <p>
        Hunt by Card Union (&quot;Card Union,&quot; &quot;we,&quot; &quot;us&quot;) is a private, invite-only
        marketplace for trading card collectors in the Philippines. By creating an account or using this site, you
        agree to the terms below.
      </p>

      <section>
        <h2>1. Who this is for</h2>
        <p>
          Card Union is invite-only. Buyer accounts are open to anyone who signs up, but seller accounts are created
          directly by our admin team - there is no public seller signup. You must be at least 18 years old, or have a
          parent/guardian&apos;s permission, to buy or sell here.
        </p>
      </section>

      <section>
        <h2>2. How buying works</h2>
        <p>
          Claiming a card (&quot;dibs&quot;) reserves it for you but does not charge you anything - Card Union does
          not process payments. Once you claim a card, the seller reaches out via Facebook Messenger to arrange
          payment through GCash or bank transfer, entirely outside this platform. Your claim is only confirmed once
          the seller/admin marks your payment as received.
        </p>
        <p>
          A claim has no automatic expiry. If you no longer want an item you haven&apos;t paid for yet, cancel it
          from My Dibs so it can be released to the next buyer.
        </p>
      </section>

      <section>
        <h2>3. No payment processing</h2>
        <p>
          Card Union is a listing and coordination tool, not a payment processor or escrow service. We never collect
          your card or bank details, and we are not a party to the payment you send a seller. All payments happen
          directly between buyer and seller off-platform, at your own discretion.
        </p>
      </section>

      <section>
        <h2>4. Disputes</h2>
        <p>
          If an order goes wrong - item not received, not as described, or damaged in transit - open a dispute from
          My Dibs within a reasonable time of the issue. Our admin team reviews evidence from both sides and decides
          on a resolution. See our{" "}
          <Link href="/refund-policy" className="text-gold underline underline-offset-2">
            Refund &amp; Dispute Policy
          </Link>{" "}
          for details. Dispute resolutions are final once issued.
        </p>
      </section>

      <section>
        <h2>5. Conduct</h2>
        <ul>
          <li>Don&apos;t misrepresent a card&apos;s condition, rarity, or authenticity.</li>
          <li>Don&apos;t use claims to hold cards you don&apos;t intend to pay for.</li>
          <li>Don&apos;t harass sellers, buyers, or admins, on or off this platform.</li>
          <li>Don&apos;t attempt to circumvent, scrape, or abuse the site&apos;s systems.</li>
        </ul>
        <p>We may suspend or remove any account that violates these terms.</p>
      </section>

      <section>
        <h2>6. No warranty</h2>
        <p>
          Card Union is provided as-is. We do our best to keep listings accurate and the site running, but we don&apos;t
          guarantee a card&apos;s condition, a seller&apos;s conduct, or uninterrupted access to the site.
        </p>
      </section>

      <section>
        <h2>7. Changes</h2>
        <p>
          We may update these terms as the platform evolves. Continued use after a change means you accept the
          update.
        </p>
      </section>

      <section>
        <h2>8. Contact</h2>
        <p>Questions about these terms? Reach out via the Messenger link on your seller&apos;s profile, or your account admin.</p>
      </section>
    </LegalPageLayout>
  );
}
