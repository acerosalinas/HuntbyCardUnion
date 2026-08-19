"use client";

import { Modal } from "@/components/ui/Modal";
import { InventoryForm } from "@/components/admin/InventoryForm";
import { CardItem } from "@/types/marketplace";

interface EditListingModalProps {
  card: CardItem | null;
  onClose: () => void;
}

export function EditListingModal({ card, onClose }: EditListingModalProps) {
  return (
    <Modal
      open={Boolean(card)}
      onClose={onClose}
      title={card ? `Edit — ${card.title}` : ""}
      className="max-w-2xl max-h-[90vh] overflow-y-auto"
    >
      {card && <InventoryForm card={card} onSuccess={onClose} />}
    </Modal>
  );
}
