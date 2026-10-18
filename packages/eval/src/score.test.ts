import type { Finding } from "@darkscan/schema";
import { describe, expect, it } from "vitest";
import { regressions, score } from "./score.ts";

const f = (status: Finding["status"]): Finding => ({
  pattern: "nagging",
  status,
  confidence: status === "likely" ? 0.9 : 0.5,
  detector: "rule",
  evidenceSteps: [],
  explanation: "",
});

describe("score", () => {
  it("counts only likely findings as detections", () => {
    const [s] = score(
      [
        { variant: 0, split: "dev", planted: ["nagging"], findings: [f("likely")] },
        { variant: 1, split: "dev", planted: ["nagging"], findings: [f("review")] },
        { variant: 2, split: "dev", planted: [], findings: [f("likely")] },
        { variant: 3, split: "dev", planted: [], findings: [] },
      ],
      ["nagging"],
    );
    expect(s).toMatchObject({ tp: 1, fn: 1, fp: 1, tn: 1, review: 1, precision: 0.5, recall: 0.5, missed: [1], falseAlarms: [2] });
  });

  it("reports patterns that fall below the baseline", () => {
    const scores = score([{ variant: 0, split: "dev", planted: ["nagging"], findings: [] }], ["nagging"]);
    expect(regressions(scores, { nagging: { precision: 1, recall: 1 } })).toEqual(["nagging: recall 0.0% < baseline 100.0%"]);
  });
});
