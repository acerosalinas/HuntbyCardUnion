import { PlugZap } from "lucide-react";

export function SetupNotice() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-24 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-gold/40 bg-navy-950 text-gold glow-gold">
        <PlugZap size={26} />
      </div>
      <h1 className="text-xl font-semibold">Connect Supabase to get started</h1>
      <p className="text-sm text-foreground-muted">
        Create a Supabase project, run <code className="rounded bg-foreground/10 px-1.5 py-0.5">supabase/schema.sql</code>{" "}
        in the SQL editor, then copy <code className="rounded bg-foreground/10 px-1.5 py-0.5">.env.local.example</code>{" "}
        to <code className="rounded bg-foreground/10 px-1.5 py-0.5">.env.local</code> and fill in your project URL
        and keys. Restart the dev server once your env vars are set.
      </p>
    </div>
  );
}
