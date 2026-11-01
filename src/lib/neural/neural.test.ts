import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { Chess } from "chess.js";
import { Position } from "../engine/position";
import { evaluate, loadNet, push, refresh, FT } from "./nnue";
import { Depth5 } from "./search";
import { WEIGHTS_PATH } from "./index";

const BYTES = new Uint8Array(readFileSync(WEIGHTS_PATH));
// Loaded from a Node Buffer, as in production (a Buffer's slice is a view, not a copy).
const NET = loadNet(readFileSync(WEIGHTS_PATH));
// FEN + NNUE.evaluate from ML-AI reasoning_harness/scripts/dump_nnue_fixture.py (seed 7).
const PARITY: Array<{ fen: string; cp: number }> = JSON.parse(readFileSync(new URL("./parity.json", import.meta.url), "utf8"));

const evalFen = (fen: string) => {
  const pos = new Position(fen);
  return evaluate(NET, refresh(NET, pos), pos.side >> 3);
};

function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x80000000;
  };
}

function randomFens(n: number, seed: number): string[] {
  const rand = rng(seed);
  const out: string[] = [];
  while (out.length < n) {
    const g = new Chess();
    const plies = 4 + Math.floor(rand() * 60);
    for (let i = 0; i < plies && !g.isGameOver(); i++) {
      const moves = g.moves();
      g.move(moves[Math.floor(rand() * moves.length)]);
    }
    if (!g.isGameOver()) out.push(g.fen());
  }
  return out;
}

describe("depth 5 NNUE", () => {
  it("matches the Python evaluator within 1 cp on 1,000 positions", () => {
    expect(PARITY).toHaveLength(1000);
    const off = PARITY.filter((r) => Math.abs(evalFen(r.fen) - r.cp) > 1);
    expect(off).toEqual([]);
  });

  it("keeps the incremental accumulator equal to a refresh through random make/unmake", () => {
    const rand = rng(2);
    for (let game = 0; game < 20; game++) {
      const pos = new Position("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
      const stack = [refresh(NET, pos)];
      for (let step = 0; step < 150; step++) {
        const moves = pos.legalMoves();
        if (!moves.length) break;
        if (pos.ply && rand() < 0.3) {
          pos.unmake();
          stack.pop();
        } else {
          const m = moves[Math.floor(rand() * moves.length)];
          const next = new Int32Array(2 * FT);
          pos.make(m);
          push(NET, pos, m, stack[stack.length - 1], next);
          stack.push(next);
        }
        expect(Array.from(stack[stack.length - 1])).toEqual(Array.from(refresh(NET, pos)));
      }
    }
  });

  it("scores a position and its colour-flipped mirror the same", () => {
    for (const fen of randomFens(30, 1)) {
      const [board, side, castling, ep, ...rest] = fen.split(" ");
      const mirrored = [
        board.split("/").reverse().map((r) => r.replace(/[a-z]/gi, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()))).join("/"),
        side === "w" ? "b" : "w",
        castling === "-" ? "-" : castling.replace(/[a-z]/gi, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).split("").sort().join(""),
        ep === "-" ? "-" : ep[0] + (9 - Number(ep[1])),
        ...rest,
      ].join(" ");
      expect(evalFen(mirrored)).toBe(evalFen(fen));
    }
  });

  it("rejects a corrupt header, a truncated file and a flipped payload byte", () => {
    const bad = (f: (b: Uint8Array) => Uint8Array) => () => loadNet(f(BYTES.slice()));
    expect(bad((b) => (b.set([88, 88, 88, 88]), b))).toThrow(/bad header/);
    expect(bad((b) => b.subarray(0, b.length - 1))).toThrow(/checksum/);
    expect(bad((b) => b.subarray(0, 10))).toThrow(/too short/);
    expect(bad((b) => ((b[100] ^= 1), b))).toThrow(/checksum/);
    expect(bad((b) => ((b[12] = 7), b))).toThrow(/shapes/);
  });
});

describe("depth 5 search", () => {
  const engine = new Depth5(NET);

  it("returns a legal move within maxMs from 20 random positions", () => {
    for (const fen of randomFens(20, 4)) {
      const t0 = performance.now();
      const { move, info } = engine.search(fen, [], 300);
      const ms = performance.now() - t0;
      expect(new Chess(fen).moves({ verbose: true }).map((m) => m.lan)).toContain(Position.uci(move));
      expect(ms).toBeLessThan(300 * 1.25 + 100);
      expect(info.nodes).toBeGreaterThan(0);
      expect(info.depth).toBeGreaterThan(0);
    }
  }, 30_000);

  it("finds mate in one", () => {
    expect(Position.uci(engine.search("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", [], 500).move)).toBe("a1a8");
  });

  it("keeps the last proven move when an iteration runs out of time", () => {
    // the Python engine once played the first capture tried in an unfinished
    // iteration here (Nxg5, losing a knight); see ML-AI tests/test_chess_nnue.py
    const fen = "r1bqkb1r/ppp2p2/2n2n1p/4p1p1/P5P1/5P1N/1PPBP2P/RN1QKB1R w KQkq - 2 8";
    for (const ms of [50, 200, 1000]) expect(Position.uci(engine.search(fen, [], ms).move)).not.toBe("h3g5");
  });
});

describe("neuralMove", () => {
  it("returns SAN, UCI and a mate score on the arena's scale", async () => {
    const { neuralMove } = await import("./index");
    const { formatScore } = await import("../engine/search");
    const r = neuralMove("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", [], 500);
    expect([r.san, r.uci, formatScore(r.info.score)]).toEqual(["Ra8#", "a1a8", "M1"]);
  });
});
