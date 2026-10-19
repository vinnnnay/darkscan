export type Rule = { allow: boolean; pattern: string };

const AGENT = "darkscan";

/**
 * Parses robots.txt (RFC 9309, the parts that matter): groups of User-agent lines followed
 * by Allow/Disallow rules. A group naming us wins over the `*` group.
 */
export function parseRobots(text: string): Rule[] {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current!.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      lastWasAgent = false;
      if (value) current.rules.push({ allow: key === "allow", pattern: value });
    } else {
      lastWasAgent = false;
    }
  }

  const named = groups.filter((g) => g.agents.some((a) => a !== "*" && AGENT.includes(a)));
  const chosen = named.length ? named : groups.filter((g) => g.agents.includes("*"));
  return chosen.flatMap((g) => g.rules);
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern).split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp("^" + body.join(".*") + (anchored ? "$" : "")).test(path);
}

/** The longest matching rule wins; on a tie, Allow wins. No matching rule means allowed. */
export function isAllowed(rules: Rule[], pathAndQuery: string): boolean {
  let best: Rule | null = null;
  for (const rule of rules) {
    if (!matches(rule.pattern, pathAndQuery)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}

/** What a host said when asked for its robots.txt. "none" is a 4xx: nothing is disallowed. */
export type RobotsStatus = "ok" | "none" | "unreachable";
export type RobotsDoc = { status: RobotsStatus; text: string };
export type RobotsLoader = (origin: string) => Promise<RobotsDoc>;

/** One timeout for every caller, so the survey predicts what a crawl will actually do. */
export const ROBOTS_TIMEOUT_MS = 15_000;

/** One GET per origin, identifying ourselves. RFC 9309: 4xx means allowed, 5xx means stay out. */
export const fetchRobotsDoc: RobotsLoader = async (origin) => {
  try {
    const res = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS), headers: { "user-agent": "DarkScan/0.1" } });
    if (res.status >= 500) return { status: "unreachable", text: "" };
    if (!res.ok) return { status: "none", text: "" };
    return { status: "ok", text: await res.text() };
  } catch {
    return { status: "unreachable", text: "" };
  }
};

/**
 * Why we are not fetching a URL. A robots.txt we could not read is not the same as one that
 * disallows us: both keep us out, but only one is something the site asked for, and a report
 * that confuses them is wrong about the shop.
 */
export type RobotsVerdict = { allowed: true } | { allowed: false; why: "disallowed" | "unreadable" };

/** Caches robots.txt per origin. Fails closed: if it cannot be read, nothing is allowed. */
export class RobotsPolicy {
  private cache = new Map<string, Promise<RobotsDoc>>();
  /** Parsed once per origin: a crawl checks every navigation, and robots.txt files run to pages. */
  private rules = new Map<string, Rule[]>();
  private load: RobotsLoader;

  constructor(load: RobotsLoader = fetchRobotsDoc) {
    this.load = load;
  }

  doc = (origin: string): Promise<RobotsDoc> => {
    if (!this.cache.has(origin)) this.cache.set(origin, this.load(origin));
    return this.cache.get(origin)!;
  };

  check = async (url: string): Promise<RobotsVerdict> => {
    const { origin, pathname, search } = new URL(url);
    const doc = await this.doc(origin);
    if (doc.status === "unreachable") return { allowed: false, why: "unreadable" };
    if (doc.status === "none") return { allowed: true };
    if (!this.rules.has(origin)) this.rules.set(origin, parseRobots(doc.text));
    return isAllowed(this.rules.get(origin)!, pathname + search) ? { allowed: true } : { allowed: false, why: "disallowed" };
  };
}
