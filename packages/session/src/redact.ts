const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const PATTERNS: [RegExp, string | ((match: string, ...groups: string[]) => string)][] = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, "[email]"],
  [/\b[\w.-]{2,}@[a-z]{2,}\b/gi, "[upi id]"],
  // A one-time code or a PIN given right after the word that introduces it.
  // "OTP is 482913", "CVV: 123": the code, after the word that introduces it and any "is"/"was"/colon between.
  [/\b(otp|one[- ]time (?:password|pin)|verification code|security code|cvv|cvc)((?:\s+(?:is|was|code|number|of))*[\s:=-]{0,12})\d{3,8}\b/gi, (_m, label, gap) => `${label}${gap}[code]`],
  [/\b(pin ?code|pincode|postal code|zip(?: code)?|pin)(\W{0,6})\d{6}\b/gi, (_m, label, gap) => `${label}${gap}[pin]`],
  [/\b[A-Z]{5}\d{4}[A-Z]\b/g, "[PAN]"],
  // Cards (13-19 digits) before Aadhaar (12), so a 16-digit card isn't split by the shorter pattern.
  [/\b\d(?:[ -]?\d){12,18}\b/g, "[card number]"],
  [/\b\d{4}[ -]\d{4}[ -]\d{4}\b/g, "[id number]"],
  [/(?<![\d₹.,])(?:(?:\+|00)?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g, "[phone]"],
  [/(?<![\d₹.,])\d{10}(?![\d,.])/g, "[phone]"],
];

/**
 * Masks private values in text that is about to be saved. Best effort: it catches the common shapes
 * (emails, UPI ids, phone, card, Aadhaar and PAN numbers, one-time codes, PIN codes after their label)
 * plus any words the person lists, such as their own name. It cannot know a name or address it wasn't told,
 * so a recording should still be looked over before it is shared.
 */
export function makeRedactor(terms: readonly string[] = []): (text: string) => string {
  // Short terms would mask half the page ("an", "Raj" inside "Rajasthan" is still wanted, but "ab" is not).
  const own = terms.map((t) => t.trim()).filter((t) => t.length >= 3);
  const ownPattern = own.length ? new RegExp(own.map(escapeRegExp).join("|"), "gi") : null;
  return (text) => {
    let out = ownPattern ? text.replace(ownPattern, "[redacted]") : text;
    for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement as string);
    return out;
  };
}

/** Splits a "--redact" argument such as "Asha Verma, 9876543210, 12 MG Road" into terms. */
export function parseTerms(arg: string | undefined): string[] {
  return (arg ?? "").split(",").map((t) => t.trim()).filter(Boolean);
}
