"use client";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { ContactUs } from "@/components/ContactUs";

/** Pop-up for someone whose account was removed and who tries to sign in or sign up again. */
export function RemovedAccessModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Account removed">
      <div className="space-y-4">
        <p className="text-sm text-foreground-muted">This account was removed, so you can&apos;t sign in. If you&apos;d like access again, please message us:</p>
        <ContactUs />
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
