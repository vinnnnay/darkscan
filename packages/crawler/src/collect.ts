// Functions passed to page.evaluate(). They run inside the browser, so each one must be
// self-contained: no imports and no references to anything outside its own body.

import type { ButtonStyle } from "@darkscan/schema";

/**
 * Visible text of the order summary: the smallest element that holds a "Total ₹…" line
 * and at least one other rupee amount. Empty if the page has no summary.
 */
export function summaryText(): string {
  const totalLine = /(^|\n)[^\S\n]*(grand\s+|order\s+)?total\b[^\n]*(₹|rs\.?|inr)/i;
  let best = "";
  for (const el of document.body.querySelectorAll<HTMLElement>("*")) {
    const text = el.innerText;
    if (!text || !totalLine.test(text)) continue;
    if ((text.match(/₹|rs\.?\s*\d|inr\s*\d/gi) ?? []).length < 2) continue;
    if (!best || text.length < best.length) best = text;
  }
  return best;
}

/** Text of each cart row, found by its Remove/Delete control, minus the control's own label. */
export function cartRowTexts(): string[] {
  const rows: string[] = [];
  for (const control of document.querySelectorAll<HTMLElement>("button, a, [role=button]")) {
    const label = (control.innerText || control.getAttribute("aria-label") || "").trim();
    if (!/^(remove|delete)( item| product| from (cart|bag|basket))?$/i.test(label)) continue;
    let row = control.parentElement;
    while (row && row.innerText.trim() === label) row = row.parentElement;
    if (row) rows.push(row.innerText.replace(label, "").trim());
  }
  return rows;
}

export function visibleCheckboxes(): { label: string; checked: boolean }[] {
  return [...document.querySelectorAll<HTMLInputElement>("input[type=checkbox]")]
    .filter((box) => box.getClientRects().length > 0)
    .map((box) => ({
      label: (box.closest("label")?.innerText ?? box.labels?.[0]?.innerText ?? box.getAttribute("aria-label") ?? "").trim(),
      checked: box.checked,
    }));
}

/** Visible links with their resolved URLs, capped so huge pages don't bloat the run. */
export function visibleLinks(): { text: string; href: string }[] {
  return [...document.querySelectorAll<HTMLAnchorElement>("a[href]")]
    .filter((a) => a.getClientRects().length > 0)
    .slice(0, 300)
    .map((a) => ({ text: a.innerText.replace(/\s+/g, " ").trim().slice(0, 200), href: a.href }));
}

const HIDE_STYLE_ID = "__darkscan_hide_typed_values";

/**
 * Makes whatever a person has typed into a field invisible, for the moment a screenshot is taken.
 * Labels, placeholders, buttons and checkboxes stay visible; only typed text and chosen options go.
 * Undone by showTypedValues(), so the person never loses sight of what they are typing.
 */
export function hideTypedValues(): void {
  if (document.getElementById("__darkscan_hide_typed_values")) return;
  const style = document.createElement("style");
  style.id = "__darkscan_hide_typed_values";
  style.textContent =
    "input:not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=image]):not([type=range]), textarea, select " +
    "{ color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }";
  document.documentElement.appendChild(style);
}

export function showTypedValues(): void {
  document.getElementById("__darkscan_hide_typed_values")?.remove();
}

/**
 * The page as saved for a recorded session: no scripts (they may hold tokens), no frames, and no
 * values typed into fields. Works on a copy, so the page the person is using is untouched.
 */
export function sanitizedHtml(): string {
  const copy = document.documentElement.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("script, noscript, iframe, object, embed").forEach((node) => node.remove());
  copy.querySelectorAll("input, textarea, select").forEach((field) => {
    field.removeAttribute("value");
    if (field.tagName === "TEXTAREA") field.textContent = "";
    field.querySelectorAll("option[selected]").forEach((option) => option.removeAttribute("selected"));
  });
  return "<!doctype html>" + copy.outerHTML;
}

/** The text of the popup currently open, or null. Used to notice when one appears. */
export function openDialogText(): string | null {
  const visible = [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], [aria-modal="true"]')].filter(
    (d) => d.getClientRects().length > 0,
  );
  const last = visible.at(-1);
  return last ? last.innerText.trim() : null;
}

export function describeDialog(dialog: Element): { text: string; buttons: ButtonStyle[] } {
  // The colour actually behind the button: its own background, or the nearest opaque ancestor's.
  const effectiveBackground = (el: Element | null): string => {
    for (; el; el = el.parentElement) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg !== "transparent" && !/rgba\(.*,\s*0\)$/.test(bg)) return bg;
    }
    return "rgb(255, 255, 255)";
  };
  const buttons = [...dialog.querySelectorAll<HTMLElement>("button, a[href], [role=button]")].map((b) => {
    const rect = b.getBoundingClientRect();
    const style = getComputedStyle(b);
    return {
      text: (b.innerText || b.getAttribute("aria-label") || "").trim(),
      widthPx: Math.round(rect.width),
      heightPx: Math.round(rect.height),
      fontSizePx: parseFloat(style.fontSize),
      color: style.color,
      background: effectiveBackground(b),
      link: b.tagName === "A",
    };
  });
  return { text: (dialog as HTMLElement).innerText.trim(), buttons };
}
