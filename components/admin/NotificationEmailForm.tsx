"use client";

import { FormEvent, useState, useTransition } from "react";
import { Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { saveNotificationEmail, sendTestNotificationEmail } from "@/app/admin/notificationEmailActions";

/** Private settings: where this shop's notification emails (new offers, claimed cards) are sent. Not shown on the public storefront. */
export function NotificationEmailForm({ loginEmail, notificationEmail, setUp }: { loginEmail: string; notificationEmail: string | null; setUp: boolean }) {
  const [value, setValue] = useState(notificationEmail ?? "");
  const [saved, setSaved] = useState<string | null>(notificationEmail);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = value.trim().toLowerCase() !== (saved ?? "");
  const sendingTo = saved ?? loginEmail;

  const save = (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await saveNotificationEmail(value);
      if (result.error) return setMessage({ kind: "error", text: result.error });
      setSaved(result.email ?? null);
      setValue(result.email ?? "");
      setMessage({ kind: "ok", text: result.email ? `Saved. Notification emails now go to ${result.email}.` : `Saved. Notification emails go to your sign-in address, ${loginEmail}.` });
    });
  };

  const test = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await sendTestNotificationEmail();
      setMessage(result.error ? { kind: "error", text: result.error } : { kind: "ok", text: `Test email sent to ${result.sentTo}. It can take a minute, and may land in spam the first time.` });
    });
  };

  return (
    <section className="rounded-2xl border border-card-border bg-card p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Mail size={16} aria-hidden="true" /> Notification email
      </h2>
      <p className="mt-1 text-sm text-foreground-muted">
        Where we email you about new offers and claimed cards. This is private, and it doesn&apos;t change the address you sign in with ({loginEmail}). Leave it empty to
        use your sign-in address.
      </p>
      {!setUp && <p className="mt-2 rounded-lg border border-pending/30 bg-pending-bg px-3 py-2 text-sm text-pending">Not set up yet: run supabase/migration_admin_notification_email.sql in the Supabase SQL editor.</p>}
      <form onSubmit={save} className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-60 flex-1">
          <label htmlFor="notification-email" className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
            Send notification emails to
          </label>
          <Input id="notification-email" type="email" inputMode="email" autoComplete="email" value={value} onChange={(e) => setValue(e.target.value)} placeholder={loginEmail} maxLength={254} />
        </div>
        <Button type="submit" variant="gold" disabled={pending || !dirty}>
          Save
        </Button>
        <Button type="button" variant="outline" disabled={pending || dirty} onClick={test} title={dirty ? "Save first, then send a test" : `Send a test to ${sendingTo}`}>
          <Send size={14} /> Send test
        </Button>
      </form>
      {message && (
        <p role="status" className={message.kind === "ok" ? "mt-2 text-sm text-available" : "mt-2 text-sm text-sold"}>
          {message.text}
        </p>
      )}
    </section>
  );
}
