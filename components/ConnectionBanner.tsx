"use client";

import { WifiOff } from "lucide-react";
import { useRealtimeConnection } from "@/hooks/useRealtimeConnection";

export function ConnectionBanner() {
  const connected = useRealtimeConnection();
  if (connected) return null;

  // Rendered by Navbar inside its fixed top bar, above <header> - no
  // positioning of its own needed, that wrapper already pins both to the
  // viewport and stacks them in document order.
  return (
    <div className="flex items-center justify-center gap-2 bg-sold px-4 py-2 text-center text-sm font-medium text-white">
      <WifiOff size={15} />
      Live updates are paused — reconnecting. Refresh the page if this doesn&apos;t clear up.
    </div>
  );
}
