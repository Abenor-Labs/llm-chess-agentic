import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import {
  buildPlies,
  fenAt,
  classifyMove,
  materialSummary,
  resultHeadline,
  formatDuration,
  judgeSummary,
  sideAccuracy,
} from "./view-model";
import { STARTING_FEN } from "./chess";
import { describeJudgeEvent, type JudgeEvent } from "./judge-types";

function rows(sans: string[]) {
  const chess = new Chess();
  return sans.map((san, i) => {
    chess.move(san);
    return { moveSan: san, color: (i % 2 === 0 ? "white" : "black") as "white" | "black", moveNumber: Math.floor(i / 2) + 1, fenAfter: chess.fen() };
  });
}

describe("buildPlies", () => {
  it("recovers squares, colors and check", () => {
    const plies = buildPlies(rows(["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#"]));
    expect(plies).toHaveLength(7);
    expect(plies[0]).toMatchObject({ san: "e4", from: "e2", to: "e4", color: "white", checkSquare: null });
    expect(plies[6]).toMatchObject({ san: "Qxf7#", from: "h5", to: "f7", checkSquare: "e8" });
  });

  it("stops at a move that doesn't replay", () => {
    const good = rows(["e4", "e5"]);
    const plies = buildPlies([...good, { moveSan: "Ke9", color: "white", moveNumber: 2, fenAfter: "x" }, ...rows(["d4"])]);
    expect(plies).toHaveLength(2);
  });

  it("maps a ply count to a FEN", () => {
    const plies = buildPlies(rows(["e4", "e5"]));
    expect(fenAt(plies, 0)).toBe(STARTING_FEN);
    expect(fenAt(plies, 1)).toBe(plies[0].fenAfter);
    expect(fenAt(plies, 99)).toBe(plies[1].fenAfter);
    expect(fenAt([], 3)).toBe(STARTING_FEN);
  });
});

describe("classifyMove", () => {
  it.each([
    [null, null],
    [undefined, null],
    [0, "good"],
    [59, "good"],
    [60, "inaccuracy"],
    [150, "mistake"],
    [299, "mistake"],
    [300, "blunder"],
  ])("%s → %s", (cp, cls) => {
    expect(classifyMove(cp as number | null)).toBe(cls);
  });
});

describe("materialSummary", () => {
  it("is even at the start", () => {
    expect(materialSummary(STARTING_FEN)).toEqual({ diff: 0, capturedByWhite: [], capturedByBlack: [] });
  });

  it("counts captures and the balance", () => {
    // Black is missing its queen, White a pawn.
    const s = materialSummary("rnb1kbnr/pppppppp/8/8/8/8/PPPPPPP1/RNBQKBNR w KQkq - 0 1");
    expect(s.diff).toBe(8);
    expect(s.capturedByWhite).toEqual(["q"]);
    expect(s.capturedByBlack).toEqual(["p"]);
  });

  it("never reports negative captures after promotion", () => {
    const s = materialSummary("QQ2k3/8/8/8/8/8/8/4K3 w - - 0 1");
    expect(s.capturedByBlack).not.toContain("q");
    expect(s.diff).toBe(18);
  });
});

describe("text helpers", () => {
  it("headlines results", () => {
    expect(resultHeadline("1-0", "A", "B")).toBe("A wins");
    expect(resultHeadline("0-1", "A", "B")).toBe("B wins");
    expect(resultHeadline("1/2-1/2", "A", "B")).toBe("Draw");
    expect(resultHeadline(null, "A", "B")).toBe("No result");
  });

  it("formats durations", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(-1)).toBe("—");
    expect(formatDuration(850)).toBe("850ms");
    expect(formatDuration(3_240)).toBe("3.2s");
    expect(formatDuration(65_000)).toBe("1m 05s");
  });

  it("summarizes judge activity", () => {
    expect(judgeSummary(null)).toBeNull();
    expect(judgeSummary({ attempts: 1, events: [] })).toBeNull();
    expect(judgeSummary({ attempts: 1, events: [], engine: { depth: 2, nodes: 1, score: "+0.1" } })).toBeNull();
    expect(judgeSummary({ attempts: 1, events: [{ type: "notation", attempt: 1, from: "e2e4", to: "e4" }] })).toBe("notation corrected");
    expect(
      judgeSummary({
        attempts: 2,
        reconsidered: true,
        events: [{ type: "blunder", attempt: 1, move: "Qg4", lossCp: 900 }],
      }),
    ).toBe("2 attempts · reconsidered after a blunder warning");
  });

  it("describes every judge event", () => {
    const events: JudgeEvent[] = [
      { type: "parse", attempt: 1 },
      { type: "illegal", attempt: 1, move: "Ke9" },
      { type: "notation", attempt: 1, from: "e2e4", to: "e4" },
      { type: "blunder", attempt: 1, move: "Qg4", lossCp: 850, reply: "Bxg4" },
      { type: "repetition", attempt: 2, move: "Ng1", advantageCp: 450 },
      { type: "error", attempt: 3, detail: "timed out" },
      { type: "fallback", move: "Qg4" },
    ];
    const text = events.map(describeJudgeEvent);
    expect(text[1]).toContain('"Ke9"');
    expect(text[3]).toContain("≈8.5 pawns; Bxg4 punishes it");
    expect(text[4]).toContain("+4.5");
    expect(text.every((t) => t.length > 0)).toBe(true);
  });
});

describe("sideAccuracy", () => {
  it("averages analyzed moves per side", () => {
    const moves = [
      { color: "white" as const, moveAccuracy: 90, cpLoss: 10 },
      { color: "white" as const, moveAccuracy: 40, cpLoss: 400 },
      { color: "black" as const, moveAccuracy: null, cpLoss: null },
    ];
    expect(sideAccuracy(moves, "white")).toEqual({ accuracy: 65, acpl: 205, blunders: 1 });
    expect(sideAccuracy(moves, "black")).toBeNull();
  });
});
