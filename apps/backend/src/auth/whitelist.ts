const envEmails = process.env.ALLOWED_EMAILS;

export const registrationWhitelist = envEmails
  ? new Set(envEmails.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean))
  : null;

export function isEmailAllowed(email: string): boolean {
  if (!registrationWhitelist) return true;
  return registrationWhitelist.has(email.toLowerCase());
}
