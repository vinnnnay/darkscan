import type { AuditRun, Step } from "@darkscan/schema";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { detectWithLlm } from "../index.ts";
import { confirmShaming, disguisedAds, falseUrgency, forcedAction, trickQuestion } from "./detectors.ts";
import type { Llm } from "./ollama.ts";

/** A stand-in model: answers from a lookup on the user prompt, and records every question. */
function fakeLlm(answer: (user: string) => unknown): Llm & { asked: string[] } {
  const asked: string[] = [];
  return {
    model: "fake",
    asked,
    async ask<T extends z.ZodType>(_system: string, user: string, schema: T) {
      asked.push(user);
      return schema.parse(answer(user));
    },
  };
}

function run(steps: Partial<Step>[]): AuditRun {
  return {
    id: "t",
    target: "https://shop.test/",
    startedAt: "2026-10-18T00:00:00.000Z",
    finishedAt: null,
    status: "completed",
    note: null,
    trace: null,
    steps: steps.map((s, index) => ({
      index,
      action: "goto /",
      url: "https://shop.test/",
      at: "2026-10-18T00:00:00.000Z",
      screenshot: "s.png",
      dom: "s.html",
      visibleText: "",
      price: null,
      cart: null,
      dialog: null,
      checkboxes: [],
      links: [],
      ...s,
    })),
  };
}

const popup = (title: string, decline: string) => ({ dialog: { text: title, buttons: [], dismissedWith: decline } });

describe("confirmShaming", () => {
  it("asks once per decline wording and cites every step it appeared on", async () => {
    const llm = fakeLlm((u) => ({ shaming: u.includes("I like overpaying"), reason: "Mocks the shopper." }));
    const findings = await confirmShaming(run([popup("Deals!", "I like overpaying"), {}, popup("Deals!", "I like overpaying"), popup("Cookies", "Reject")]), llm);
    expect(llm.asked).toHaveLength(2);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ pattern: "confirm_shaming", status: "likely", detector: "llm", evidenceSteps: [0, 2] });
  });
});

describe("trickQuestion", () => {
  it("is more confident when the confusing box is pre-ticked", async () => {
    const llm = fakeLlm(() => ({ confusing: true, reason: "Double negative." }));
    const [ticked] = await trickQuestion(run([{ checkboxes: [{ label: "Untick to not opt out", checked: true }] }]), llm);
    const [unticked] = await trickQuestion(run([{ checkboxes: [{ label: "Untick to not opt out", checked: false }] }]), llm);
    expect(ticked!.confidence).toBeGreaterThan(unticked!.confidence);
  });
});

describe("disguisedAds", () => {
  const card = (text: string, href: string) => ({ links: [{ text, href }] });

  it("ignores links that aren't ad-tracked, and ad links with an obvious label, without asking", async () => {
    const llm = fakeLlm(() => ({ disclosed: false, label: null }));
    const findings = await disguisedAds(
      run([card("Phone case ₹399", "https://shop.test/p/case/"), card("Sponsored Phone case ₹399", "https://shop.test/p/case/?sp_click=1")]),
      llm,
    );
    expect(findings).toEqual([]);
    expect(llm.asked).toEqual([]);
  });

  it("flags an ad-tracked card the model finds unlabelled", async () => {
    const llm = fakeLlm(() => ({ disclosed: false, label: null }));
    const findings = await disguisedAds(run([card("Phone case ₹399", "https://shop.test/p/case/?sp_click=home")]), llm);
    expect(findings[0]).toMatchObject({ pattern: "disguised_ads", status: "likely" });
  });
});

describe("forcedAction", () => {
  it("accepts a page where the model finds a guest option", async () => {
    const llm = fakeLlm(() => ({ accountRequired: true, guestOption: "Shop without signing up" }));
    expect(await forcedAction(run([{ cart: [] }, { visibleText: "Log in\nPassword\nShop without signing up" }]), llm)).toEqual([]);
  });
});

describe("falseUrgency", () => {
  it("compares the countdowns the model extracts before and after a reload", async () => {
    const llm = fakeLlm((u) => ({ countdowns: [{ label: "Price rises in", remaining: u.includes("04:55") ? "04:55" : "04:59" }] }));
    const findings = await falseUrgency(run([{ visibleText: "Price rises in 04:55" }, { action: "reload", visibleText: "Price rises in 04:59" }]), llm);
    expect(findings[0]).toMatchObject({ pattern: "false_urgency", evidenceSteps: [0, 1] });
  });
});

describe("detectWithLlm", () => {
  it("skips a second opinion when the rule already found the pattern", async () => {
    const llm = fakeLlm(() => ({ accountRequired: true, guestOption: null, countdowns: [] }));
    await detectWithLlm(run([{ cart: [] }, { visibleText: "Create an account to continue\nPassword" }]), llm);
    expect(llm.asked.some((q) => q.includes("Is an account required"))).toBe(false);
  });
});
