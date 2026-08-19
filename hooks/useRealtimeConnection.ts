"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Tracks whether the Supabase Realtime connection is currently up, via a
 * dedicated heartbeat channel (no table data involved). Used to warn users
 * when live updates (new claims, queue changes, etc.) may be stale.
 */
export function useRealtimeConnection(): boolean {
  const [connected, setConnected] = useState(true);
  const supabase = useMemo(() => {
    try {
      return createClient();
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;

    const channel = supabase.channel("connection-heartbeat").subscribe((status) => {
      if (status === "SUBSCRIBED") {
        setConnected(true);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        setConnected(false);
      }
    });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  return connected;
}
