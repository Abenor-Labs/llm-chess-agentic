import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import {
  STARTING_FEN,
  replay,
  loadGame,
  getLegalMoves,
  getMoveNumber,
  gameStatus,
  applyMove,
  resolveMove,
  moveCausesRepetition,
  toPgn,
  revisitsPosition,
  positionKey,
} from "./chess";

const FOOLS_MATE = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";

describe("basic queries", () => {
  it("lists legal moves and the move number", () => {
    expect(getLegalMoves(STARTING_FEN)).toHaveLength(20);
    expect(getMoveNumber(STARTING_FEN)).toBe(1);
    expect(getMoveNumber(replay(["e4", "e5", "Nf3"]).fen())).toBe(2);
    expect(getMoveNumber("garbage")).toBe(1);
  });

  it("rejects moves for an invalid FEN", () => {
    expect(resolveMove("not a fen", "e4")).toBeNull();
  });
});

describe("history", () => {
  it("replays and loads with history when it reproduces the FEN", () => {
    const moves = ["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8"];
    const chess = loadGame(replay(moves).fen(), moves);
    expect(chess.history()).toEqual(moves);
    expect(chess.isThreefoldRepetition()).toBe(true);
  });

  it("falls back to the FEN when history is inconsistent or illegal", () => {
    const fen = replay(["e4", "e5"]).fen();
    expect(loadGame(fen, ["d4", "d5"]).history()).toEqual([]);
    expect(loadGame(fen, ["e4", "Ke2??"]).fen()).toBe(fen);
    expect(loadGame(STARTING_FEN).fen()).toBe(STARTING_FEN);
  });
});

describe("applyMove", () => {
  it("keeps the FULL PGN, not just the last move", () => {
    const first = applyMove(STARTING_FEN, "e4")!;
    const second = applyMove(first.fen, "e5", ["e4"])!;
    expect(second.pgn).toBe("1. e4 e5");
    expect(second.pgn).not.toContain("FEN");
    expect(second.san).toBe("e5");
  });

  it("canonicalizes the stored SAN", () => {
    const r = applyMove(STARTING_FEN, "g1f3")!;
    expect(r.san).toBe("Nf3");
    expect(r.pgn).toBe("1. Nf3");
  });

  it("reports the resulting game status", () => {
    const history = ["f3", "e5", "g4"];
    const r = applyMove(replay(history).fen(), "Qh4", history)!;
    expect(r.san).toBe("Qh4#");
    expect(r.status).toEqual({ over: true, result: "0-1", reason: "Checkmate" });
  });

  it("detects threefold repetition only with history", () => {
    const history = ["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1"];
    const fen = replay(history).fen();
    expect(applyMove(fen, "Ng8", history)!.status.reason).toBe("Draw by threefold repetition");
    expect(applyMove(fen, "Ng8")!.status.over).toBe(false);
  });

  it("formats movetext", () => {
    expect(toPgn([])).toBe("");
    expect(toPgn(["e4", "e5", "Nf3"])).toBe("1. e4 e5 2. Nf3");
  });

  it("returns null for illegal moves", () => {
    expect(applyMove(STARTING_FEN, "e5")).toBeNull();
    expect(applyMove(STARTING_FEN, "")).toBeNull();
  });
});

describe("gameStatus", () => {
  it.each([
    [FOOLS_MATE, { over: true, result: "0-1", reason: "Checkmate" }],
    ["7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", { over: true, result: "1/2-1/2", reason: "Stalemate" }],
    ["8/8/8/4k3/8/8/8/4K3 w - - 0 1", { over: true, result: "1/2-1/2", reason: "Draw by insufficient material" }],
    ["8/8/8/4k3/8/8/8/R3K3 w - - 100 80", { over: true, result: "1/2-1/2", reason: "Draw by fifty-move rule" }],
    [STARTING_FEN, { over: false, result: null, reason: null }],
  ])("%s", (fen, expected) => {
    expect(gameStatus(new Chess(fen))).toEqual(expected);
    expect(gameStatus(loadGame(fen))).toEqual(expected);
  });

  it("awards checkmate to the side that delivered it", () => {
    expect(gameStatus(replay(["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#"])).result).toBe("1-0");
  });
});

describe("resolveMove", () => {
  const castleFen = "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1";
  const promoFen = "8/4P3/8/8/8/8/k7/4K3 w - - 0 1";
  const twoKnights = "4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1"; // Nb1 and Nf1 can both reach d2

  it.each([
    [STARTING_FEN, "e4", "e4"],
    [STARTING_FEN, "e2e4", "e4"],
    [STARTING_FEN, "e2-e4", "e4"],
    [STARTING_FEN, "g1f3", "Nf3"],
    [STARTING_FEN, "Ng1f3", "Nf3"],
    [STARTING_FEN, "Ng1-f3", "Nf3"],
    [STARTING_FEN, "nf3", "Nf3"],
    [STARTING_FEN, "Ngf3", "Nf3"],
    [STARTING_FEN, "Pe4", "e4"],
    [STARTING_FEN, "1. e4", "e4"],
    [STARTING_FEN, '"e4"', "e4"],
    [STARTING_FEN, "e4!", "e4"],
    [STARTING_FEN, "e4!?", "e4"],
    [STARTING_FEN, "Nf3+", "Nf3"],
    [castleFen, "O-O", "O-O"],
    [castleFen, "0-0", "O-O"],
    [castleFen, "o-o", "O-O"],
    [castleFen, "O-O-O", "O-O-O"],
    [castleFen, "0-0-0", "O-O-O"],
    [castleFen, "e1g1", "O-O"],
    [castleFen, "e1c1", "O-O-O"],
    [promoFen, "e8=Q", "e8=Q"],
    [promoFen, "e8Q", "e8=Q"],
    [promoFen, "e8", "e8=Q"],
    [promoFen, "e7e8q", "e8=Q"],
    [promoFen, "e7e8n", "e8=N"],
    [promoFen, "e8=N", "e8=N"],
    [twoKnights, "Nbd2", "Nbd2"],
    [twoKnights, "Nfd2", "Nfd2"],
  ])("%s: %s → %s", (fen, input, san) => {
    expect(resolveMove(fen, input)?.san).toBe(san);
  });

  it("accepts a capture written without x and an x on a quiet move", () => {
    const fen = replay(["e4", "d5"]).fen();
    expect(resolveMove(fen, "ed5")?.san).toBe("exd5");
    expect(resolveMove(fen, "exd5")?.uci).toBe("e4d5");
    expect(resolveMove(STARTING_FEN, "Nxf3")?.san).toBe("Nf3");
  });

  it("tries a lowercase b as a pawn first, then as a bishop", () => {
    const pawn = replay(["b4", "c5"]).fen();
    expect(resolveMove(pawn, "bxc5")?.san).toBe("bxc5");
    const bishop = replay(["e4", "e5", "Nf3", "Nc6"]).fen();
    expect(resolveMove(bishop, "bc4")?.san).toBe("Bc4");
    expect(resolveMove(bishop, "bb5")?.san).toBe("Bb5");
  });

  it("never guesses between two different legal moves", () => {
    expect(resolveMove(twoKnights, "Nd2")).toBeNull();
    expect(resolveMove(twoKnights, "d2")).toBeNull();
  });

  it("rejects illegal or nonsense input", () => {
    for (const bad of ["e5", "Ke2", "Qh5", "xyz", "", "   ", "O-O", "e9", "Nf3 Nc3"]) {
      expect(resolveMove(STARTING_FEN, bad)).toBeNull();
    }
    expect(resolveMove(FOOLS_MATE, "e4")).toBeNull(); // no legal moves at all
    expect(resolveMove(STARTING_FEN, undefined as unknown as string)).toBeNull();
  });

  it("returns UCI and squares", () => {
    expect(resolveMove(STARTING_FEN, "Nf3")).toEqual({ san: "Nf3", uci: "g1f3", from: "g1", to: "f3" });
    expect(resolveMove(promoFen, "e8=R")).toMatchObject({ uci: "e7e8r", promotion: "r" });
  });
});

describe("moveCausesRepetition", () => {
  it("flags the move that completes a threefold repetition and leaves the game untouched", () => {
    const chess = replay(["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1"]);
    const before = chess.fen();
    expect(moveCausesRepetition(chess, "Ng8")).toBe(true);
    expect(moveCausesRepetition(chess, "e5")).toBe(false);
    expect(moveCausesRepetition(chess, "Ke2")).toBe(false); // illegal
    expect(chess.fen()).toBe(before);
  });
});

describe("revisitsPosition", () => {
  it("flags moves that return to an earlier position, ignoring move counters", () => {
    const chess = replay(["Nf3", "Nf6"]);
    const revisits = revisitsPosition(chess);
    expect(revisits("Ng1")).toBe(false); // black to move after Ng1 — new position
    chess.move("Ng1");
    expect(revisitsPosition(chess)("Ng8")).toBe(true); // back to the start
    expect(revisitsPosition(chess)("e5")).toBe(false);
    expect(revisitsPosition(chess)("Ke2")).toBe(false); // illegal
    expect(positionKey(STARTING_FEN)).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -");
  });
});
