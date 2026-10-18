# DarkScan

DarkScan audits e-commerce checkout flows for the dark patterns banned by India's
Central Consumer Protection Authority (CCPA) in its 2023 guidelines, and backs every
finding with replayable evidence: screenshots, the steps taken, and a Playwright trace.

It reports **potential** violations with a confidence score. It does not make legal
judgements, and a human verifies every finding before it is published.

**Runs at ₹0:** local models via Ollama, GitHub Actions, GitHub Pages. No paid APIs.

## Status

| Week | Milestone | Status |
|---|---|---|
| 1 | DarkBench: test shop with planted, switchable patterns | ✅ |
| 2 | Playwright crawler + price/cart tracker | ✅ |
| 3 | Rule detectors + precision/recall evaluation | ✅ |
| 4 | Local-LLM detectors + recipe agent with self-repair | ✅ |
| 5 | Real-site audits + evidence reports | ✅ reports and a bring-your-own-session mode; one shop fully audited, the rest limited by robots.txt or bot protection (see "Trying it on real shops") |
| 6 | Dashboard + rerun via GitHub Actions | ✅ see "Dashboard" |

## DarkBench

A fake shop where each dark pattern can be switched on or off, so detectors are
measured against known ground truth instead of guesswork.

```
?v=0                 clean shop (false-positive control)
?v=1                 every pattern planted
?v=2 … ?v=24         dev split: random patterns, decoys and wording
?v=25 … ?v=49        test split: same, with held-out wording
?dp=drip_pricing,nagging   pick patterns directly (also dp=all, dp=none)
&debug=1             show which patterns and decoys are active
```

The answer key (patterns, decoys and wording for every variant) is published at `/manifest.json`.

Three things keep the benchmark honest:

- **Varied wording.** Each variant draws its fee names, timer text, popup titles, decline
  buttons, account-wall headings and checkbox labels from pools of realistic phrasings.
- **Decoys: honest look-alikes that must not be flagged.** A real countdown to midnight IST,
  GST disclosed on the product page but added at checkout, a ₹0 free gift, a one-off cookie
  popup with equal Accept/Reject buttons, a plain-but-readable decline link, a pushy
  "Sign in to continue" that still offers guest checkout, and a genuine stock-out with no upsell.
- **A held-out split.** Variants 25–49 use phrasings that never appear in variants 0–24.
  Detectors may only be tuned on dev results, so the test score shows how they handle
  wording they weren't written for.

| Pattern (CCPA Annexure 1) | How DarkBench plants it |
|---|---|
| False urgency | 10-minute timer that restarts on reload, fake "only 2 left" |
| Basket sneaking | "Purchase Protection" added to the cart at checkout |
| Confirm shaming | Guilt-tripping decline text on popups |
| Forced action | Account required, no guest checkout |
| Interface interference | Huge accept button, tiny low-contrast decline link |
| Bait and switch | Advertised ₹499 deal is "unavailable", pushes the ₹1,299 item |
| Drip pricing | Platform and convenience fees hidden until checkout |
| Disguised advertisement | Sponsored product without a "Sponsored" label |
| Nagging | Newsletter popup returns on every page and 15s after closing |
| Trick question | Pre-ticked, double-negative opt-out checkbox |

Subscription traps, SaaS billing and rogue malware are out of scope: observing them
needs a payment or a software install.

The clean variant still has a disclosed delivery fee and a disclosed platform fee, so
detectors are tested on honest charges too, not only on tricks.

## Crawler

`packages/crawler` replays a **site recipe** (the scripted path to checkout) in Chromium and
records a step after every action:

- full-page screenshot and HTML
- visible text
- price lines (item, delivery, fee, tax, discount) and the total, parsed from rendered text, not site-specific selectors
- cart rows, each flagged with whether the crawler added it itself
- checkbox states
- for popups: the text, every button's size, font and colours, and which decline button it pressed

Every run also saves a Playwright trace (`trace.zip`), which you can replay at trace.playwright.dev.

Safety rails are built in. The crawler:

- refuses to press anything that looks like a payment button
- stops (instead of signing up) when checkout demands an account; only DarkBench runs may create one
- declines every popup and upsell the way a cautious shopper would

```bash
npm run build:bench && npm run serve:bench      # terminal 1
npm run crawl -- --variant 1                     # terminal 2 → runs/<id>/run.json
```

## Detectors

`packages/detectors` turns a run's evidence into findings. Each finding has a status
(`likely` or `review`), a confidence, the evidence steps, and a plain-English explanation.

| Pattern | Rule | Honest case it must not flag |
|---|---|---|
| Drip pricing | A fee/tax/delivery line appears late, and no earlier line mentions its key terms as a charge | Fees disclosed upfront, even in other words ("18% GST is added at checkout") |
| Basket sneaking | A paid cart item the crawler never added (it declines every upsell) | A ₹0 free gift; an item with no visible price is only `review` |
| False urgency | A countdown that goes back up after a reload | A countdown that keeps counting down; a bare "only 3 left" is only `review` |
| Interface interference | Accept ≥ 4× the size of decline, plus decline contrast < 3:1 or text < 12px | Comparable buttons |
| Nagging | The same popup shown 3+ times after being declined (2 times → `review`) | Each popup shown once |
| Forced action | "Create an account to continue" with no guest option | Sign-in offered alongside guest checkout |
| Bait and switch | An advertised price leads to "unavailable" plus a pricier alternative | A plain stock-out is only `review` |

Confirm shaming, trick questions and disguised ads need a language or vision model (week 4).

## Evaluation

```bash
npm run build:bench
npm run eval                 # crawl all 50 variants, score, write eval/RESULTS.md
npm run eval -- --check      # also fail on any drop below eval/baseline.json (runs in CI)
```

Full per-pattern scores are in [eval/RESULTS.md](eval/RESULTS.md).

| Rule detectors | dev precision | dev recall | **test precision** | **test recall** |
|---|---|---|---|---|
| Before hardening fixes | 76.0% | 46.3% | 53.3% | 22.9% |
| After (current) | 100% | 100% | **100%** | **80.0%** |

What changed, using dev errors only:

1. **Crawler:** 40 of 48 crawls got stuck behind popups whose decline button used unfamiliar
   wording ("Reject all", "I'm just browsing"). It now falls back to the least prominent
   button that isn't an accept action, instead of relying on a fixed phrase list.
2. **Drip pricing:** disclosure is matched on a charge's key terms in a money context, so
   "18% GST is added at checkout" counts as disclosing "GST @ 18%".
3. **Basket sneaking:** items that cost ₹0 are not flagged.

Both detector fixes also removed every false alarm on the held-out split. The remaining
held-out misses show the limits of keyword rules: false urgency (25% recall) misses
countdowns phrased without urgency words ("Price goes back up in 09:58"), and forced action
(0% recall) misses account walls phrased as "Register to place your order". Week 4's
language-model detectors are measured against these gaps.

Caveat: one person wrote DarkBench's wording and the detectors. The held-out split limits
tuning to known phrases, but real-site audits (week 5) are the true test.

### Adding a local language model (week 4)

```bash
ollama pull qwen2.5:3b                          # free, runs on the CPU, nothing leaves the machine
npm run eval -- --llm                            # rules + model → eval/RESULTS-llm.md
npm run eval -- --llm --from runs/eval-<id>      # re-score saved crawls without crawling again
```

The model (`qwen2.5:3b`, temperature 0, fixed seed, answers cached on disk) does two jobs:

- **Its own patterns:** confirm shaming, trick questions and disguised ads, which need a
  judgement about wording. Code does everything that can be done with code: it finds the
  ad-tracked links, the pre-ticked boxes and the decline buttons, and the model only answers
  a narrow yes/no question about one piece of text. Its answers are validated against a
  JSON schema.
- **A second opinion** on forced action and false urgency, but only when the rule found
  nothing. For urgency the model *finds* the countdowns and code compares them, so the model
  never decides "did it reset?".

| | held-out precision | held-out recall |
|---|---|---|
| Rules only (7 patterns) | 100% | 80.0% |
| Rules + model (10 patterns) | **90.9%** | **90.0%** |

On held-out wording, per pattern (full table in [eval/RESULTS-llm.md](eval/RESULTS-llm.md)):

| Pattern | Precision | Recall | Note |
|---|---|---|---|
| Trick question | 100% | 100% | |
| Confirm shaming | 54.5% | 85.7% | 5 false alarms: the 3B model over-flags blunt but fair declines |
| Disguised advertisement | 71.4% | 100% | 4 false alarms: it misses unfamiliar labels such as "Promoted" |
| Forced action | 100% | 20% | up from 0%, still misses most unfamiliar account-wall wording |
| False urgency | 100% | 58.3% | up from 25% |

Dev scores are 100% everywhere, so there is nothing left to tune on without looking at the
held-out split. The weak held-out numbers are reported as they are rather than tuned away.
A larger model would likely help, but this project is built to run free on a laptop.

## Recipe agent

Hand-writing a recipe per site doesn't scale, so `packages/agent` learns one. It is a
[LangGraph](https://github.com/langchain-ai/langgraphjs) loop: **observe** the page, **decide**,
**act** through the same audit session the crawler uses, and repeat until it reaches checkout.
Every action it takes is recorded as a recipe step, and the exploration run is itself a full
evidence run.

```bash
npm run learn -- --url https://shop.example/ --site shop-example   # explore, then save recipes/shop-example.json
npm run audit -- --recipe recipes/shop-example.json                # replay, run detectors, repair if the site changed
```

- **Rules decide first.** A page is classified from what is visible (listing, product, cart,
  checkout form, account wall, payment), and a rule picks the next control: a priced product
  link, an "add to cart" button, the cart link, "proceed to checkout", a guest option.
- **The local model is a fallback.** Only when no rule fits (wording the rules don't know) is
  `qwen2.5:3b` shown a numbered shortlist and asked for one index. It never decides when to
  stop, and payment-looking controls are removed from the shortlist before it sees them.
- **Probes are part of the recipe.** The agent first opens the page's headline deal, then comes
  back (bait and switch), and on the first product page waits and reloads (false urgency).
- **Dead ends are handled.** It remembers links it has opened, and if a product page has nothing
  to buy it goes back and tries another.
- **Recipes repair themselves.** If a replayed step's target has vanished, the agent takes over
  from that page, finds a new route to checkout, and the saved recipe gets the new tail.

Stopping rules are code, not model judgement: the agent stops at the checkout form, at an
account wall with no guest option, or before any payment control, and never signs up.

### How it did on DarkBench

Run with `npm run eval -- --agent` (rules only, no model, no hand-written recipe):

| | |
|---|---|
| Found checkout, an account wall or payment on its own | **50 / 50** variants |
| Recipe length | 8–9 steps, 0 model decisions |
| Recipes that replay to identical findings | **50 / 50** |
| Precision, dev and held-out | 100% |
| Recall, dev / held-out | 85.4% / 72.9% (hand-written recipes: 100% / 80.0%) |

The recall gap is by design, and verifiably so. In the 15 variants where checkout demands an
account and offers no guest option, the agent stops, because it never signs up. That hides the
checkout page, so drip pricing and basket sneaking can't be seen there. **All 17 missed
drip-pricing and basket-sneaking cases are in those variants; in every variant where checkout was
reachable, it caught 14 of 14 drip-pricing and 19 of 19 basket-sneaking cases.** The hand-written
recipes reached those cases only because they created an account, which an audit of a real site must not do.

Two bugs found by this benchmark:

1. A page with email and password fields under a neutral heading ("How would you like to check
   out?") was classified as the checkout form, so the agent stopped one click early. It now treats a
   visible password field on a page with no cart items as an account page. (Diagnosed on dev variant
   9; test variant 29 showed the same bug. The fix uses page structure, not any wording from either split.)
2. Returning to the start page reset the shop's session, so its newsletter popup appeared twice on
   clean variants and nagging got spurious `review` findings. A repeat visit to the same link now keeps the session.

## Trying it on real shops

One run per shop on 2026-10-18, with the rules above: `robots.txt` obeyed, a few seconds between actions, a user
agent that names DarkScan, guest browsing only, stop before payment. No findings about any company are published.

| Shop | Result |
|---|---|
| **Snapdeal** | Learned the whole path on its own (open a product, add to cart, proceed to checkout), saved it as [recipes/snapdeal.json](recipes/snapdeal.json), and replayed it on the live site twice. It stopped when checkout opened Razorpay's overlay. No findings. |
| FirstCry | Opened a department, then a product, ran the urgency probe and added it to the cart. Its cart lives on `checkout.firstcry.com`, whose `robots.txt` disallows `/pay`, so DarkScan **refused to load it** and stopped. Product pages are auditable, its cart is not. |
| Tata CLiQ | Navigation needs the language model ("Categories" is a menu button, not a link), and the product page wants a size or variant choice that is now detected, but the 3B model's route through the menus isn't reliable. Reached a product and clicked "Add To Bag"; not completed. |
| Nykaa, Myntra | **Not auditable.** The connection is dropped on the first request, which is typical bot protection. DarkScan leaves such sites alone. |

What the real shops taught the agent, each now covered by a test: product cards and "ADD TO CART" buttons that are
plain `div`s; labels that CSS shows in uppercase; sizes that must be chosen before adding; links that open in a new
tab; popups whose only "button" is a promotional link; a payment provider's overlay appearing on "Proceed to
checkout"; a footer that lists "Net Banking" as an accepted method; "Remove all filters" looking like a cart row. A
search box and a newsletter box once made a product page look like a checkout form and produced a false "success";
checkout now needs address-like fields and an item that is really in the cart.

**`robots.txt` limits how many shops can be audited at all.** Of 15 well-known Indian shops, 10 disallow at least one
cart or checkout URL I tested for generic crawlers (for Amazon.in and Flipkart it is their real cart URL; also Croma,
Ajio, Reliance Digital, boAt, Bewakoof, Lenskart, Decathlon, Pepperfry). Only Myntra, Snapdeal, Nykaa, Tata CLiQ and
FirstCry allowed everything tested, and two of those block automated browsers outright. DarkScan obeys `robots.txt`,
so on most shops it can only audit product pages, not the cart or checkout, where drip pricing and basket sneaking live.
FirstCry is an example the survey missed: its `www` host allowed everything, but its checkout host does not.

The decision taken: **keep strict compliance and audit a few shops well** (above), and add a mode that does not crawl
at all, where a person does the shopping. That is the next section.

## Reports

Every `learn`, `audit`, `record` and `analyze` run leaves two files next to its screenshots: `report.html` (open it
in a browser) and `findings.json`. A report shows each finding with its evidence screenshots, the guideline it maps
to, a confidence, and the steps taken. It is written to be hard to misuse:

- It says **potential** violation and states that it is not a legal finding; it never says anyone broke the law.
- It has a **"What this audit could not see"** section (no cart reached, only one price summary, the audit ended
  early, the shop blocked us), so a report with no findings is not mistaken for a clean bill of health.
- Page text comes from third-party sites, so everything is HTML-escaped and only screenshots the tool itself wrote
  (`step-000.png`) are ever linked. Both are tested with hostile input.

## Bring your own session

Crawling is limited by `robots.txt` and bot protection, so there is a second way in: **a person shops in a real
browser window and DarkScan listens.** It clicks nothing. Nothing is crawled, so `robots.txt` doesn't apply, and a
person can log in or solve a CAPTCHA themselves.

```bash
npm run record -- --url https://shop.example/ --site shop --redact "Your Name, 9876543210, 12 MG Road"
# shop as usual, up to paying; close the window (or press Enter) when done → runs/<id>/report.html

npm run analyze -- --run runs/<folder>            # analyse a folder someone sent you
npm run export-run -- --run runs/<folder> --out share/mine --redact "Your Name"    # a safer copy to share
```

It records the same evidence as the automated shopper after each page load, click and popup, runs the same
detectors, and writes the same report. In a test, a "person" shopping DarkBench's every-pattern variant, using
nothing but clicks, produced findings for false urgency, nagging, interface interference, forced action, basket
sneaking, drip pricing and bait and switch.

Because it records a human, privacy is the main design constraint, and each point below has a test:

| Protection | How |
|---|---|
| Typed values never reach the picture | Fields are made transparent only while a screenshot is taken. In a test, the screenshot with a typed value is pixel-identical to one without, and the person sees their text again straight afterwards. |
| Typed values never reach the files | Saved pages have no scripts and no field values. A password, email, name, address and PIN typed during a full session appear nowhere on disk. |
| Common identifiers are masked | Emails, UPI ids, phone numbers, card numbers, Aadhaar and PAN numbers, one-time codes, and PIN codes after their label. Words you list with `--redact` are masked everywhere. |
| No browser trace | Playwright traces keep the whole page, typed values included, so none is made. |
| **Recording stops at payment** | A payment page or a payment provider's overlay is detected *before* anything is captured; one marker step is written and the rest of the session is ignored. |
| Untrusted bundles | `analyze` validates `run.json` (size, step count, schema) and the report escapes everything, so a folder from a stranger can't inject markup. |

What it cannot do: it doesn't know a name or address it wasn't told, so **text the page shows** (a logged-in "Hello,
Asha") is only masked if you list it, and screenshots can show it. `--no-screenshots` records text only, and
`export-run` leaves screenshots out unless you ask. Look through a recording before sharing it.

## Dashboard

`packages/dashboard` turns `eval/results*.json` into one static page (precision and recall per pattern,
dev and held-out, for the rules, the local model and the agent). It is published at `/dashboard/` next
to DarkBench.

```bash
npm run dashboard -- --out site/dashboard     # then open site/dashboard/index.html
```

The **Deploy site** workflow republishes on every push that touches the bench, schema, dashboard or `eval/`.
Every Monday, and on **Actions → Deploy site → Run workflow**, it first re-crawls all 50 variants (rules and
agent) and fails, without publishing, if any detector drops below `eval/baseline*.json`. The local-model
board needs Ollama, so it shows the scores last committed from a local `npm run eval -- --llm`.

## Development

Requires Node 22.18+ (TypeScript scripts run with Node's built-in type stripping).

```bash
npm install
npm run dev:bench        # http://localhost:3000/?v=1&debug=1
npm test                 # unit tests
npm run build:bench      # static export to apps/darkbench/out
npx playwright install chromium
npm run test:e2e         # browser tests against the built site
```

## Layout

```
apps/darkbench     Next.js test shop (static export, deployed to GitHub Pages)
packages/schema    Shared Zod types: AuditRun, Step, PriceSnapshot, Finding
packages/crawler   Playwright recipe runner, price/cart/popup extraction
packages/agent     LangGraph recipe agent: learns a checkout path, repairs recipes
packages/report    Evidence report (report.html + findings.json) from a run and its findings
packages/session   Bring-your-own-session: record a person shopping, redaction, analyze/export
packages/detectors Rule detectors and local-LLM detectors: run evidence → findings
packages/eval      Crawl every DarkBench variant and score precision/recall
packages/dashboard Static dashboard built from the eval scores
eval/              Latest scores and the CI regression baselines
recipes/           Saved site recipes (JSON)
e2e/               Browser tests: DarkBench variants and crawler evidence
```

## Audit ethics

- Only pages any visitor can reach. Guest checkout only, and audits stop before payment.
- No CAPTCHA solving or anti-bot evasion: blocked sites are marked "not auditable".
- Rate-limited, a few seconds between actions.
- Findings say "potential violation", cite the guideline, and link the evidence.
