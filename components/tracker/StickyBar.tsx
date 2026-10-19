"use client";

import { ReactNode, useLayoutEffect, useRef, useState } from "react";

/**
 * Pins the tracker's header + menu to the top while the page scrolls.
 * `position: sticky` can't work here - html and body both set overflow-x:
 * hidden (see globals.css), which makes body its own scroll container - so
 * this is `fixed` (same approach as the site Navbar) plus a spacer of the
 * bar's measured height, so the page content never slides underneath it.
 */
export function StickyBar({ children }: { children: ReactNode }) {
  const barRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const measure = () => setHeight(bar.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={barRef} className="fixed inset-x-0 top-0 z-30 border-b border-card-border bg-background/95 backdrop-blur-md">
        {children}
      </div>
      <div aria-hidden style={{ height }} />
    </>
  );
}
