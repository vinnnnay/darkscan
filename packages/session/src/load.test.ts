import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditRun, Step } from "@darkscan/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LIMITS, exportBundle, loadRun } from "./load.ts";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "darkscan-test-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const step = (index: number, extra: Partial<Step> = {}): Step => ({
  index,
  action: "goto /",
  url: "https://shop.test/",
  at: "2026-10-18T00:00:00.000Z",
  screenshot: `step-${String(index).padStart(3, "0")}.png`,
  dom: `step-${String(index).padStart(3, "0")}.html`,
  visibleText: "Hello",
  price: null,
  cart: null,
  dialog: null,
  checkboxes: [],
  links: [],
  ...extra,
});

const run = (steps: Step[], extra: Partial<AuditRun> = {}): AuditRun => ({
  id: "r1",
  target: "https://shop.test",
  startedAt: "2026-10-18T00:00:00.000Z",
  finishedAt: "2026-10-18T00:01:00.000Z",
  status: "completed",
  note: null,
  trace: null,
  steps,
  ...extra,
});

async function folder(name: string, data: unknown, png = true): Promise<string> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "run.json"), typeof data === "string" ? data : JSON.stringify(data));
  if (png) await writeFile(join(dir, "step-000.png"), "png-bytes");
  return dir;
}

describe("loadRun", () => {
  it("loads a valid run", async () => {
    const dir = await folder("ok", run([step(0)]));
    expect((await loadRun(dir)).steps).toHaveLength(1);
  });

  it("says plainly when there is no run.json", async () => {
    await expect(loadRun(join(root, "nothing"))).rejects.toThrow(/no run\.json/i);
  });

  it("rejects text that is not JSON", async () => {
    await expect(loadRun(await folder("bad", "{not json"))).rejects.toThrow(/not valid JSON/);
  });

  it("rejects JSON that is not a DarkScan run, naming the field", async () => {
    await expect(loadRun(await folder("wrong", { id: "x", steps: "nope" }))).rejects.toThrow(/not a DarkScan run/);
  });

  it("rejects a run with too many steps", async () => {
    const steps = Array.from({ length: LIMITS.steps + 1 }, (_, i) => step(i, { screenshot: "", dom: "" }));
    await expect(loadRun(await folder("big", run(steps), false))).rejects.toThrow(/over the limit/);
  });
});

describe("exportBundle", () => {
  const sensitive = run(
    [
      step(0, {
        action: "click Deliver to Asha Verma",
        visibleText: "Asha Verma, 12 MG Road. Mobile 9876543210. asha@example.com",
        url: "https://shop.test/address?name=Asha%20Verma",
        cart: [{ name: "Gift for Asha Verma", qty: 1, unitPaise: 10000, addedByAgent: true }],
        dialog: { text: "Hi Asha Verma", buttons: [{ text: "Asha Verma only", widthPx: 1, heightPx: 1, fontSizePx: 1, color: "c", background: "b" }], dismissedWith: "Asha Verma only" },
        price: { lines: [{ label: "For Asha Verma", amountPaise: 100, kind: "item" }], totalPaise: 100, source: "dom" },
        checkboxes: [{ label: "Ship to Asha Verma", checked: true }],
        links: [{ text: "Asha Verma's orders", href: "https://shop.test/o?u=asha@example.com" }],
      }),
    ],
    { note: "Asha Verma stopped here", trace: "trace.zip" },
  );

  it("masks every piece of text again, with the extra words, and drops pages and the trace", async () => {
    const src = await folder("src", sensitive);
    const out = join(root, "out");
    await exportBundle(src, out, { terms: ["Asha Verma", "12 MG Road"] });
    const text = await readFile(join(out, "run.json"), "utf8");
    for (const leak of ["Asha Verma", "12 MG Road", "9876543210", "asha@example.com"]) expect(text, leak).not.toContain(leak);
    const exported = await loadRun(out);
    expect(exported.steps[0]!.dom).toBe("");
    expect(exported.trace).toBeNull();
    expect(exported.steps[0]!.dialog!.dismissedWith).toBe("[redacted] only");
  });

  it("leaves screenshots out unless asked, and never copies an unsafe file name", async () => {
    const src = await folder("src2", run([step(0), step(1, { screenshot: "../../outside.png" })]));
    await writeFile(join(src, "step-001.png"), "x");

    const without = join(root, "without");
    expect(await exportBundle(src, without)).toEqual({ steps: 2, screenshots: 0 });
    expect(await readdir(without)).toEqual(["run.json"]);

    const withShots = join(root, "with");
    expect(await exportBundle(src, withShots, { screenshots: true })).toEqual({ steps: 2, screenshots: 1 });
    expect((await readdir(withShots)).sort()).toEqual(["run.json", "step-000.png"]);
    expect((await loadRun(withShots)).steps[1]!.screenshot).toBe("");
  });
});
