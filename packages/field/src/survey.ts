// Which shops can be audited at all. Only robots.txt is fetched: no shop is crawled.
import { fetchRobotsDoc, isAllowed, parseRobots, type RobotsDoc, type RobotsLoader, type RobotsStatus } from "@darkscan/crawler";
import type { Probe, Shop } from "./shops.ts";

/** The survey asks for robots.txt exactly as a crawl would, so it predicts what a crawl will do. */
export type Loader = RobotsLoader;
export type { RobotsDoc, RobotsStatus };

export type ProbeVerdict = Probe & { allowed: boolean; origin: string; status: RobotsStatus };
export type Verdict = "crawlable" | "browse-only" | "closed";

export type ShopSurvey = {
  id: string;
  name: string;
  home: ProbeVerdict;
  probes: ProbeVerdict[];
  /** The Disallow rules that apply to us and look like a cart, checkout or payment path. */
  cartRules: string[];
  verdict: Verdict;
};

/**
 * A path that looks like the part of a shop where drip pricing and basket sneaking happen.
 * Word-ish boundaries so `/bag` matches but `/baggage-offers` does not.
 */
const CART_PATH = /(^|[^a-z])(cart|bag|basket|checkout|check-out|payment|pay|purchase|order|buy)([^a-z]|$)/i;

/** The cart-like Disallow rules in a robots.txt, as written. Evidence for the verdict below. */
export function cartRules(text: string): string[] {
  return [...new Set(parseRobots(text).filter((r) => !r.allow && CART_PATH.test(r.pattern)).map((r) => r.pattern))];
}

/** Fails closed, exactly as the crawler does: a robots.txt we can't read means we don't go. */
export function allows(doc: RobotsDoc, url: string): boolean {
  if (doc.status === "unreachable") return false;
  if (doc.status === "none") return true;
  const { pathname, search } = new URL(url);
  return isAllowed(parseRobots(doc.text), pathname + search);
}

/**
 * `crawlable`: every cart/checkout path tested is allowed, so a full audit is possible.
 * `browse-only`: the home page is allowed but some cart/checkout path is not.
 * `closed`: even the home page is disallowed.
 */
export function verdictFor(home: ProbeVerdict, probes: ProbeVerdict[]): Verdict {
  if (!home.allowed) return "closed";
  return probes.every((p) => p.allowed) ? "crawlable" : "browse-only";
}

/** Fetches robots.txt once per origin. Caller supplies the loader so tests never touch the network. */
export async function surveyShop(shop: Shop, load: Loader): Promise<ShopSurvey> {
  const docs = new Map<string, RobotsDoc>();
  const doc = async (url: string) => {
    const { origin } = new URL(url);
    if (!docs.has(origin)) docs.set(origin, await load(origin));
    return docs.get(origin)!;
  };
  const verdict = async (probe: Probe): Promise<ProbeVerdict> => {
    const d = await doc(probe.url);
    return { ...probe, origin: new URL(probe.url).origin, status: d.status, allowed: allows(d, probe.url) };
  };

  const home = await verdict({ label: "home", url: shop.home });
  const probes = [];
  for (const p of shop.probes) probes.push(await verdict(p));
  const rules = [...docs.values()].flatMap((d) => (d.status === "ok" ? cartRules(d.text) : []));
  return { id: shop.id, name: shop.name, home, probes, cartRules: [...new Set(rules)], verdict: verdictFor(home, probes) };
}

/** The same fetch the crawler uses: same timeout, same user agent, same fail-closed rules. */
export const fetchRobots = fetchRobotsDoc;
