import { describe, it, expect } from "vitest";
import { whiteShare, evalLabel } from "./eval-bar";

describe("eval bar math", () => {
  it("maps evaluations to White's share of the bar", () => {
    expect(whiteShare(null)).toBe(50);
    expect(whiteShare({ cp: 0, mate: null, depth: 10 })).toBe(50);
    expect(whiteShare({ cp: 400, mate: null, depth: 10 })).toBeGreaterThan(80);
    expect(whiteShare({ cp: -400, mate: null, depth: 10 })).toBeLessThan(20);
    expect(whiteShare({ cp: null, mate: 3, depth: 10 })).toBe(100);
    expect(whiteShare({ cp: null, mate: -2, depth: 10 })).toBe(0);
  });

  it("labels evaluations", () => {
    expect(evalLabel(null)).toBe("…");
    expect(evalLabel({ cp: 130, mate: null, depth: 1 })).toBe("+1.3");
    expect(evalLabel({ cp: -45, mate: null, depth: 1 })).toBe("-0.5");
    expect(evalLabel({ cp: 0, mate: null, depth: 1 })).toBe("0.0");
    expect(evalLabel({ cp: null, mate: -3, depth: 1 })).toBe("M3");
    expect(evalLabel({ cp: null, mate: 0, depth: 1 })).toBe("#");
  });
});
