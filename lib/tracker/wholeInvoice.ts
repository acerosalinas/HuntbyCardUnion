/** A card on a live's invoice, as the customer's order page sees it. */
interface InvoiceCard {
  id: string;
  left: number;
  underReview: boolean;
}

interface InvoiceLive {
  title: string;
  cards: InvoiceCard[];
}

/**
 * Payments are per invoice (one live), never for single cards: when any payable card of a live is selected, all of its
 * payable cards must be. "Payable" = still owing and not already waiting on a review. Returns the message for the first
 * live that breaks the rule, or null when the selection is made of whole invoices.
 */
export function wholeInvoiceViolation(lives: InvoiceLive[], selected: Set<string>): string | null {
  for (const live of lives) {
    const payable = live.cards.filter((c) => c.left > 0 && !c.underReview);
    const picked = payable.filter((c) => selected.has(c.id));
    if (picked.length > 0 && picked.length !== payable.length) {
      return `Payments are per invoice. Pay "${live.title}" as a whole - tick the invoice, not single cards.`;
    }
  }
  return null;
}
