import { expect, test } from "@playwright/test";
import { auditWithRepair, learnRecipe, targetFor } from "../packages/agent/src/index.ts";
import { observePage } from "../packages/agent/src/observe.ts";
import { classifyPage } from "../packages/agent/src/policy.ts";
import { recipeFromJson, recipeToJson, runAudit, type Recipe } from "../packages/crawler/src/index.ts";

const BASE = "http://localhost:4173";
test.setTimeout(180_000);
// The crawler records its own trace; the runner tracing the same contexts would collide with it.
test.use({ trace: "off" });

test("the agent finds checkout on its own, and the recipe it writes survives a JSON round trip and replays", async ({}, info) => {
  const learned = await learnRecipe("agent-v0", `${BASE}/?v=0`, { outDir: info.outputPath() });
  expect(learned.exploration.reachedGoal).toBe(true);
  expect(learned.exploration.modelCalls).toBe(0);
  expect(learned.run.steps.at(-1)!.url).toContain("/checkout/");

  const saved = recipeFromJson(recipeToJson(learned.recipe));
  expect(saved).toEqual(learned.recipe);
  const replay = await runAudit(saved, { outDir: info.outputPath() });
  expect(replay.status).toBe("completed");
  expect(replay.steps.at(-1)!.url).toContain("/checkout/");
});

test("when the site changes, the agent repairs the recipe from the broken step", async ({}, info) => {
  const { recipe } = await learnRecipe("agent-repair", `${BASE}/?v=0`, { outDir: info.outputPath() });

  // Simulate a redesign: the add-to-cart button is now called something else.
  const broken: Recipe = {
    ...recipe,
    steps: recipe.steps.map((s) => (s.do === "click" && "name" in s.target && s.target.name === "Add to cart" ? { ...s, target: { role: "button" as const, name: "Add to basket" } } : s)),
  };
  expect(JSON.stringify(broken)).toContain("Add to basket");

  const result = await auditWithRepair(broken, { outDir: info.outputPath() });
  expect(result.repaired).toBe(true);
  expect(result.exploration?.reachedGoal).toBe(true);
  expect(result.run.note).toMatch(/Recipe repaired from step \d+/);
  expect(result.run.steps.at(-1)!.url).toContain("/checkout/");
  expect(JSON.stringify(result.recipe)).not.toContain("Add to basket");
});

test("an unbroken recipe is replayed as written, with no repair", async ({}, info) => {
  const { recipe } = await learnRecipe("agent-norepair", `${BASE}/?v=0`, { outDir: info.outputPath() });
  const result = await auditWithRepair(recipe, { outDir: info.outputPath() });
  expect(result.repaired).toBe(false);
  expect(result.exploration).toBeNull();
});

test.describe("the observer on pages built like real shops", () => {
  const PIXEL = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

  test("sees clickable product cards that are not links, and ignores sold-out sizes", async ({ page }) => {
    await page.setContent(`
      <header><input type="text" placeholder="Search products and brands"></header>
      <div id="grid">
        <div onclick="location.hash='a'"><img src="${PIXEL}"><div>Life Like A10 PRO 2 Bluetooth Earbuds</div><div>₹269</div></div>
        <div onclick="location.hash='b'"><img src="${PIXEL}"><div>Altek 14322 Black Men's Thong Flip Flop</div><div>₹186</div></div>
      </div>
      <div><div>Size</div><span>6</span><span>9</span><span class="size-disabled">10</span><span>Size Chart</span></div>
      <form><input placeholder="Enter pincode"></form>
      <footer>Subscribe <input type="email" placeholder="Your email address"></footer>`);
    const facts = await page.evaluate(observePage);

    const cards = facts.candidates.filter((c) => c.kind === "card");
    expect(cards.map((c) => c.text)).toEqual(["Life Like A10 PRO 2 Bluetooth Earbuds ₹269", "Altek 14322 Black Men's Thong Flip Flop ₹186"]);
    expect(cards.every((c) => c.hasPrice && c.href === null)).toBe(true);
    expect(facts.variantOptions).toEqual(["6", "9"]);
    // A search box, a PIN field and a newsletter box are not a checkout form.
    expect(facts.formFields).toBe(1);
    expect(classifyPage(facts)).toBe("listing");
  });

  test("sees product cards whose price has no ₹ sign, and ADD TO CART blocks with nested icons", async ({ page }) => {
    await page.setContent(`
      <div id="grid">
        <div><img src="${PIXEL}"><div>Babyhug Advanced Pant Style Diapers Large</div><div>988.01 <s>2679</s></div><div><i></i>ADD TO CART</div></div>
        <div><img src="${PIXEL}"><div>Pampers Premium Care Pants Medium</div><div>1,847.58</div><div><span>ADD TO CART</span></div></div>
      </div>`);
    const facts = await page.evaluate(observePage);
    expect(facts.candidates.filter((c) => c.kind === "card").map((c) => c.text)).toEqual([
      "Babyhug Advanced Pant Style Diapers Large 988.01 2679",
      "Pampers Premium Care Pants Medium 1,847.58",
    ]);
    // each label once: the <span> is the label, not the <div> around it
    expect(facts.candidates.filter((c) => c.kind === "label")).toHaveLength(2);
    expect(classifyPage(facts)).toBe("product");
  });

  test("finds choices under a 'Select Size' label whatever they say, but not the offers below", async ({ page }) => {
    await page.setContent(`
      <h1>Whey Protein</h1>
      <div><div>Select Size</div><div><span>Single</span> <span>Pack of 2</span> <span class="sold-out">Pack of 4</span> <a href="#">Size Chart</a></div></div>
      <div><div>Available Offers</div><div>Get 11% off with a very long description of the offer that goes on and on for quite a while, repeating itself many times over, so that this block is much longer than a little row of choices would ever be, and certainly not a size.</div></div>`);
    expect((await page.evaluate(observePage)).variantOptions).toEqual(["Single", "Pack of 2"]);
  });

  test("finds an ADD TO CART that is a div, and targets it by its label", async ({ page }) => {
    await page.setContent(`<h1>Flip Flop</h1><div>Size</div><span>9</span><div style="cursor:pointer" onclick="document.title='clicked'">ADD TO CART</div><button>Wishlist</button>`);
    const facts = await page.evaluate(observePage);
    const add = facts.candidates.find((c) => c.kind === "label");
    expect(add).toMatchObject({ text: "ADD TO CART", disabled: false });
    expect(classifyPage(facts)).toBe("product");
    expect(targetFor(add!)).toEqual({ text: "ADD TO CART", exact: true });
    await page.getByText("ADD TO CART", { exact: true }).click();
    expect(await page.title()).toBe("clicked");
  });

  test("notices a payment provider's overlay, but not one that is merely present and hidden", async ({ page }) => {
    const overlay = (style: string) =>
      `<h1>Cart</h1><button>Proceed to checkout</button><div class="razorpay-container" style="${style}"><div class="razorpay-backdrop"></div></div>`;
    await page.setContent(overlay("position:fixed;inset:0;display:block"));
    expect((await page.evaluate(observePage)).paymentOverlay).toBe(true);
    await page.setContent(overlay("display:none"));
    expect((await page.evaluate(observePage)).paymentOverlay).toBe(false);
  });

  test("counts a cart row's Remove button, but not 'Remove all filters'", async ({ page }) => {
    await page.setContent(`<button>Remove all filters</button><button>Remove filter: Brand</button><h1>Results</h1>`);
    expect((await page.evaluate(observePage)).cartRows).toBe(0);
    await page.setContent(`<div>Silk Kurta ₹899 <button>Remove</button></div><div>Cotton Kurta ₹499 <button>Remove item</button></div>`);
    expect((await page.evaluate(observePage)).cartRows).toBe(2);
  });

  test("counts name, address and PIN fields as a checkout form", async ({ page }) => {
    await page.setContent(`
      <h1>Delivery details</h1>
      <input placeholder="Full name"><input aria-label="Address line 1"><input name="pincode"><input type="tel" placeholder="Mobile number">
      <div>Remove</div><button>Remove</button>`);
    const facts = await page.evaluate(observePage);
    expect(facts.formFields).toBe(4);
    expect(classifyPage(facts)).toBe("checkout");
  });
});

test.describe("robots.txt and new tabs", () => {
  /** A tiny shop whose robots.txt forbids /private, with a link that opens in a new tab. */
  async function shop() {
    const { createServer } = await import("node:http");
    const hits: string[] = [];
    const server = createServer((req, res) => {
      hits.push(req.url ?? "");
      const send = (body: string, type = "text/html") => (res.writeHead(200, { "content-type": type }), res.end(body));
      if (req.url === "/robots.txt") return send("User-agent: *\nDisallow: /private", "text/plain");
      if (req.url === "/b") return send("<h1>Reached the new tab</h1>");
      if (req.url === "/private") return send("<h1>Secret</h1>");
      return send(`<h1>Shop</h1><a href="/b" target="_blank">Open product</a> <a href="/private">Members area</a>`);
    }).listen(0);
    return { server, hits, base: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
  }

  test("a link that opens a new tab is followed, with robots.txt checking on", async ({}, info) => {
    const { server, base } = await shop();
    try {
      const run = await runAudit(
        { site: "newtab", baseUrl: base, steps: [{ do: "goto", path: "/" }, { do: "click", target: { role: "link", name: "Open product" } }] },
        { outDir: info.outputPath(), respectRobots: true },
      );
      expect(run.status).toBe("completed");
      expect(run.steps.at(-1)!.url).toBe(`${base}/b`);
      expect(run.steps.at(-1)!.visibleText).toContain("Reached the new tab");
    } finally {
      server.close();
    }
  });

  test("a page robots.txt disallows is never fetched", async ({}, info) => {
    const { server, hits, base } = await shop();
    try {
      const run = await runAudit(
        { site: "robots", baseUrl: base, steps: [{ do: "goto", path: "/" }, { do: "click", target: { role: "link", name: "Members area" } }] },
        { outDir: info.outputPath(), respectRobots: true },
      );
      expect(run.status).toBe("completed");
      expect(run.note).toMatch(/robots\.txt disallows .*\/private/);
      expect(hits).not.toContain("/private");
    } finally {
      server.close();
    }
  });
});

test("a page that fails to load is reported as a failure, never recorded as evidence", async ({}, info) => {
  const { createServer } = await import("node:http");
  const server = createServer((req, res) => {
    if (req.url === "/boom") return void req.socket.destroy(); // the connection drops, like a flaky network
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<h1>Shop</h1><a href="/boom">Boom</a>`);
  }).listen(0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const run = await runAudit(
      { site: "flaky", baseUrl: base, steps: [{ do: "goto", path: "/" }, { do: "click", target: { role: "link", name: "Boom" } }] },
      { outDir: info.outputPath() },
    );
    expect(run.status).toBe("failed");
    expect(run.note).toMatch(/failed to load/);
    // the only step recorded is the good page: no step shows the browser's error page
    expect(run.steps.map((s) => s.url)).toEqual([`${base}/`]);
  } finally {
    server.close();
  }
});

test("an exact text target still finds a label that CSS shows in uppercase", async ({ page }, info) => {
  // The HTML says "Add To Cart"; text-transform makes the browser report "ADD TO CART".
  const { createServer } = await import("node:http");
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<h1>Shop</h1><div style="text-transform:uppercase;cursor:pointer" onclick="document.title='added'">Add To Cart</div>`);
  }).listen(0);
  const { port } = server.address() as { port: number };
  try {
    await page.goto(`http://127.0.0.1:${port}/`);
    const shown = await page.evaluate(() => document.querySelector<HTMLElement>("div")!.innerText);
    expect(shown).toBe("ADD TO CART"); // what the agent records

    const run = await runAudit(
      {
        site: "uppercase",
        baseUrl: `http://127.0.0.1:${port}`,
        steps: [{ do: "goto", path: "/" }, { do: "click", target: { text: shown, exact: true } }],
      },
      { outDir: info.outputPath() },
    );
    expect(run.status).toBe("completed");
    expect(run.steps.at(-1)!.action).toBe("click ADD TO CART");
  } finally {
    server.close();
  }
});

test("a recipe that reaches for a payment control is stopped before pressing it", async ({}, info) => {
  const recipe: Recipe = {
    site: "payment-guard",
    baseUrl: BASE,
    steps: [
      { do: "goto", path: "/?v=0" },
      { do: "goto", path: "/product/usb-cable/" },
      { do: "click", target: { role: "button", name: "Add to cart" } },
      { do: "click", target: { role: "link", name: "Proceed to checkout" } },
      { do: "click", target: { role: "button", name: /guest|skip|without/i }, optional: true },
      { do: "click", target: { role: "link", name: "Proceed to payment" } },
    ],
  };
  const run = await runAudit(recipe, { outDir: info.outputPath() });
  expect(run.status).toBe("completed");
  expect(run.note).toMatch(/Stopped before payment control/);
  expect(run.steps.at(-1)!.url).not.toContain("/payment/");
});

test("a site that blocks the crawler is reported not auditable instead of being worked around", async ({}, info) => {
  // A throwaway server that answers every request with 403, like a WAF refusing an unknown bot.
  const { createServer } = await import("node:http");
  const server = createServer((_req, res) => {
    res.writeHead(403, { "content-type": "text/html" });
    res.end("<h1>Access Denied</h1>");
  }).listen(0);
  const { port } = server.address() as { port: number };
  try {
    const run = await runAudit(
      { site: "blocked", baseUrl: `http://127.0.0.1:${port}`, steps: [{ do: "goto", path: "/" }, { do: "goto", path: "/next" }] },
      { outDir: info.outputPath() },
    );
    expect(run.status).toBe("not_auditable");
    expect(run.note).toMatch(/HTTP 403/);
    expect(run.steps.at(-1)!.action).toBe("blocked");
  } finally {
    server.close();
  }
});
