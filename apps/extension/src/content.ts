// Runs inside the page the person is looking at. It reads; it never clicks, fills or changes
// anything. Everything it reads is sent to the worker, which keeps the audit.
import { cartRowTexts, describeDialog, summaryText, visibleCheckboxes, visibleLinks } from "@darkscan/crawler/collect";
import type { Observation } from "./session.ts";

const DIALOGS = '[role="dialog"], [role="alertdialog"], [aria-modal="true"]';
const ADD_TO_CART = /\badd to (cart|bag|basket)\b|\badd to\b/i;

/** Set by a click on an add-to-cart control, and attached to the next observation. */
let pendingClaim: string | undefined;
let lastDialogText = "";

function base(action: string): Observation {
  return {
    url: location.href,
    action,
    visibleText: document.body?.innerText ?? "",
    summary: summaryText(),
    cartRows: cartRowTexts(),
    checkboxes: visibleCheckboxes(),
    links: visibleLinks(),
    dialog: null,
  };
}

function send(observation: Observation) {
  if (pendingClaim) {
    observation.claim = pendingClaim;
    pendingClaim = undefined;
  }
  // The worker may be asleep between navigations; a failed send must not break the page.
  void chrome.runtime.sendMessage({ type: "observe", observation }).catch(() => {});
}

/** A popup is worth a step of its own: its buttons are the evidence for interface interference. */
function reportDialog() {
  const open = [...document.querySelectorAll<HTMLElement>(DIALOGS)].filter((d) => d.getClientRects().length > 0);
  const top = open.at(-1);
  if (!top) {
    lastDialogText = "";
    return;
  }
  const text = top.innerText.trim();
  if (!text || text === lastDialogText) return;
  lastDialogText = text;
  send({ ...base("popup shown"), dialog: describeDialog(top) });
}

/** How the person got here, in the words the detectors expect ("reload" compares countdowns). */
function arrivalAction(): string {
  const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  return entry?.type === "reload" ? "reload" : "page loaded";
}

const settle = (fn: () => void, ms = 600) => setTimeout(fn, ms);

settle(() => {
  send(base(arrivalAction()));
  reportDialog();
});

// Popups usually arrive seconds after the page, and come back later in the visit.
new MutationObserver(() => settle(reportDialog, 250)).observe(document.documentElement, { childList: true, subtree: true });

// What the person puts in the cart themselves, so anything else in there was put there by the shop.
addEventListener(
  "click",
  (event) => {
    const control = (event.target as Element | null)?.closest<HTMLElement>("button, a, [role=button], input[type=submit]");
    if (!control) return;
    const label = (control.innerText || control.getAttribute("aria-label") || (control as HTMLInputElement).value || "").trim();
    if (ADD_TO_CART.test(label)) {
      const card = control.closest<HTMLElement>("li, article, [class*=card], [class*=product]");
      pendingClaim = (card?.querySelector("h1, h2, h3")?.textContent ?? document.querySelector("h1")?.textContent ?? "").trim() || undefined;
      settle(() => send(base("added to cart")), 1200);
    } else if (label) {
      // The link's own words carry the advertised price, which is what bait and switch compares.
      settle(() => send(base(`click ${label.replace(/\s+/g, " ").slice(0, 120)}`)), 1200);
    }
  },
  true,
);

// Shopping sites route in the page: without this, everything after the first view is missed.
let lastUrl = location.href;
setInterval(() => {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  settle(() => send(base("page loaded")));
}, 1000);
