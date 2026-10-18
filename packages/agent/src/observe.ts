// Runs inside the browser via page.evaluate(), so it must be self-contained: no imports,
// no references to anything outside its own body.

export type Candidate = {
  id: number;
  /**
   * A "card" is a product block that is clickable without being a link, and a "label" is a
   * checkout-flow control that isn't a real button (a div that says "ADD TO CART").
   */
  kind: "link" | "button" | "card" | "label";
  text: string;
  /** Absolute URL for links. */
  href: string | null;
  /** The control, or the card around it, shows a rupee price. */
  hasPrice: boolean;
  disabled: boolean;
  /** Inside a header, nav or footer, so probably site chrome rather than page content. */
  inNav: boolean;
};

export type PageFacts = {
  url: string;
  title: string;
  heading: string;
  text: string;
  candidates: Candidate[];
  /** Remove/Delete controls: a proxy for "this page lists cart items". */
  cartRows: number;
  hasPasswordField: boolean;
  /** A payment provider's checkout (Razorpay and the like) is open on top of the page. */
  paymentOverlay: boolean;
  /** Visible fields that ask for a name, address, PIN code, phone and the like. A search box is not one. */
  formFields: number;
  /** Size or variant choices on a product page, in page order, with sold-out ones left out. */
  variantOptions: string[];
};

export function observePage(): PageFacts {
  // A rupee amount. Some shops draw the ₹ with CSS, so the text is just "988.01": a number with two decimals counts too.
  const PRICE = /₹|\brs\.?\s*\d|\binr\s*\d|\b\d{1,3}(?:,\d{3})*\.\d{2}\b/i;
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const visible = (el: Element) => (el as HTMLElement).getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const dialogs = '[role="dialog"], [aria-modal="true"]';
  const chrome = "header, nav, footer, [role=navigation]";

  const candidates: PageFacts["candidates"] = [];
  let cartRows = 0;
  const controls = document.querySelectorAll<HTMLElement>("a[href], button, [role=button], input[type=submit], input[type=button]");
  for (const el of controls) {
    if (!visible(el) || el.closest(dialogs)) continue;
    const text = norm(el.innerText || el.getAttribute("aria-label") || (el as HTMLInputElement).value || el.title || "").slice(0, 160);
    if (!text) continue;
    // "Remove" on a cart row, but not "Remove all filters" on a search page.
    if (/^(remove|delete)( item| product| from (cart|bag|basket))?$/i.test(text)) cartRows++;
    if (candidates.length >= 150) continue;

    let hasPrice = PRICE.test(text);
    let card = el.parentElement;
    for (let depth = 0; !hasPrice && card && depth < 3; depth++, card = card.parentElement) {
      if (card.innerText.length < 500 && PRICE.test(card.innerText)) hasPrice = true;
    }
    const isLink = el.tagName === "A";
    candidates.push({
      id: candidates.length,
      kind: isLink ? "link" : "button",
      text,
      href: isLink ? (el as HTMLAnchorElement).href : null,
      hasPrice,
      disabled: (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true",
      inNav: el.closest(chrome) !== null,
    });
  }

  // Controls that are not buttons or links: a <div> that says "ADD TO CART" and has a click handler.
  // Only the checkout-flow vocabulary is recognised this way, so it can't flood the list.
  const FLOW_LABEL = /^(add to (cart|bag|basket|trolley)|go to (cart|bag)|view (cart|bag)|my (cart|bag)|proceed to checkout|checkout|secure checkout|continue as guest|checkout as guest|buy now|place order)$/i;
  for (const el of document.querySelectorAll<HTMLElement>("div, span, p, li")) {
    if (candidates.length >= 150) break;
    if ((el.textContent ?? "").length > 40 || el.closest("a[href], button, [role=button]") || !visible(el) || el.closest(dialogs)) continue;
    const text = norm(el.innerText ?? "");
    if (!FLOW_LABEL.test(text)) continue;
    // The smallest block that carries the label: <div><i></i>ADD TO CART</div>, but not the <div> around <span>ADD TO CART</span>.
    if ([...el.children].some((child) => norm((child as HTMLElement).innerText ?? "") === text)) continue;
    candidates.push({
      id: candidates.length,
      kind: "label",
      text,
      href: null,
      hasPrice: false,
      disabled: el.getAttribute("aria-disabled") === "true",
      inNav: el.closest(chrome) !== null,
    });
  }

  // Product cards that aren't links: the smallest block holding an image, a title and a price.
  // Many shops navigate from these with JavaScript, so there is no <a href> to find.
  const holdsProduct = (el: Element) =>
    (el as HTMLElement).innerText.length >= 15 && PRICE.test((el as HTMLElement).innerText) && el.querySelector("img") !== null;
  let cards = 0;
  for (const el of document.querySelectorAll<HTMLElement>("li, article, div")) {
    if (cards >= 40) break;
    const t = el.innerText;
    if (!t || t.length > 300 || !holdsProduct(el) || !visible(el) || el.closest(dialogs) || el.closest(chrome)) continue;
    if ([...el.children].some(holdsProduct)) continue; // a wrapper around several cards
    const lines = t.split("\n").map(norm).filter(Boolean);
    const title = lines.filter((l) => !PRICE.test(l) && l.length >= 8).sort((a, b) => b.length - a.length)[0];
    if (!title) continue;
    const price = lines.find((l) => PRICE.test(l)) ?? "";
    const anchor = el.closest("a[href]") ?? el.querySelector("a[href]");
    candidates.push({
      id: candidates.length,
      kind: "card",
      text: norm(`${title.slice(0, 100)} ${price}`),
      href: anchor ? (anchor as HTMLAnchorElement).href : null,
      hasPrice: true,
      disabled: false,
      inNav: false,
    });
    cards++;
  }

  // Fields that belong to an address form, recognised by what they ask for.
  const ADDRESS = /address|pin ?code|postal|zip|city|state|full ?name|first ?name|last ?name|mobile|phone|landmark|flat|house|locality/i;
  const formFields = [...document.querySelectorAll<HTMLInputElement>("input, textarea, select")].filter((f) => {
    if (!visible(f) || ["hidden", "checkbox", "radio", "password", "submit", "button", "email"].includes(f.type)) return false;
    const label = f.labels?.[0]?.innerText ?? "";
    // "Enter your email address" is a newsletter box, not a postal address.
    const asks = [f.placeholder, f.getAttribute("aria-label"), f.name, f.id, f.autocomplete, label].filter(Boolean).join(" ").replace(/e-?mail( address)?/gi, " ");
    return ADDRESS.test(asks);
  }).length;

  // Size/variant choices: short size-like labels sitting near the word "size". Sold-out ones are skipped.
  const SIZE = /^(xxs|xs|s|m|l|xl|xxl|xxxl|[2-5]xl|\d{1,2}(\.5)?|free ?size|one ?size)$/i;
  const variantOptions: string[] = [];
  for (const el of document.querySelectorAll<HTMLElement>("button, a, li, span, div, label, [role=radio], [role=option]")) {
    if (variantOptions.length >= 12) break;
    const text = norm(el.innerText ?? "");
    if (!SIZE.test(text) || el.children.length > 0 || !visible(el) || el.closest(chrome) || el.closest(dialogs)) continue;
    let nearSize = false;
    for (let up: HTMLElement | null = el.parentElement, depth = 0; up && depth < 4; up = up.parentElement, depth++) {
      if (up.innerText.length < 400 && /\bsize\b/i.test(up.innerText)) nearSize = true;
    }
    if (!nearSize || variantOptions.includes(text)) continue;
    const style = getComputedStyle(el);
    const dead =
      el.closest('[class*="disabled" i], [class*="soldout" i], [class*="sold-out" i], [class*="unavailable" i], [aria-disabled="true"]') !== null ||
      style.pointerEvents === "none" ||
      parseFloat(style.opacity) < 0.6;
    if (!dead) variantOptions.push(text);
  }

  // Many shops hand checkout to a payment provider's overlay. It isn't a dialog, but it blocks every click.
  const providers =
    '.razorpay-container, iframe[src*="razorpay"], iframe[name^="razorpay"], iframe[src*="paytm"], iframe[src*="phonepe"], iframe[src*="cashfree"], iframe[src*="juspay"], iframe[src*="stripe.com"]';
  const paymentOverlay = [...document.querySelectorAll(providers)].some((el) => {
    const box = el.getBoundingClientRect();
    return visible(el) && box.width >= 100 && box.height >= 100;
  });

  // Choices under a "Select Size / Colour / Pack" label can say anything: "Single", "500 g", "Queen".
  const VARIANT_LABEL = /^(select |choose )?(size|variant|colou?r|pack( size)?|quantity|capacity|storage|flavou?r)\s*:?$/i;
  const NOT_AN_OPTION = /chart|guide|help|more|select|offer|size|colou?r|compare|view|know/i;
  for (const label of document.querySelectorAll<HTMLElement>("div, span, p, label, h3, h4, strong")) {
    if (variantOptions.length >= 12) break;
    if (label.children.length > 0 || !VARIANT_LABEL.test(norm(label.innerText ?? "")) || !visible(label) || label.closest(chrome) || label.closest(dialogs)) continue;
    // Look in the smallest block around the label that holds some options, so the offers further down are left out.
    for (let scope = label.parentElement, depth = 0; scope && depth < 3 && scope.innerText.length < 400; scope = scope.parentElement, depth++) {
      const found: string[] = [];
      for (const el of scope.querySelectorAll<HTMLElement>("*")) {
        const text = norm(el.innerText ?? "");
        if (el === label || el.children.length > 0 || !visible(el) || text.length < 1 || text.length > 24 || NOT_AN_OPTION.test(text)) continue;
        const style = getComputedStyle(el);
        const dead =
          el.closest('[class*="disabled" i], [class*="soldout" i], [class*="sold-out" i], [class*="unavailable" i], [aria-disabled="true"]') !== null ||
          style.pointerEvents === "none" ||
          parseFloat(style.opacity) < 0.6;
        if (!dead && !found.includes(text)) found.push(text);
      }
      if (found.length > 0) {
        for (const text of found.slice(0, 8)) if (!variantOptions.includes(text)) variantOptions.push(text);
        break;
      }
    }
  }

  return {
    url: location.href,
    title: document.title,
    heading: norm(document.querySelector("h1")?.textContent ?? ""),
    text: document.body.innerText.slice(0, 4000),
    candidates,
    cartRows,
    hasPasswordField: [...document.querySelectorAll("input[type=password]")].some(visible),
    paymentOverlay,
    formFields,
    variantOptions,
  };
}
