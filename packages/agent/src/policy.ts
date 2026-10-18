import { PAYMENT } from "@darkscan/crawler";
import type { Candidate, PageFacts } from "./observe.ts";

export type PageKind = "account_wall" | "payment" | "checkout" | "cart" | "product" | "listing";

/** What the agent decided to do next. */
export type Choice =
  | { role: "product" | "category" | "add" | "cart" | "checkout" | "guest" | "promo" | "llm"; candidate: Candidate; why: string }
  | { role: "variant"; option: string; why: string }
  | { role: "urgency-probe" | "back"; why: string };

export type Decision = Choice | { stop: string } | null;

const ADD = /\badd to (cart|bag|basket|trolley)\b/i;
const GUEST = /\bguest\b|skip sign.?in|without (an )?(account|sign|regist)/i;
const CHECKOUT = /check ?out|proceed to buy|continue to (shipping|address|delivery)|^proceed$/i;
const CART_LINK = /\bcart\b|\bbag\b|\bbasket\b|\btrolley\b/i;
const PROMO = /\b(deal|offer|sale|off|discount)\b|\b(just|only|at|from)\s*₹/i;
const SPONSORED = /\b(sponsored|promoted|ad)\b/i;
// Entering payment details. "Net Banking" is left out on purpose: shop footers list it as an accepted method.
const PAYMENT_PAGE = /\/(payment|pay|billing)(\/|$|\?)|card number|\bcvv\b|\bupi id\b/i;
// Pages that list or search products, not one product: never a good product to open.
const LISTING_PATH = /\/(search|category|categories|collections?|brands?|offers?|deals?|sale)(\/|$|\?|-)|[?&](q|text|query|search)=|\/page-\d+/i;
// The URL shapes shops use for one product: /p/, /dp/, /product/, /p-mp000…, …/buy
const PRODUCT_PATH = /\/(p|dp|pd|product|products|item)(\/|-|$)|\/p-[a-z0-9]|\/buy$/i;

/** A link's path and query, which is how the agent remembers where it has already been. */
export function pathOf(href: string | null): string | null {
  if (!href) return null;
  const url = new URL(href);
  return url.pathname + url.search;
}

/** Who a candidate is, for remembering what was already tried: its URL, or its text for non-link cards. */
export function identity(c: Candidate): string {
  return pathOf(c.href) ?? `text:${c.text}`;
}

/** How the agent remembers a control that could not be clicked on a given page. */
export const failedKey = (url: string, c: Candidate) => `${url}|${identity(c)}`;

/** How the agent remembers a size or variant it already picked. */
export const variantKey = (option: string) => `variant:${option}`;

const usable = (c: Candidate) => !c.disabled && !PAYMENT.test(c.text);
/** A link back to the page we are already on (a "#" anchor, say). Cards without a URL are never this. */
const samePage = (c: Candidate, f: PageFacts) => c.href !== null && c.href.split("#")[0] === f.url.split("#")[0];

/** Names the kind of page the shopper is on, from what's visible. Order matters: the first match wins. */
export function classifyPage(f: PageFacts): PageKind {
  const { pathname } = new URL(f.url);
  if (f.paymentOverlay || PAYMENT_PAGE.test(pathname) || PAYMENT_PAGE.test(f.text)) return "payment";
  // A visible password field on a page that lists no cart items is an account page, whatever its heading says.
  if (f.hasPasswordField && f.cartRows === 0) return "account_wall";
  // A checkout form asks for a name, address, PIN code. A search or newsletter box doesn't make a page one.
  if (f.formFields >= 3 || (/checkout/i.test(pathname) && f.formFields >= 2)) return "checkout";
  if (f.cartRows > 0 || /\/cart\b/i.test(pathname)) return "cart";
  // One or two add buttons mean one product. A grid of products each has its own, so many means a listing.
  const addButtons = f.candidates.filter((c) => ADD.test(c.text)).length;
  return addButtons >= 1 && addButtons <= 2 ? "product" : "listing";
}

/** Page kinds that end the exploration: the audit has reached what it came for. */
export const GOAL_KINDS: readonly PageKind[] = ["checkout", "account_wall", "payment"];

/**
 * The next action chosen by rules alone. Returns null when no rule fits, so the caller
 * can fall back to the language model. Stopping decisions are always made here, never by the model.
 * Checkout, account and payment pages only count as the goal once something is in the cart.
 */
export function decide(kind: PageKind, f: PageFacts, state: { addedToCart: boolean; avoid?: ReadonlySet<string> }): Decision {
  const avoid = state.avoid ?? new Set<string>();
  // A control that couldn't be clicked on this page is skipped here, so the agent doesn't retry it forever.
  const failedHere = (c: Candidate) => avoid.has(failedKey(f.url, c));
  switch (kind) {
    case "payment":
      return state.addedToCart ? { stop: "Reached payment: a payment page or a payment provider's checkout overlay. Audits stop before payment." } : null;
    case "checkout":
      return state.addedToCart ? { stop: "Reached the checkout form (name, address). Audits stop before payment." } : null;
    case "account_wall": {
      if (!state.addedToCart) return null;
      const guest = f.candidates.find((c) => usable(c) && !failedHere(c) && GUEST.test(c.text));
      return guest
        ? { role: "guest", candidate: guest, why: "continue without creating an account" }
        : { stop: "Checkout requires an account and offers no guest option. Audits never sign up." };
    }
    case "cart": {
      const next = f.candidates.find((c) => usable(c) && !failedHere(c) && CHECKOUT.test(c.text) && !ADD.test(c.text));
      if (next) return { role: "checkout", candidate: next, why: "proceed to checkout" };
      if (f.cartRows === 0) return { stop: "The cart is empty: the item wasn't added (it may need a size or variant, or a login)." };
      return null;
    }
    case "product": {
      if (!state.addedToCart) {
        // Pick a size first, as a shopper would, or "add to cart" just asks for one.
        const picked = f.variantOptions.some((o) => avoid.has(variantKey(o)));
        const option = f.variantOptions.find((o) => !avoid.has(variantKey(o)));
        if (!picked && option) return { role: "variant", option, why: `choose size/variant "${option}" first` };
        const add = f.candidates.find((c) => usable(c) && !failedHere(c) && ADD.test(c.text));
        return add ? { role: "add", candidate: add, why: "add the product to the cart" } : null;
      }
      const cart = findCartControl(f, failedHere);
      return cart ? { role: "cart", candidate: cart, why: "open the cart" } : null;
    }
    case "listing": {
      // Once something has been added, a page with no add button is not a reason to browse on: go to the cart.
      if (state.addedToCart) {
        const cart = findCartControl(f, failedHere);
        if (cart) return { role: "cart", candidate: cart, why: "open the cart" };
      }
      const eligible = f.candidates.filter(
        (c) =>
          usable(c) && (c.kind === "link" || c.kind === "card") && c.hasPrice && !c.inNav && c.text.length >= 8 && !SPONSORED.test(c.text) &&
          !samePage(c, f) && !avoid.has(identity(c)) && !(c.href && LISTING_PATH.test(pathOf(c.href) ?? "")),
      );
      // A link whose URL looks like a product page beats one that merely sits next to a price.
      const product = eligible.find((c) => c.href && PRODUCT_PATH.test(pathOf(c.href) ?? "")) ?? eligible[0];
      if (product) return { role: "product", candidate: product, why: "open a product" };
      // No product in sight (a home page of banners): open a category, which is how shoppers find them.
      const category = findCategory(f, avoid);
      return category ? { role: "category", candidate: category, why: "no products shown, so open a category" } : null;
    }
  }
}

// URL shapes of a department page: /c/, /category/, /collections/, or /toys-and-gaming/5/0/0
const CATEGORY_PATH = /\/(c|cat|category|categories|collections?|shop|department|browse)\/|\/[a-z0-9-]+\/\d+\/\d+/i;
const NOT_A_CATEGORY = /log ?in|sign ?in|account|help|support|contact|track|store|app|download|cart|bag|wishlist|shortlist|offers?|deals?|sale|gift|blog|about|polic|terms|career|sell|all categories/i;

const GO_TO_CART = /^(go to|view|open) (my |your |the )?(shopping )?(cart|bag|basket)/i;

/**
 * The way to the cart: the "GO TO CART" button a shop offers right after an add comes first,
 * then the cart icon in the header. Either can be a link, a button or a plain labelled block.
 */
export function findCartControl(f: PageFacts, failedHere: (c: Candidate) => boolean = () => false): Candidate | null {
  const fits = f.candidates.filter((c) => usable(c) && !failedHere(c) && CART_LINK.test(c.text) && !ADD.test(c.text));
  return fits.find((c) => GO_TO_CART.test(c.text)) ?? fits.find((c) => c.kind === "link" || c.kind === "label") ?? null;
}

/** A department link, recognised by its URL shape: where to go when a page shows no products. */
export function findCategory(f: PageFacts, avoid: ReadonlySet<string> = new Set()): Candidate | null {
  const origin = new URL(f.url).origin;
  return (
    f.candidates.find(
      (c) =>
        usable(c) && c.kind === "link" && c.href !== null && c.text.length >= 3 && c.text.length <= 30 && !NOT_A_CATEGORY.test(c.text) &&
        new URL(c.href).origin === origin && CATEGORY_PATH.test(pathOf(c.href) ?? "") && !samePage(c, f) && !avoid.has(identity(c)),
    ) ?? null
  );
}

/** The headline deal on the page, if there is one: clicking it tests whether the advertised offer is real. */
export function findAdvertisedDeal(f: PageFacts): Candidate | null {
  return f.candidates.find((c) => usable(c) && c.kind === "link" && !c.inNav && c.hasPrice && PROMO.test(c.text) && !samePage(c, f)) ?? null;
}

/** Candidates worth showing the model: safe to click, with site chrome last. */
export function shortlist(f: PageFacts, avoid: ReadonlySet<string> = new Set(), limit = 30): Candidate[] {
  const ok = f.candidates.filter((c) => usable(c) && !avoid.has(identity(c)));
  return [...ok.filter((c) => !c.inNav), ...ok.filter((c) => c.inNav)].slice(0, limit);
}
