"use client";

import { createContext, ReactNode, useCallback, useContext, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" for destructive actions (red button, focus starts on Cancel so a stray Enter can't destroy anything). */
  tone?: "danger" | "primary";
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Replaces the browser's native window.confirm() with an in-app dialog that
 * matches the site's look. Call sites keep the same shape as before:
 * `if (!(await confirm({ ... }))) return;`
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((result: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((next) => {
    return new Promise<boolean>((resolve) => {
      // A second dialog opening while one is showing cancels the first.
      resolver.current?.(false);
      resolver.current = resolve;
      setOptions(next);
    });
  }, []);

  const settle = useCallback((result: boolean) => {
    resolver.current?.(result);
    resolver.current = null;
    setOptions(null);
  }, []);

  const cancel = useCallback(() => settle(false), [settle]);
  const danger = options?.tone === "danger";

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal open={options !== null} onClose={cancel} title={options?.title ?? ""}>
        <div className="space-y-5">
          <div className="text-sm text-foreground-muted">{options?.message}</div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={cancel} autoFocus={danger}>
              {options?.cancelLabel ?? "Cancel"}
            </Button>
            <Button variant={danger ? "danger" : "primary"} onClick={() => settle(true)} autoFocus={!danger}>
              {options?.confirmLabel ?? "Confirm"}
            </Button>
          </div>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm must be used inside <ConfirmProvider>.");
  return confirm;
}
