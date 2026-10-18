type Rule = { allow: boolean; pattern: string };

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

/** Fetches and caches robots.txt per origin. Fails closed: if it can't be read, nothing is allowed. */
export class RobotsPolicy {
  private cache = new Map<string, Promise<Rule[] | "deny-all">>();

  allowed = async (url: string): Promise<boolean> => {
    const { origin, pathname, search } = new URL(url);
    if (!this.cache.has(origin)) this.cache.set(origin, this.load(origin));
    const rules = await this.cache.get(origin)!;
    return rules === "deny-all" ? false : isAllowed(rules, pathname + search);
  };

  private async load(origin: string): Promise<Rule[] | "deny-all"> {
    try {
      const res = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(8000), headers: { "user-agent": "DarkScan/0.1" } });
      if (res.status >= 500) return "deny-all";
      if (!res.ok) return []; // 4xx: no robots.txt, everything is allowed
      return parseRobots(await res.text());
    } catch {
      return "deny-all";
    }
  }
}
