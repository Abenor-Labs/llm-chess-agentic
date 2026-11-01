/**
 * "depth 5" search, ported from ML-AI reasoning_harness/chess_nnue/engine.py
 * ("full" mode): iterative deepening with aspiration windows, PVS, a
 * transposition table, killers + history, null move, late move reductions,
 * check extension and quiescence with MVV-LVA, over the arena's Position.
 */
import { Position, KING, PAWN, typeOf, colorOf, type Move, type Side } from "../engine/position";
import { FT, evaluate, push, refresh, type Acc, type Net } from "./nnue";

export const MATE = 30000;
const INF = 32000;
const VAL = [0, 100, 320, 330, 500, 900, 0];
const TT_SIZE = 1 << 17;

class Timeout extends Error {}

// Zobrist keys from a fixed-seed generator; two 32-bit halves make a 53-bit Map key.
const ZLO = new Uint32Array(16 * 128 + 16 + 8 + 1);
const ZHI = new Uint32Array(ZLO.length);
{
  let s = 0x9e3779b9;
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
  for (let i = 0; i < ZLO.length; i++) {
    ZLO[i] = next();
    ZHI[i] = next() & 0x1fffff;
  }
}
const Z_CASTLE = 16 * 128;
const Z_EP = Z_CASTLE + 16;
const Z_SIDE = Z_EP + 8;

/** Position key: pieces, side, castling, and the en passant file only when a capture there is possible. */
export function positionKey(pos: Position): number {
  let lo = 0;
  let hi = 0;
  const b = pos.board;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    if (b[sq]) {
      lo ^= ZLO[b[sq] * 128 + sq];
      hi ^= ZHI[b[sq] * 128 + sq];
    }
  }
  lo ^= ZLO[Z_CASTLE + pos.castling];
  hi ^= ZHI[Z_CASTLE + pos.castling];
  if (pos.ep >= 0) {
    const from = pos.side ? pos.ep + 16 : pos.ep - 16;
    const pawn = PAWN | pos.side;
    if ((!((from - 1) & 0x88) && b[from - 1] === pawn) || (!((from + 1) & 0x88) && b[from + 1] === pawn)) {
      lo ^= ZLO[Z_EP + (pos.ep & 7)];
      hi ^= ZHI[Z_EP + (pos.ep & 7)];
    }
  }
  if (pos.side) {
    lo ^= ZLO[Z_SIDE];
    hi ^= ZHI[Z_SIDE];
  }
  return hi * 4294967296 + (lo >>> 0);
}

const sameMove = (a: Move | null | undefined, b: Move) =>
  !!a && a.from === b.from && a.to === b.to && a.promotion === b.promotion;

const mvvLva = (m: Move) => 10 * (typeOf(m.captured) || 1) - typeOf(m.piece);

export interface SearchInfo {
  depth: number;
  nodes: number;
  score: number;
  ms: number;
}

type TTEntry = { depth: number; flag: number; score: number; move: Move };

export class Depth5 {
  private tt = new Map<number, TTEntry>();
  private evals = new Map<number, number>();
  private pos!: Position;
  private accs: Acc[] = [];
  private nodes = 0;
  private deadline = 0;
  private hardDeadline = 0;
  private done = 0;
  private rootBest: Move | null = null;
  private prevBest: Move | null = null;
  private killers: Move[][] = [];
  private history = new Map<number, number>();
  private seen = new Set<number>();
  private path: number[] = [];

  constructor(private net: Net, private now: () => number = () => performance.now()) {}

  /**
   * Best move for `fen`. `historyFens` are the positions before it in the game
   * (they count as repetitions). Stops at maxMs once a root move has a score,
   * and unconditionally at maxMs * 1.25.
   */
  search(fen: string, historyFens: string[], maxMs: number, maxDepth = 64): { move: Move; info: SearchInfo } {
    const t0 = this.now();
    this.pos = new Position(fen);
    this.deadline = t0 + maxMs;
    this.hardDeadline = this.deadline + maxMs / 4;
    this.nodes = 0;
    this.killers = Array.from({ length: 128 }, () => []);
    this.history.clear();
    this.path = [];
    this.seen = new Set(historyFens.map((f) => positionKey(new Position(f))));
    refresh(this.net, this.pos, this.acc(0));
    const legal = this.pos.legalMoves();
    if (legal.length === 0) throw new Error("No legal moves");
    let best = this.order(legal, null, 0)[0];
    let score = 0;
    this.done = 0;
    this.rootBest = this.prevBest = null;
    try {
      for (let depth = 1; depth <= maxDepth; depth++) {
        this.rootBest = null;
        let s: number;
        if (depth >= 4) {
          let window = 40;
          for (;;) {
            const lo = score - window;
            const hi = score + window;
            s = this.negamax(depth, lo, hi, 0, true);
            if (lo < s && s < hi) break;
            window *= 4;
            if (window > 2000) {
              s = this.negamax(depth, -INF, INF, 0, true);
              break;
            }
          }
        } else {
          s = this.negamax(depth, -INF, INF, 0, true);
        }
        score = s;
        this.done = depth;
        best = this.prevBest = this.rootBest ?? best;
        if (Math.abs(score) >= MATE - 100 || legal.length === 1) break;
      }
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      this.pos.unmakeTo(0);
      if (this.rootBest) best = this.rootBest;
    }
    return { move: best, info: { depth: this.done, nodes: this.nodes, score, ms: this.now() - t0 } };
  }

  private acc(ply: number): Acc {
    return (this.accs[ply] ??= new Int32Array(2 * FT));
  }

  private checkTime() {
    this.nodes++;
    // stop once a root move has a searched score; past the hard limit, stop regardless
    if ((this.nodes & 1023) === 0) {
      const now = this.now();
      if ((now > this.deadline && (this.done || this.rootBest)) || now > this.hardDeadline) throw new Timeout();
    }
  }

  private staticEval(key: number, ply: number): number {
    let stand = this.evals.get(key);
    if (stand === undefined) {
      stand = evaluate(this.net, this.acc(ply), this.pos.side >> 3);
      if (this.evals.size >= TT_SIZE) this.evals.clear();
      this.evals.set(key, stand);
    }
    return stand;
  }

  private order(moves: Move[], ttMove: Move | null, ply: number): Move[] {
    const killers = ply < this.killers.length ? this.killers[ply] : [];
    const side = this.pos.side;
    const key = (m: Move) => {
      if (sameMove(ttMove, m)) return -10_000_000;
      if (m.captured) return -1_000_000 - mvvLva(m);
      if (m.promotion) return -900_000;
      if (killers.some((k) => sameMove(k, m))) return -800_000;
      return -(this.history.get(side * 4096 + m.from * 128 + m.to) ?? 0);
    };
    const keyed = moves.map((m) => [key(m), m] as const);
    keyed.sort((a, b) => a[0] - b[0]);
    return keyed.map((k) => k[1]);
  }

  /** Makes a legal move and updates the next ply's accumulators. */
  private make(m: Move, ply: number): void {
    this.pos.make(m);
    push(this.net, this.pos, m, this.acc(ply), this.acc(ply + 1));
  }

  private qsearch(alpha: number, beta: number, ply: number, qply: number): number {
    this.checkTime();
    const pos = this.pos;
    const inCheck = qply < 4 && pos.inCheck(); // deep in quiescence, a check is just stood on
    let stand = 0;
    let moves: Move[];
    if (!inCheck) {
      stand = this.staticEval(positionKey(pos), ply);
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
      moves = pos.pseudoMoves(true).filter((m) => m.captured && this.legal(m));
      if (!moves.length) return alpha;
      moves.sort((a, b) => mvvLva(b) - mvvLva(a));
    } else {
      moves = pos.legalMoves();
      if (!moves.length) return -MATE + ply;
      moves = this.order(moves, null, ply);
    }
    const them = (pos.side ^ 8) as Side;
    for (const m of moves) {
      if (!inCheck && !m.promotion) {
        const victim = VAL[typeOf(m.captured)];
        if (stand + victim + 200 < alpha) continue; // delta pruning
        if (victim < VAL[typeOf(m.piece)] && pos.attacked(m.to, them)) continue; // likely losing capture
      }
      this.make(m, ply);
      const score = -this.qsearch(-beta, -alpha, ply + 1, qply + 1);
      pos.unmake();
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  private legal(m: Move): boolean {
    if (!this.pos.make(m)) return false;
    this.pos.unmake();
    return true;
  }

  private negamax(depth: number, alpha: number, beta: number, ply: number, nullOk: boolean): number {
    const pos = this.pos;
    const key = positionKey(pos);
    if (ply && (pos.halfmove >= 100 || this.seen.has(key) || this.path.includes(key))) return 0;
    const inCheck = pos.inCheck();
    if (inCheck) depth++;
    if (depth <= 0) return this.qsearch(alpha, beta, ply, 0);
    this.checkTime();
    const pvNode = beta - alpha > 1;
    let ttMove: Move | null = null;
    const e = this.tt.get(key);
    if (e) {
      ttMove = e.move;
      if (e.depth >= depth && !pvNode && ply) {
        if (e.flag === 0 || (e.flag === 1 && e.score >= beta) || (e.flag === 2 && e.score <= alpha)) return e.score;
      }
    }
    if (nullOk && !pvNode && !inCheck && depth >= 3 && ply && this.hasPieces() && this.staticEval(key, ply) >= beta) {
      const ep = pos.ep;
      pos.side = (pos.side ^ 8) as Side;
      pos.ep = -1;
      pos.halfmove++;
      this.acc(ply + 1).set(this.acc(ply));
      this.path.push(-1);
      let score: number;
      try {
        score = -this.negamax(depth - 1 - (2 + Math.floor(depth / 6)), -beta, -beta + 1, ply + 1, false);
      } finally {
        this.path.pop();
        pos.halfmove--;
        pos.ep = ep;
        pos.side = (pos.side ^ 8) as Side;
      }
      if (score >= beta) return score >= MATE - 1000 ? beta : score;
    }
    let moves = pos.legalMoves();
    if (!moves.length) return inCheck ? -MATE + ply : 0;
    // at the root, last iteration's best move is searched first
    moves = this.order(moves, ply === 0 ? this.prevBest : ttMove, ply);
    let best = -INF;
    let bestMove = moves[0];
    const a0 = alpha;
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const quiet = !m.captured && !m.promotion;
      this.make(m, ply);
      this.path.push(key);
      let score: number;
      if (i === 0) {
        score = -this.negamax(depth - 1, -beta, -alpha, ply + 1, true);
      } else {
        let r = 0;
        if (depth >= 3 && i >= 3 && quiet && !inCheck && !pos.inCheck()) {
          r = 1 + (i >= 8 ? 1 : 0) + (depth >= 6 ? 1 : 0);
          if (pvNode) r--;
        }
        score = -this.negamax(depth - 1 - r, -alpha - 1, -alpha, ply + 1, true);
        if (score > alpha && r) score = -this.negamax(depth - 1, -alpha - 1, -alpha, ply + 1, true);
        if (alpha < score && score < beta) score = -this.negamax(depth - 1, -beta, -alpha, ply + 1, true);
      }
      this.path.pop();
      pos.unmake();
      // only a move that beats the window counts, so an unfinished
      // iteration never replaces the last best with an unproven move
      if (ply === 0 && score > alpha) this.rootBest = m;
      if (score > best) {
        best = score;
        bestMove = m;
      }
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        if (quiet) {
          const ks = this.killers[ply];
          if (ks && !ks.some((k) => sameMove(k, m))) {
            ks.unshift(m);
            ks.length = Math.min(ks.length, 2);
          }
          const hk = pos.side * 4096 + m.from * 128 + m.to;
          this.history.set(hk, (this.history.get(hk) ?? 0) + depth * depth);
        }
        break;
      }
    }
    const flag = best >= beta ? 1 : best <= a0 ? 2 : 0;
    if (this.tt.size >= TT_SIZE) this.tt.clear();
    this.tt.set(key, { depth, flag, score: best, move: bestMove });
    return best;
  }

  private hasPieces(): boolean {
    const b = this.pos.board;
    const us = this.pos.side;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) {
        sq += 7;
        continue;
      }
      const p = b[sq];
      if (p && colorOf(p) === us && typeOf(p) !== PAWN && typeOf(p) !== KING) return true;
    }
    return false;
  }
}
