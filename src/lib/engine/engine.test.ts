import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import {
  Position,
  perft,
  analyze,
  adjudicate,
  pickEngineMove,
  formatScore,
  isMateScore,
  loosePieces,
  materialCount,
  MATE_SCORE,
} from "./index";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Reference node counts from the Chess Programming Wiki perft suite.
const PERFT: Array<[string, string, number[]]> = [
  ["start", START, [20, 400, 8902]],
  ["kiwipete", "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", [48, 2039]],
  ["pos3 (ep, pins)", "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", [14, 191, 2812]],
  ["pos4 (promotions)", "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", [6, 264, 9467]],
  ["pos5", "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", [44, 1486]],
];

describe("Position", () => {
  it.each(PERFT)("perft matches reference: %s", (_name, fen, counts) => {
    const pos = new Position(fen);
    counts.forEach((expected, i) => expect(perft(pos, i + 1)).toBe(expected));
    expect(pos.fen()).toBe(fen); // make/unmake leaves the position untouched
  });

  it("round-trips FEN including castling and en passant", () => {
    const fen = "rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3";
    expect(new Position(fen).fen()).toBe(fen);
  });

  it("rejects malformed FEN", () => {
    expect(() => new Position("not a fen")).toThrow();
    expect(() => new Position("8/8/8/8/8/8/8/8 w - - 0 1")).toThrow(/king/);
    expect(() => new Position("rnbqkbnr/pppppppp/9/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")).toThrow();
  });

  it("generates exactly chess.js's legal SAN set across random games", () => {
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    let positions = 0;
    for (let game = 0; game < 12; game++) {
      const chess = new Chess();
      for (let ply = 0; ply < 120 && !chess.isGameOver(); ply++) {
        const pos = new Position(chess.fen());
        const legal = pos.legalMoves();
        const ours = legal.map((m) => pos.san(m, legal)).sort();
        const theirs = chess.moves().sort();
        expect(ours).toEqual(theirs);
        expect(pos.fen()).toBe(chess.fen());
        positions++;
        chess.move(theirs[Math.floor(rand() * theirs.length)]);
      }
    }
    expect(positions).toBeGreaterThan(500);
  });

  it("detects insufficient material", () => {
    expect(new Position("4k3/8/8/8/8/8/8/4K3 w - - 0 1").insufficientMaterial()).toBe(true);
    expect(new Position("4k3/8/8/8/8/8/8/2B1K3 w - - 0 1").insufficientMaterial()).toBe(true);
    expect(new Position("4k3/8/8/8/8/8/8/R3K3 w - - 0 1").insufficientMaterial()).toBe(false);
    expect(new Position("4k3/7p/8/8/8/8/8/4K3 w - - 0 1").insufficientMaterial()).toBe(false);
  });
});

describe("analyze", () => {
  it("finds mate in one and scores it as mate", () => {
    const fen = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
    const { moves } = analyze(fen, { depth: 2 });
    expect(moves[0].move).toBe("Qxf7#");
    expect(isMateScore(moves[0].score)).toBe(true);
    expect(formatScore(moves[0].score)).toBe("M1");
  });

  it("scores every legal move, best first, with SAN and UCI", () => {
    const { moves, depth } = analyze(START, { depth: 2 });
    expect(depth).toBe(2);
    expect(moves).toHaveLength(20);
    for (let i = 1; i < moves.length; i++) expect(moves[i - 1].score).toBeGreaterThanOrEqual(moves[i].score);
    expect(moves.find((m) => m.move === "Nf3")?.uci).toBe("g1f3");
  });

  it("does not treat a defended pawn as free (quiescence sees the recapture)", () => {
    // 1.e4 d5: Qg4?? is attacked by the c8 bishop; exd5 is a fair trade.
    const fen = "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
    const { moves } = analyze(fen, { depth: 2 });
    const qg4 = moves.find((m) => m.move === "Qg4")!;
    expect(moves[0].score - qg4.score).toBeGreaterThan(600);
    const exd5 = moves.find((m) => m.move === "exd5")!;
    expect(Math.abs(exd5.score)).toBeLessThan(150);
  });

  it("spots a hanging queen capture", () => {
    // The black queen wandered to h4 where the f3 knight simply takes it.
    const fen = "rnb1kbnr/pppp1ppp/8/4p3/4P2q/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";
    const { moves } = analyze(fen, { depth: 2 });
    expect(moves[0].move).toBe("Nxh4");
    expect(moves[0].score).toBeGreaterThan(700);
  });

  it("returns stalemate/checkmate positions with no moves", () => {
    expect(analyze("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1").moves).toEqual([]);
  });

  it("respects the time cap but always completes depth 1", () => {
    const kiwipete = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1";
    const t = Date.now();
    const a = analyze(kiwipete, { depth: 6, maxMs: 50 });
    expect(Date.now() - t).toBeLessThan(2_000);
    expect(a.depth).toBeGreaterThanOrEqual(1);
    expect(a.depth).toBeLessThan(6);
    expect(a.moves).toHaveLength(48);
  });

  it("prefers the faster mate", () => {
    const { moves } = analyze("6k1/5ppp/8/8/8/8/5PPP/1R1R2K1 w - - 0 1", { depth: 3 });
    expect(["Rb8#", "Rd8#"]).toContain(moves[0].move);
    expect(moves[0].score).toBe(MATE_SCORE - 1);
  });
});

describe("formatScore", () => {
  it("formats pawns and mates", () => {
    expect(formatScore(130)).toBe("+1.3");
    expect(formatScore(-45)).toBe("-0.5");
    expect(formatScore(0)).toBe("+0.0");
    expect(formatScore(MATE_SCORE - 3)).toBe("M2");
    expect(formatScore(-(MATE_SCORE - 2))).toBe("-M1");
  });
});

describe("loosePieces", () => {
  it("reports an undefended attacked piece", () => {
    // White knight on e5 attacked by the d6 pawn and undefended.
    const fen = "rnbqkb1r/ppp2ppp/3p1n2/4N3/4P3/8/PPPP1PPP/RNBQKB1R w KQkq - 0 4";
    const loose = loosePieces(fen, "white");
    expect(loose[0]).toMatchObject({ square: "e5", piece: "knight", defended: false, atRisk: 320 });
    expect(loose[0].attackers).toContain("pawn on d6");
  });

  it("reports a defended piece attacked by a cheaper one", () => {
    // Black bishop on c5 (defended by b6) attacked by the d4 pawn.
    const fen = "rnbqk1nr/p1pp1ppp/1p6/2b1p3/3PP3/8/PPP2PPP/RNBQKBNR b KQkq - 0 4";
    const loose = loosePieces(fen, "black");
    expect(loose.find((l) => l.square === "c5")).toMatchObject({ piece: "bishop", defended: true, atRisk: 230 });
  });

  it("ignores fairly defended pieces", () => {
    expect(loosePieces(START, "white")).toEqual([]);
  });
});

describe("materialCount", () => {
  it("counts in pawn units", () => {
    expect(materialCount(START)).toEqual({ white: 39, black: 39 });
  });
});

describe("adjudicate", () => {
  it("awards a decisive material edge", () => {
    expect(adjudicate("4k3/8/8/8/8/8/8/QQ2K3 w - - 0 1").result).toBe("1-0");
    expect(adjudicate("4k3/8/8/8/8/8/8/QQ2K3 b - - 0 1").result).toBe("1-0");
    expect(adjudicate("qq2k3/8/8/8/8/8/8/4K3 w - - 0 1").result).toBe("0-1");
  });

  it("calls balanced or small edges a draw", () => {
    expect(adjudicate(START).result).toBe("1/2-1/2");
    expect(adjudicate("4k3/8/8/8/8/8/P7/4K3 w - - 0 1").result).toBe("1/2-1/2");
  });

  it("reports terminal positions", () => {
    expect(adjudicate("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1")).toMatchObject({ result: "1/2-1/2", reason: "Stalemate" });
    expect(adjudicate("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3")).toMatchObject({ result: "0-1", reason: "Checkmate" });
  });
});

describe("pickEngineMove", () => {
  it("plays the best move without noise", () => {
    const fen = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
    expect(pickEngineMove(fen, { depth: 2 }).move.move).toBe("Qxf7#");
  });

  it("picks only within the noise window", () => {
    const fen = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
    // Mate is >> 300cp better than anything else, so noise can't pick another move.
    for (const r of [0, 0.5, 0.99]) {
      expect(pickEngineMove(fen, { depth: 2, noiseCp: 300, random: () => r }).move.move).toBe("Qxf7#");
    }
    const quiet = pickEngineMove(START, { depth: 1, noiseCp: 50, random: () => 0.99 });
    expect(quiet.move.move).toBeTruthy();
  });

  it("steers a winning bot away from a repetition draw", () => {
    // White is up a queen; pretend Qa2 would repeat the position.
    const fen = "4k3/8/8/8/8/8/8/Q3K3 w - - 0 1";
    const best = pickEngineMove(fen, { depth: 1 }).move.move;
    const alt = pickEngineMove(fen, { depth: 1, drawsByRepetition: (san) => san === best }).move.move;
    expect(alt).not.toBe(best);
  });

  it("lets a losing bot repeat", () => {
    const fen = "q3k3/8/8/8/8/8/8/4K3 w - - 0 1";
    const best = pickEngineMove(fen, { depth: 1 }).move.move;
    expect(pickEngineMove(fen, { depth: 1, drawsByRepetition: () => true }).move.move).toBe(best);
  });

  it("throws when there are no legal moves", () => {
    expect(() => pickEngineMove("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", { depth: 1 })).toThrow();
  });
});
