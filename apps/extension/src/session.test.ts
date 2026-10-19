import { describe, expect, it } from "vitest";
import type { ButtonStyle } from "@darkscan/schema";
import { addObservation, badgeFor, newSession, runRules, toRun, type Observation, type Session } from "./session.ts";

const AT = "2026-10-19T00:00:00.000Z";
const blank: Observation = { url: "https://shop.test/", action: "page loaded", visibleText: "", summary: "", cartRows: [], checkboxes: [], links: [], dialog: null };
const see = (session: Session, o: Partial<Observation>) => addObservation(session, { ...blank, ...o }, AT);
const start = () => newSession("https://shop.test", AT);

const button = (text: string, w: number, h: number, over: Partial<ButtonStyle> = {}): ButtonStyle => ({
  text, widthPx: w, heightPx: h, fontSizePx: 16, color: "rgb(0,0,0)", background: "rgb(255,255,255)", ...over,
});

describe("addObservation", () => {
  it("keeps no screenshot and no page HTML, only what the rules read", () => {
    const s = see(start(), { visibleText: "Earbuds ₹1,299" });
    expect(s.steps[0]).toMatchObject({ screenshot: "", dom: "", visibleText: "Earbuds ₹1,299" });
  });

  it("ignores a repeat of the same page, which single-page sites emit constantly", () => {
    let s = see(start(), { visibleText: "same" });
    s = see(s, { visibleText: "same" });
    expect(s.steps).toHaveLength(1);
    s = see(s, { visibleText: "different" });
    expect(s.steps).toHaveLength(2);
  });

  it("numbers steps in order, because findings cite them as evidence", () => {
    let s = see(start(), { visibleText: "a" });
    s = see(s, { visibleText: "b" });
    expect(s.steps.map((x) => x.index)).toEqual([0, 1]);
  });

  it("remembers what the person added, so an item they did not add stands out", () => {
    let s = see(start(), { visibleText: "product", claim: "Earbuds Pro" });
    s = see(s, { url: "https://shop.test/cart", visibleText: "cart", cartRows: ["Earbuds Pro × 1 ₹1,299", "Purchase Protection × 1 ₹99"] });
    const cart = s.steps.at(-1)!.cart!;
    expect(cart.find((c) => c.name.includes("Earbuds"))!.addedByAgent).toBe(true);
    expect(cart.find((c) => c.name.includes("Protection"))!.addedByAgent).toBe(false);
  });

  it("marks the button a cautious shopper would press, without pressing anything", () => {
    const s = see(start(), { dialog: { text: "Get 10% off", buttons: [button("Subscribe", 300, 50), button("No thanks", 60, 12)] } });
    expect(s.steps[0]!.dialog!.dismissedWith).toBe("No thanks");
  });

  it("caps a long visit instead of growing without bound", () => {
    let s = start();
    for (let i = 0; i < 320; i++) s = see(s, { visibleText: `page ${i}` });
    expect(s.steps).toHaveLength(300);
    expect(s.steps.at(-1)!.visibleText).toBe("page 319");
  });
});

describe("runRules on a visit", () => {
  it("finds a fee that only appears at checkout", () => {
    let s = see(start(), { url: "https://shop.test/cart", visibleText: "cart", summary: "Earbuds ₹1,299\nDelivery ₹40\nTotal ₹1,339" });
    s = see(s, { url: "https://shop.test/checkout", visibleText: "checkout", summary: "Earbuds ₹1,299\nDelivery ₹40\nPlatform fee ₹49\nTotal ₹1,388" });
    const drip = runRules(toRun(s)).find((f) => f.pattern === "drip_pricing");
    expect(drip?.status).toBe("likely");
    expect(drip?.explanation).toContain("Platform fee");
  });

  it("finds an item in the cart that the person never added", () => {
    // The rule only commits to "likely" once the summary confirms the item is actually charged.
    const s = see(start(), { url: "https://shop.test/cart", visibleText: "cart", cartRows: ["Purchase Protection × 1 ₹99"], summary: "Purchase Protection ₹99\nDelivery ₹40\nTotal ₹139" });
    expect(runRules(toRun(s)).find((f) => f.pattern === "basket_sneaking")?.status).toBe("likely");
  });

  it("finds a countdown that goes back up after the person reloads", () => {
    let s = see(start(), { url: "https://shop.test/p/1", visibleText: "Deal ends in 09:58" });
    s = see(s, { url: "https://shop.test/p/1", action: "reload", visibleText: "Deal ends in 09:59" });
    expect(runRules(toRun(s)).find((f) => f.pattern === "false_urgency")?.status).toBe("likely");
  });

  it("finds a popup that keeps coming back", () => {
    let s = start();
    for (let i = 0; i < 3; i++) {
      s = see(s, { visibleText: `browse ${i}` });
      s = see(s, { action: "popup shown", visibleText: `popup ${i}`, dialog: { text: "Get 10% off", buttons: [button("Subscribe", 300, 50), button("No", 60, 12)] } });
    }
    expect(runRules(toRun(s)).find((f) => f.pattern === "nagging")?.status).toBe("likely");
  });

  it("finds a decline hidden by size and contrast", () => {
    const s = see(start(), {
      dialog: {
        text: "Protect your purchase?",
        buttons: [button("Add protection", 300, 56), button("No thanks", 50, 10, { fontSizePx: 10, color: "rgb(220,220,220)" })],
      },
    });
    expect(runRules(toRun(s)).find((f) => f.pattern === "interface_interference")?.status).toBe("likely");
  });

  it("stays quiet on an honest shop", () => {
    let s = see(start(), { url: "https://shop.test/cart", visibleText: "cart", summary: "Earbuds ₹1,299\nDelivery ₹40\nTotal ₹1,339", cartRows: ["Earbuds × 1 ₹1,299"], claim: "Earbuds" });
    s = see(s, { url: "https://shop.test/checkout", visibleText: "checkout", summary: "Earbuds ₹1,299\nDelivery ₹40\nTotal ₹1,339" });
    expect(runRules(toRun(s)).filter((f) => f.status === "likely")).toEqual([]);
  });
});

describe("badgeFor", () => {
  it("counts only what a person should look at, and shows nothing when there is nothing", () => {
    const findings = runRules(toRun(see(start(), { url: "https://shop.test/cart", visibleText: "c", cartRows: ["Purchase Protection × 1 ₹99"], summary: "Purchase Protection ₹99\nDelivery ₹40\nTotal ₹139" })));
    expect(badgeFor(findings)).toBe("1");
    expect(badgeFor([])).toBe("");
    expect(badgeFor(findings.map((f) => ({ ...f, status: "review" as const })))).toBe("");
  });
});
