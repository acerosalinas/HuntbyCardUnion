/**
 * Who may use the site. Anyone can sign up and use it straight away. An admin can put an account ON HOLD
 * (`approved: false` in the account's app_metadata - only the server can write that, users can never change their own
 * app_metadata); an account on hold only sees /account/on-hold until it is released. Admin accounts are always allowed.
 * A brand-new account has no flag, which means allowed.
 */
export function isAllowedIn(appMetadata: Record<string, unknown> | null | undefined): boolean {
  const role = appMetadata?.role;
  if (role === "ADMIN" || role === "SUPER_ADMIN") return true;
  return appMetadata?.approved !== false;
}

/** Emails are compared (and stored in removed_users) in lower case. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Where a removed (or on-hold) person is told to reach you. */
export const CONTACT = {
  tiktokHandle: "@cardunion",
  tiktokUrl: "https://www.tiktok.com/@cardunion",
  facebookName: "Card Union",
} as const;

export const REMOVED_MESSAGE = `This account was removed. To ask for access again, please message us on TikTok ${CONTACT.tiktokHandle} or on Facebook (${CONTACT.facebookName}).`;
