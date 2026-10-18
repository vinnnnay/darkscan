import type { ButtonStyle, CartItem, PriceLine, PriceSnapshot } from "@darkscan/schema";

const DECLINE = /^(no\b|not now|skip|maybe later|later|close|cancel|dismiss|reject|decline|deny|×|✕)/i;
const ACCEPT = /^(add|subscribe|accept|allow|agree|yes|buy|join|sign ?up|register|get|claim|unlock|ok(ay)?\b|continue$)/i;

/**
 * Picks the button a cautious shopper would press to say no. Known decline wording wins;
 * otherwise, since decline wording varies endlessly ("I'm just browsing", "Continue
 * without protection"), it takes the least prominent button that isn't an accept action.
 * Returns null when every button accepts something.
 */
export function chooseDecline(buttons: ButtonStyle[]): ButtonStyle | null {
  const named = buttons.find((b) => DECLINE.test(b.text));
  if (named) return named;
  // A link ("Shop all ethnic wear") goes somewhere; only a real button can be a way to say no.
  const candidates = buttons.filter((b) => b.text && !b.link && !ACCEPT.test(b.text));
  candidates.sort((a, b) => a.widthPx * a.heightPx - b.widthPx * b.heightPx);
  return candidates[0] ?? null;
}

// Matches "₹1,299", "Rs. 99", "INR 40.50" and "-₹50". The sign group catches discounts.
const AMOUNT = /([-−]\s*)?(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/gi;
const QTY = /(?:×\s*|\bqty\.?\s*:?\s*)(\d+)\b/i;

const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

function amounts(text: string): { paise: number; index: number }[] {
  return [...text.matchAll(AMOUNT)].map((m) => {
    const paise = Math.round(parseFloat(m[2]!.replace(/,/g, "")) * 100);
    return { paise: m[1] ? -paise : paise, index: m.index };
  });
}

export function parseAmountPaise(text: string): number | null {
  const all = amounts(text);
  return all.length ? all[all.length - 1]!.paise : null;
}

type LineKind = PriceLine["kind"] | "total" | "subtotal";

export function classifyLabel(label: string, amountPaise: number): LineKind {
  const l = label.toLowerCase();
  if (/\bsub\s*-?\s*total\b/.test(l)) return "subtotal";
  if (/\b(grand\s+|order\s+)?total\b|amount payable|to pay\b/.test(l)) return "total";
  if (/deliver|shipping/.test(l)) return "shipping";
  if (/\bgst\b|\btax/.test(l)) return "tax";
  if (amountPaise < 0 || /discount|coupon|savings|\boff\b/.test(l)) return "discount";
  if (/\bfee|charge|handling|convenience|packag/.test(l)) return "fee";
  return "item";
}

/**
 * Turns the visible text of an order summary into price lines. Works on what the
 * browser renders ("Label\t₹99", or a label line followed by an amount line), so it
 * doesn't depend on any one site's markup.
 */
export function parsePriceText(text: string): PriceSnapshot | null {
  const lines: PriceLine[] = [];
  let totalPaise: number | null = null;
  let pendingLabel: string | null = null;

  const push = (label: string, amountPaise: number) => {
    const kind = classifyLabel(label, amountPaise);
    if (kind === "total") totalPaise = amountPaise;
    else if (kind !== "subtotal") lines.push({ label, amountPaise, kind });
  };

  for (const raw of text.split("\n")) {
    const line = normalize(raw);
    if (!line) continue;
    const found = amounts(line);
    if (found.length) {
      // With "MRP ₹1,999 ₹1,299", the label is before the first amount and the charged price is the last.
      const label = line.slice(0, found[0]!.index).replace(/[:\-–\s]+$/, "").trim() || pendingLabel;
      pendingLabel = null;
      if (label) push(label, found[found.length - 1]!.paise);
      continue;
    }
    const free = /^(.*?)\s*\bfree\b$/i.exec(line);
    if (free) {
      const label = free[1] || pendingLabel;
      pendingLabel = null;
      if (label) push(label, 0);
      continue;
    }
    pendingLabel = line.length <= 40 ? line : null;
  }

  if (lines.length === 0 && totalPaise === null) return null;
  return { lines, totalPaise, source: "dom" };
}

/**
 * Parses cart rows (found by their Remove buttons). Anything the crawler didn't
 * add itself is marked addedByAgent: false, a basket-sneaking candidate.
 */
export function parseCartRows(rows: string[], agentAdded: readonly string[]): CartItem[] {
  const seen = new Set<string>();
  const items: CartItem[] = [];
  for (const raw of rows) {
    const text = normalize(raw);
    const qty = QTY.exec(text);
    const name = normalize(text.replace(QTY, "").replace(AMOUNT, ""));
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const lower = name.toLowerCase();
    items.push({
      name,
      qty: qty ? Number(qty[1]) : 1,
      unitPaise: parseAmountPaise(text),
      addedByAgent: agentAdded.some((a) => lower.includes(a.toLowerCase()) || a.toLowerCase().includes(lower)),
    });
  }
  claimBySimilarity(items, agentAdded);
  return items;
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []);

/**
 * Real carts often title a product differently from its page ("Galaxy M34 5G (Blue, 128GB)"
 * vs "Samsung Galaxy M34"). For each product the crawler added that matched no row by name,
 * claim the unmatched row sharing the most words with it, or the first unmatched row if none
 * share any. Only rows beyond what the crawler added stay flagged as not added by it.
 */
function claimBySimilarity(items: CartItem[], agentAdded: readonly string[]) {
  for (const added of new Set(agentAdded.map((a) => a.toLowerCase()))) {
    if (items.some((i) => i.addedByAgent && (i.name.toLowerCase().includes(added) || added.includes(i.name.toLowerCase())))) continue;
    const unmatched = items.filter((i) => !i.addedByAgent);
    if (unmatched.length === 0) return;
    const target = words(added);
    const overlap = (i: CartItem) => [...words(i.name)].filter((w) => target.has(w)).length;
    const best = unmatched.reduce((a, b) => (overlap(b) > overlap(a) ? b : a));
    best.addedByAgent = true;
  }
}
