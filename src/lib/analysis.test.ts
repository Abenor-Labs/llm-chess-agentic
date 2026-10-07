import { describe, it, expect } from "vitest";
import {
  clampCp,
  winPercent,
  moverWinPercent,
  moveAccuracy,
  computeMoveLoss,
  analyzeGame,
  CP_CAP,
} from "./analysis";

describe("clampCp", () => {
  it("clamps to +/- CP_CAP", () => {
    expect(clampCp(50)).toBe(50);
    expect(clampCp(9999)).toBe(CP_CAP);
    expect(clampCp(-9999)).toBe(-CP_CAP);
  });
});

describe("winPercent", () => {
  it("is 50 at an even position", () => {
    expect(winPercent(0)).toBeCloseTo(50, 5);
  });

  it("saturates toward 100 / 0 for decisive evals", () => {
    expect(winPercent(5000)).toBeGreaterThan(99);
    expect(winPercent(-5000)).toBeLessThan(1);
  });

  it("is symmetric around 50", () => {
    expect(winPercent(300) + winPercent(-300)).toBeCloseTo(100, 5);
  });
});

describe("moverWinPercent", () => {
  it("flips perspective for black", () => {
    const white = winPercent(200);
    expect(moverWinPercent(200, "white")).toBeCloseTo(white, 5);
    expect(moverWinPercent(200, "black")).toBeCloseTo(100 - white, 5);
  });
});

describe("moveAccuracy", () => {
  it("scores ~100 when win% is held or improved", () => {
    expect(moveAccuracy(60, 60)).toBeGreaterThan(99);
    expect(moveAccuracy(40, 70)).toBe(100); // improvement clamps at 100
  });

  it("scores low when win% drops sharply", () => {
    expect(moveAccuracy(90, 30)).toBeLessThan(20);
  });
});

describe("computeMoveLoss", () => {
  it("charges White for an eval drop", () => {
    const { cpLoss } = computeMoveLoss({ evalBeforeWhiteCp: 50, evalAfterWhiteCp: -30, color: "white" });
    expect(cpLoss).toBe(80);
  });

  it("charges Black using the flipped perspective", () => {
    // Black was winning (-50 for White) then blundered to +30 for White.
    const { cpLoss } = computeMoveLoss({ evalBeforeWhiteCp: -50, evalAfterWhiteCp: 30, color: "black" });
    expect(cpLoss).toBe(80);
  });

  it("gives zero loss and ~100 accuracy for an improving move", () => {
    const r = computeMoveLoss({ evalBeforeWhiteCp: 50, evalAfterWhiteCp: -50, color: "black" });
    expect(r.cpLoss).toBe(0);
    expect(r.moveAccuracy).toBe(100);
  });

  it("caps loss so a single decisive swing doesn't dominate", () => {
    // +5000 -> +100 for White: capped to 1000 -> 100 = 900, not 4900.
    const { cpLoss } = computeMoveLoss({ evalBeforeWhiteCp: 5000, evalAfterWhiteCp: 100, color: "white" });
    expect(cpLoss).toBe(CP_CAP - 100);
  });
});

describe("analyzeGame", () => {
  it("uses the start eval for the first move and chains thereafter", () => {
    const result = analyzeGame(20, [
      { color: "white", evalCp: 10 }, // white: 20 -> 10, loss 10
      { color: "black", evalCp: 40 }, // black: 10 -> 40 (worse for black), loss 30
      { color: "white", evalCp: 35 }, // white: 40 -> 35, loss 5
    ]);
    expect(result.map((r) => r.cpLoss)).toEqual([10, 30, 5]);
    expect(result[0].evalCp).toBe(10);
    expect(result.every((r) => r.moveAccuracy >= 0 && r.moveAccuracy <= 100)).toBe(true);
  });
});
