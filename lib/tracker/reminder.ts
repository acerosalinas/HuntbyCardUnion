import { formatCurrency } from "@/lib/utils";
import { round2 } from "./money";

/** People are not reminded again for this long after the last reminder from the same seller. */
export const REMINDER_COOLDOWN_HOURS = 24;

/** One person who may owe the seller: a tracker customer, a marketplace buyer, or both when the customer is linked to the buyer's account. */
export interface ReminderPerson {
  /** The buyer account id when there is one, else the tracker customer id. */
  key: string;
  name: string;
  /** The marketplace account that can be notified, or null (then they can only be reminded by hand). */
  buyerId: string | null;
  /** Unpaid cards from lives (a credit is never netted against anything). */
  liveOwed: number;
  liveCards: number;
  /** Pay-now marketplace orders not paid yet (cash-on-delivery is paid to the courier, so it is not chased). */
  marketOwed: number;
  marketOrders: number;
}

export interface ReminderPlan {
  toNotify: ReminderPerson[];
  /** Reminded less than REMINDER_COOLDOWN_HOURS ago. */
  recentlyReminded: ReminderPerson[];
  /** Owe money but have no linked account, so the app can't reach them. */
  unreachable: ReminderPerson[];
  /** What everyone in toNotify owes together. */
  totalOwed: number;
}

export const owedBy = (p: Pick<ReminderPerson, "liveOwed" | "marketOwed">) => round2(Math.max(0, p.liveOwed) + Math.max(0, p.marketOwed));

/**
 * Decides who is reminded: everyone who owes something and can be reached, except anyone reminded within the cooldown.
 * `lastReminded` maps a buyer account id to when this seller last reminded them.
 */
export function planReminders(people: ReminderPerson[], lastReminded: Map<string, string>, now: Date): ReminderPlan {
  const plan: ReminderPlan = { toNotify: [], recentlyReminded: [], unreachable: [], totalOwed: 0 };
  const cutoff = now.getTime() - REMINDER_COOLDOWN_HOURS * 3_600_000;
  for (const p of people) {
    if (owedBy(p) <= 0) continue;
    if (!p.buyerId) {
      plan.unreachable.push(p);
      continue;
    }
    const last = lastReminded.get(p.buyerId);
    if (last && new Date(last).getTime() > cutoff) plan.recentlyReminded.push(p);
    else {
      plan.toNotify.push(p);
      plan.totalOwed = round2(plan.totalOwed + owedBy(p));
    }
  }
  return plan;
}

/** The bell notification the customer receives, and where it takes them. */
export function reminderText(shopName: string, p: Pick<ReminderPerson, "liveOwed" | "liveCards" | "marketOwed" | "marketOrders">): { title: string; body: string; link: string } {
  const total = owedBy(p);
  const parts: string[] = [];
  if (p.liveOwed > 0) parts.push(`${p.liveCards} card${p.liveCards === 1 ? "" : "s"} from the live${p.liveCards === 1 ? "" : "s"} (${formatCurrency(round2(p.liveOwed))})`);
  if (p.marketOwed > 0) parts.push(`${p.marketOrders} marketplace order${p.marketOrders === 1 ? "" : "s"} (${formatCurrency(round2(p.marketOwed))})`);
  return {
    title: `Payment reminder from ${shopName}`,
    body: `You still have ${formatCurrency(total)} waiting to be paid: ${parts.join(" and ")}. Open the app to see it and send your payment.`,
    // Live cards are paid from My Live Orders; a buyer who only has marketplace orders pays them from My Dibs.
    link: p.liveOwed > 0 ? "/account/orders" : "/account/dibs",
  };
}
