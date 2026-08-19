import Link from "next/link";
import { MailCheck } from "lucide-react";

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from = "/" } = await searchParams;
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-4 px-4 py-24">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-gold/40 bg-navy-950 text-gold glow-gold">
        <MailCheck size={26} />
      </div>
      <h1 className="text-xl font-semibold">Check Your Email</h1>
      <p className="text-center text-sm text-foreground-muted">
        We sent you a confirmation link. Click it, then sign in to continue.
      </p>
      <Link href={`/account/login?from=${encodeURIComponent(from)}`} className="text-sm text-gold hover:underline">
        Go to sign in
      </Link>
    </div>
  );
}
