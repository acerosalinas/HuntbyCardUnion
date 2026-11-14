"use client";

import { useState, useTransition } from "react";
import { ClipboardCopy } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { fullBalanceText } from "@/app/tracker/customerActions";
import { copyText } from "@/lib/tracker/clipboard";
import { cn } from "@/lib/utils";

/** One tap on the Customers list: copies that customer's full balance (live tracker + marketplace, one total) ready to paste into the chat. */
export function CopyBalanceButton({ customerId, customerName, className }: { customerId: string; customerName: string; className?: string }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  const copy = () => {
    setState("idle");
    startTransition(async () => {
      const result = await fullBalanceText(customerId);
      const ok = result.text ? await copyText(result.text) : false;
      setState(ok ? "copied" : "error");
      setTimeout(() => setState("idle"), 2500);
    });
  };

  return (
    <Button
      variant="outline"
      type="button"
      disabled={pending}
      onClick={copy}
      className={cn("px-2.5 py-1 text-xs", state === "error" && "border-sold text-sold", className)}
      aria-label={`Copy ${customerName}'s full balance`}
      title="Copy the full balance (live + marketplace) to paste into the chat"
    >
      <ClipboardCopy size={12} aria-hidden="true" /> {pending ? "Preparing..." : state === "copied" ? "Copied!" : state === "error" ? "Couldn't copy" : "Copy balance"}
    </Button>
  );
}
