"use client";

import { useEffect, useState } from "react";

function computeRemaining(targetMs: number | null | undefined): number {
  return targetMs ? Math.max(0, targetMs - Date.now()) : 0;
}

/** Recomputes remaining milliseconds every second until the target passes. */
export function useCountdown(targetMs: number | null | undefined): number {
  const [remaining, setRemaining] = useState(() => computeRemaining(targetMs));
  const [trackedTarget, setTrackedTarget] = useState(targetMs);

  if (targetMs !== trackedTarget) {
    setTrackedTarget(targetMs);
    setRemaining(computeRemaining(targetMs));
  }

  useEffect(() => {
    if (!targetMs) return;
    const interval = setInterval(() => {
      setRemaining(computeRemaining(targetMs));
    }, 1000);
    return () => clearInterval(interval);
  }, [targetMs]);

  return remaining;
}
