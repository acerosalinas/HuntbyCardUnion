import { LegalPageLayout } from "@/components/LegalPageLayout";

export const metadata = { title: "Privacy Policy — Card Union" };

export default function PrivacyPage() {
  return (
    <LegalPageLayout title="Privacy Policy" updated="August 2026">
      <p>
        This page explains what information Hunt by Card Union collects, why, and how it&apos;s handled. We collect
        the minimum needed to run a card marketplace and coordinate off-platform payments and shipping.
      </p>

      <section>
        <h2>1. What we collect</h2>
        <ul>
          <li>Account info: full name, unique handle, email address, and password (handled securely by our auth provider, Supabase - we never see your raw password).</li>
          <li>Shipping details you choose to save: recipient name, phone number, address, and zip code, used to pre-fill checkout.</li>
          <li>Order activity: cards claimed, offers made, quantities, and timestamps.</li>
          <li>Photos you upload: card listing photos (sellers) and dispute evidence photos (buyers).</li>
          <li>Basic technical data: your session cookie, used only to keep you signed in.</li>
        </ul>
      </section>

      <section>
        <h2>2. How we use it</h2>
        <ul>
          <li>To run your account, show your claims/offers, and let sellers fulfill your order.</li>
          <li>To email you a payment confirmation once a seller marks your order as paid.</li>
          <li>To resolve disputes, using the evidence and order history tied to that claim.</li>
          <li>To show your default shipping details automatically at checkout, if you&apos;ve saved them.</li>
        </ul>
        <p>We do not sell your data, and we do not use it for advertising.</p>
      </section>

      <section>
        <h2>3. Who we share it with</h2>
        <p>
          Your shipping details are shared with the seller of an item you&apos;ve claimed, so they can ship it to
          you. We use two service providers to run the platform:
        </p>
        <ul>
          <li>
            <strong>Supabase</strong> - hosts our database, authentication, and file storage.
          </li>
          <li>
            <strong>Resend</strong> - sends payment-confirmation emails on our behalf.
          </li>
        </ul>
        <p>We don&apos;t share your information with anyone else, except where required by law.</p>
      </section>

      <section>
        <h2>4. Dispute evidence</h2>
        <p>
          Photos submitted as dispute evidence are stored privately - they are never publicly accessible, and are
          only viewable by you and the admin handling that dispute.
        </p>
      </section>

      <section>
        <h2>5. Your choices</h2>
        <p>
          You can update your name, handle, and saved shipping details anytime from your account settings. To
          request deletion of your account or data, contact your admin - since Card Union is invite-only, we handle
          deletion requests directly rather than through a self-service tool.
        </p>
      </section>

      <section>
        <h2>6. Cookies</h2>
        <p>
          We use cookies only to keep you signed in (a buyer session and, separately, an admin session can coexist in
          the same browser). We don&apos;t use tracking or advertising cookies.
        </p>
      </section>

      <section>
        <h2>7. Changes</h2>
        <p>We may update this policy as the platform evolves. Material changes will be reflected here with a new date.</p>
      </section>

      <section>
        <h2>8. Contact</h2>
        <p>Questions about your data? Reach out to your account admin.</p>
      </section>
    </LegalPageLayout>
  );
}
