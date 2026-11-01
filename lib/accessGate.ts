/**
 * Who may use the site. Buyers have to be approved by an admin first: approval is the flag `approved: true` in the
 * account's app_metadata (only the server can write it - users can never change app_metadata themselves). Admin
 * accounts are always allowed. A brand-new account has no flag, so it waits at /account/pending until approved.
 */
export function isApproved(appMetadata: Record<string, unknown> | null | undefined): boolean {
  const role = appMetadata?.role;
  if (role === "ADMIN" || role === "SUPER_ADMIN") return true;
  return appMetadata?.approved === true;
}

/** Emails are compared (and stored in removed_users) in lower case. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Where a removed (or waiting) person is told to reach you. */
export const CONTACT = {
  tiktokHandle: "@cardunion",
  tiktokUrl: "https://www.tiktok.com/@cardunion",
  facebookName: "Card Union",
} as const;

export const REMOVED_MESSAGE = `This account was removed. To ask for access again, please message us on TikTok ${CONTACT.tiktokHandle} or on Facebook (${CONTACT.facebookName}).`;
