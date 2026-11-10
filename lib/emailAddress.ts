/** Same shape the database check accepts (admin_settings.notification_email): something@something.tld, no spaces, at most 254 characters. */
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * A clean address ready to store, or an error message to show. An empty box is allowed and means "use my sign-in email".
 * Addresses are stored lower-case so the same inbox is never saved twice in different spellings.
 */
export function parseNotificationEmail(raw: string): { email: string | null; error?: undefined } | { email?: undefined; error: string } {
  const value = raw.trim().toLowerCase();
  if (value === "") return { email: null };
  if (value.length > 254 || !EMAIL_PATTERN.test(value)) return { error: "That doesn't look like an email address." };
  return { email: value };
}
