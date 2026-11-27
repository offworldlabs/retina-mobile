// Only catches typos before a request; whether the address gets mail is the server's call.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Whether `value`, already trimmed, looks like an email address. */
export function isValidEmail(value: string): boolean {
  return EMAIL.test(value);
}

/** Whether two addresses name the same account: trimmed, ignoring case. */
export function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
