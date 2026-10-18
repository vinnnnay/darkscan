import { describe, expect, it } from "vitest";
import { BENCH_PATTERNS, DECOYS, DEFAULT_WORDS, VARIANT_COUNT, configFromQuery, generateVariants } from "./variants.ts";

describe("generateVariants", () => {
  it("is deterministic", () => {
    expect(generateVariants()).toEqual(generateVariants());
  });

  it("has a clean control and an all-patterns variant", () => {
    const [clean, all] = generateVariants();
    expect(clean!.patterns).toEqual([]);
    expect(all!.patterns).toEqual([...BENCH_PATTERNS]);
  });

  it("plants every pattern in several variants so each detector gets tested", () => {
    const variants = generateVariants();
    expect(variants).toHaveLength(VARIANT_COUNT);
    for (const p of BENCH_PATTERNS) {
      expect(variants.filter((v) => v.patterns.includes(p)).length).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("decoys and wording", () => {
  const variants = generateVariants();

  it("uses every decoy in several variants", () => {
    for (const d of DECOYS) expect(variants.filter((v) => v.decoys.includes(d)).length).toBeGreaterThanOrEqual(5);
  });

  it("never shares a phrase between the dev and test splits", () => {
    const phrases = (split: string) => new Set(variants.filter((v) => v.split === split).flatMap((v) => Object.values(v.words)));
    const dev = phrases("dev");
    expect([...phrases("test")].filter((p) => dev.has(p))).toEqual([]);
  });

  it("splits variants 0-24 into dev and 25-49 into test", () => {
    expect(variants.filter((v) => v.split === "dev").map((v) => v.id)).toEqual([...Array(25).keys()]);
  });
});

describe("configFromQuery", () => {
  it("reads explicit patterns with default wording and no decoys", () => {
    expect(configFromQuery("?dp=nagging,drip_pricing,bogus")).toEqual({
      patterns: ["drip_pricing", "nagging"],
      decoys: [],
      words: DEFAULT_WORDS,
    });
  });

  it("supports all and none", () => {
    expect(configFromQuery("?dp=all")?.patterns).toEqual([...BENCH_PATTERNS]);
    expect(configFromQuery("?dp=none")?.patterns).toEqual([]);
  });

  it("looks up variants and returns null when nothing is chosen", () => {
    expect(configFromQuery("?v=1")?.patterns).toEqual([...BENCH_PATTERNS]);
    expect(configFromQuery("?v=999")).toBeNull();
    expect(configFromQuery("")).toBeNull();
  });
});
