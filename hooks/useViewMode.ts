"use client";

import { useEffect, useState } from "react";

export type ViewMode = "tiles" | "list";
const KEY = "cu-wanted-view";

/** Tiles or list, remembered in this browser. Starts as tiles so the server and first client render match. */
export function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>("tiles");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring a saved preference after mount, not fetching data
      if (stored === "list" || stored === "tiles") setMode(stored);
    } catch {
      // storage blocked - keep the default
    }
  }, []);

  const update = (next: ViewMode) => {
    setMode(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // storage blocked - the choice just won't be remembered
    }
  };

  return [mode, update];
}
