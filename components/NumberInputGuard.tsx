"use client";

import { useEffect } from "react";

/**
 * Stops the mouse wheel from changing a number field. Browsers nudge a focused number input up or down as you scroll
 * over it, which silently changes a price while someone is just scrolling the page. Blurring the field on wheel makes
 * the page scroll instead and leaves the value alone. One listener covers every number input in the app.
 */
export function NumberInputGuard() {
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const el = e.target;
      if (el instanceof HTMLInputElement && el.type === "number" && document.activeElement === el) el.blur();
    };
    document.addEventListener("wheel", onWheel, { passive: true });
    return () => document.removeEventListener("wheel", onWheel);
  }, []);
  return null;
}
