import { afterEach, describe, expect, it } from "vitest";
import { detectBlock, detectRefusal } from "./block.ts";
import { chromiumArgs } from "./crawl.ts";
import { RobotsPolicy, isAllowed, parseRobots } from "./robots.ts";

describe("parseRobots / isAllowed", () => {
  const robots = `
    User-agent: *
    Disallow: /checkout
    Disallow: /search?
    Allow: /checkout/help
    Disallow: /*.json$

    User-agent: GoogleBot
    Disallow: /
  `;
  const rules = parseRobots(robots);

  it("blocks disallowed paths and allows the rest", () => {
    expect(isAllowed(rules, "/checkout/cart")).toBe(false);
    expect(isAllowed(rules, "/products/cable")).toBe(true);
    expect(isAllowed(rules, "/search?q=cable")).toBe(false);
  });

  it("lets the longest matching rule win, so a specific Allow beats a broad Disallow", () => {
    expect(isAllowed(rules, "/checkout/help")).toBe(true);
  });

  it("supports * and $ in patterns", () => {
    expect(isAllowed(rules, "/data/items.json")).toBe(false);
    expect(isAllowed(rules, "/data/items.json5")).toBe(true);
  });

  it("ignores groups meant for other crawlers", () => {
    expect(isAllowed(rules, "/")).toBe(true);
  });

  it("prefers a group that names DarkScan over the * group", () => {
    const own = parseRobots("User-agent: *\nDisallow:\n\nUser-agent: DarkScan\nDisallow: /private");
    expect(isAllowed(own, "/private/x")).toBe(false);
    expect(isAllowed(own, "/public")).toBe(true);
  });

  it("treats an empty Disallow as allow-all", () => {
    expect(isAllowed(parseRobots("User-agent: *\nDisallow:"), "/anything")).toBe(true);
  });

  it("shares rules between stacked User-agent lines", () => {
    const shared = parseRobots("User-agent: a\nUser-agent: *\nDisallow: /x");
    expect(isAllowed(shared, "/x")).toBe(false);
  });
});

describe("detectRefusal", () => {
  it("recognises a dropped connection as bot protection", () => {
    expect(detectRefusal("page.goto: net::ERR_HTTP2_PROTOCOL_ERROR at https://shop.test/")).toMatch(/ERR_HTTP2_PROTOCOL_ERROR.*bot protection/);
    expect(detectRefusal("net::ERR_CONNECTION_RESET")).toMatch(/ERR_CONNECTION_RESET/);
  });

  it("leaves ordinary failures alone, so real bugs still surface", () => {
    expect(detectRefusal("net::ERR_NAME_NOT_RESOLVED at https://typo.test/")).toBeNull();
    expect(detectRefusal("Timeout 30000ms exceeded")).toBeNull();
  });
});

describe("detectBlock", () => {
  it("flags rate limiting and refusals by status", () => {
    expect(detectBlock(429, "")).toMatch(/rate limiting/);
    expect(detectBlock(403, "")).toMatch(/refused/);
  });

  it("flags a short bot-check page", () => {
    expect(detectBlock(200, "Please verify you are a human\nCAPTCHA")).toMatch(/bot check/);
    expect(detectBlock(200, "Sorry! Something went wrong. Are you a robot?")).toMatch(/bot check/);
  });

  it("ignores long normal pages that merely mention the words", () => {
    expect(detectBlock(200, "Our site is protected by CAPTCHA. ".repeat(100))).toBeNull();
  });

  it("accepts an ordinary page", () => {
    expect(detectBlock(200, "Earbuds Pro ₹1,299\nAdd to cart")).toBeNull();
  });
});

describe("RobotsPolicy", () => {
  const policy = (status: "ok" | "none" | "unreachable", text = "") => new RobotsPolicy(async () => ({ status, text }));

  it("separates a site that disallows us from one whose robots.txt we could not read", async () => {
    const rules = "User-agent: *\nDisallow: /cart\n";
    expect(await policy("ok", rules).check("https://s.test/cart")).toEqual({ allowed: false, why: "disallowed" });
    expect(await policy("ok", rules).check("https://s.test/shoes")).toEqual({ allowed: true });
    expect(await policy("unreachable").check("https://s.test/cart")).toEqual({ allowed: false, why: "unreadable" });
  });

  it("allows everything when the host has no robots.txt", async () => {
    expect(await policy("none").check("https://s.test/cart")).toEqual({ allowed: true });
  });

  it("asks each origin once, however many URLs are checked", async () => {
    const origins: string[] = [];
    const p = new RobotsPolicy(async (origin) => (origins.push(origin), { status: "none", text: "" }));
    await p.check("https://s.test/a");
    await p.check("https://s.test/b");
    await p.check("https://checkout.s.test/c");
    expect(origins).toEqual(["https://s.test", "https://checkout.s.test"]);
  });
});

describe("RobotsPolicy caching", () => {
  it("parses a robots.txt once per origin, however many URLs it then checks", async () => {
    let parses = 0;
    // check() touches .text only when it has to parse, so counting reads counts parses.
    const doc = {
      status: "ok" as const,
      get text() {
        parses++;
        return "User-agent: *\nDisallow: /cart\n";
      },
    };
    const policy = new RobotsPolicy(async () => doc);

    expect(await policy.check("https://s.test/cart")).toEqual({ allowed: false, why: "disallowed" });
    expect(await policy.check("https://s.test/shoes")).toEqual({ allowed: true });
    expect(parses).toBe(1);
  });
});

describe("chromiumArgs", () => {
  const set = (value: string | undefined) => {
    if (value === undefined) delete process.env.DARKSCAN_CHROMIUM_NO_SANDBOX;
    else process.env.DARKSCAN_CHROMIUM_NO_SANDBOX = value;
  };
  const original = process.env.DARKSCAN_CHROMIUM_NO_SANDBOX;
  afterEach(() => set(original));

  it("keeps Chromium's sandbox on unless the container explicitly asks otherwise", () => {
    set(undefined);
    expect(chromiumArgs()).toEqual([]);
    set("0");
    expect(chromiumArgs()).toEqual([]);
    set("true");
    expect(chromiumArgs()).toEqual([]);
  });

  it("drops the sandbox only for the exact opt-in the image sets", () => {
    set("1");
    expect(chromiumArgs()).toEqual(["--no-sandbox"]);
  });
});
