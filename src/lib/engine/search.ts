import {
  Position,
  WHITE,
  BLACK,
  PAWN,
  KNIGHT,
  BISHOP,
  ROOK,
  QUEEN,
  KING,
  FLAG_PROMO,
  typeOf,
  colorOf,
  rankOf,
  fileOf,
  type Move,
  type Side,
} from "./position";

/**
 * Alpha-beta search with quiescence over the 0x88 position. Strong enough to
 * catch every tactic a judge cares about (hung pieces, losing exchanges, short
 * mates) in well under a second, and to act as a baseline opponent.
 */

export const MATE_SCORE = 100_000;
/** Scores at or beyond this magnitude are forced mates. */
export const MATE_THRESHOLD = MATE_SCORE - 1_000;

export const PIECE_VALUE = [0, 100, 320, 330, 500, 900, 0];

// Piece-square tables (Michniewski "simplified evaluation"), written from
// White's point of view with rank 8 first, like a printed board.
const PST_PAWN = [
  0, 0, 0, 0, 0, 0, 0, 0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
  5, 5, 10, 25, 25, 10, 5, 5,
  0, 0, 0, 20, 20, 0, 0, 0,
  5, -5, -10, 0, 0, -10, -5, 5,
  5, 10, 10, -20, -20, 10, 10, 5,
  0, 0, 0, 0, 0, 0, 0, 0,
];
const PST_KNIGHT = [
  -50, -40, -30, -30, -30, -30, -40, -50,
  -40, -20, 0, 0, 0, 0, -20, -40,
  -30, 0, 10, 15, 15, 10, 0, -30,
  -30, 5, 15, 20, 20, 15, 5, -30,
  -30, 0, 15, 20, 20, 15, 0, -30,
  -30, 5, 10, 15, 15, 10, 5, -30,
  -40, -20, 0, 5, 5, 0, -20, -40,
  -50, -40, -30, -30, -30, -30, -40, -50,
];
const PST_BISHOP = [
  -20, -10, -10, -10, -10, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 10, 10, 5, 0, -10,
  -10, 5, 5, 10, 10, 5, 5, -10,
  -10, 0, 10, 10, 10, 10, 0, -10,
  -10, 10, 10, 10, 10, 10, 10, -10,
  -10, 5, 0, 0, 0, 0, 5, -10,
  -20, -10, -10, -10, -10, -10, -10, -20,
];
const PST_ROOK = [
  0, 0, 0, 0, 0, 0, 0, 0,
  5, 10, 10, 10, 10, 10, 10, 5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  -5, 0, 0, 0, 0, 0, 0, -5,
  0, 0, 0, 5, 5, 0, 0, 0,
];
const PST_QUEEN = [
  -20, -10, -10, -5, -5, -10, -10, -20,
  -10, 0, 0, 0, 0, 0, 0, -10,
  -10, 0, 5, 5, 5, 5, 0, -10,
  -5, 0, 5, 5, 5, 5, 0, -5,
  0, 0, 5, 5, 5, 5, 0, -5,
  -10, 5, 5, 5, 5, 5, 0, -10,
  -10, 0, 5, 0, 0, 0, 0, -10,
  -20, -10, -10, -5, -5, -10, -10, -20,
];
const PST_KING_MG = [
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -20, -30, -30, -40, -40, -30, -30, -20,
  -10, -20, -20, -20, -20, -20, -20, -10,
  20, 20, 0, 0, 0, 0, 20, 20,
  20, 30, 10, 0, 0, 10, 30, 20,
];
const PST_KING_EG = [
  -50, -40, -30, -20, -20, -30, -40, -50,
  -30, -20, -10, 0, 0, -10, -20, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -30, 0, 0, 0, 0, -30, -30,
  -50, -30, -30, -30, -30, -30, -30, -50,
];
const PST = [null, PST_PAWN, PST_KNIGHT, PST_BISHOP, PST_ROOK, PST_QUEEN];
const PHASE_WEIGHT = [0, 0, 1, 1, 2, 4, 0];
const MAX_PHASE = 24;

function pstIndex(sq: number, color: Side): number {
  const rank = rankOf(sq);
  return (color === WHITE ? 7 - rank : rank) * 8 + fileOf(sq);
}

/** Static evaluation in centipawns from the side-to-move's perspective. */
export function evaluate(pos: Position): number {
  let score = 0; // White's perspective
  let phase = 0;
  const bishops = [0, 0];
  const b = pos.board;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const p = b[sq];
    if (!p) continue;
    const type = typeOf(p);
    const color = colorOf(p);
    const sign = color === WHITE ? 1 : -1;
    phase += PHASE_WEIGHT[type];
    if (type === BISHOP) bishops[color >> 3]++;
    if (type !== KING) score += sign * (PIECE_VALUE[type] + PST[type]![pstIndex(sq, color)]);
  }
  phase = Math.min(phase, MAX_PHASE);
  for (const color of [WHITE, BLACK] as const) {
    const idx = pstIndex(pos.kings[color >> 3], color);
    const king = (PST_KING_MG[idx] * phase + PST_KING_EG[idx] * (MAX_PHASE - phase)) / MAX_PHASE;
    score += (color === WHITE ? 1 : -1) * king;
  }
  if (bishops[0] >= 2) score += 30;
  if (bishops[1] >= 2) score -= 30;
  return Math.round(pos.side === WHITE ? score : -score);
}

/** Pure material balance (pawn = 100) from White's perspective. */
export function materialBalance(pos: Position): number {
  let score = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const p = pos.board[sq];
    if (p) score += (colorOf(p) === WHITE ? 1 : -1) * PIECE_VALUE[typeOf(p)];
  }
  return score;
}

/** Most-valuable-victim / least-valuable-attacker ordering key. */
function orderKey(m: Move): number {
  let key = 0;
  if (m.captured) key += 10 * PIECE_VALUE[typeOf(m.captured)] - PIECE_VALUE[typeOf(m.piece)] + 10_000;
  if (m.flags & FLAG_PROMO) key += PIECE_VALUE[m.promotion] + 9_000;
  return key;
}

function sortMoves(moves: Move[]): Move[] {
  return moves.sort((a, b) => orderKey(b) - orderKey(a));
}

class SearchAbort extends Error {}

interface SearchState {
  nodes: number;
  maxNodes: number;
  deadline: number;
}

const MAX_QDEPTH = 8;
// Full check evasions only near the horizon; deeper they explode the tree.
const MAX_QCHECK_DEPTH = 2;
// Delta pruning: a capture that can't lift the score near alpha isn't searched.
const DELTA_MARGIN = 200;

function quiesce(pos: Position, alpha: number, beta: number, ply: number, qdepth: number, st: SearchState): number {
  if (++st.nodes > st.maxNodes || ((st.nodes & 2047) === 0 && Date.now() > st.deadline)) throw new SearchAbort();
  const inCheck = pos.inCheck();

  // In check every evasion must be searched, otherwise a mate looks like a
  // "quiet" position and stand-pat would hide it.
  if (inCheck && qdepth < MAX_QCHECK_DEPTH) {
    let legal = 0;
    let best = -MATE_SCORE + ply;
    for (const m of sortMoves(pos.pseudoMoves())) {
      if (!pos.make(m)) continue;
      legal++;
      const s = -quiesce(pos, -beta, -alpha, ply + 1, qdepth + 1, st);
      pos.unmake();
      if (s > best) best = s;
      if (s > alpha) alpha = s;
      if (alpha >= beta) break;
    }
    return legal === 0 ? -MATE_SCORE + ply : best;
  }

  const stand = evaluate(pos);
  if (stand >= beta || qdepth >= MAX_QDEPTH) return stand;
  if (stand > alpha) alpha = stand;
  for (const m of sortMoves(pos.pseudoMoves(true))) {
    const gain = PIECE_VALUE[typeOf(m.captured)] + (m.promotion ? PIECE_VALUE[m.promotion] - 100 : 0);
    if (stand + gain + DELTA_MARGIN < alpha) continue;
    if (!pos.make(m)) continue;
    const s = -quiesce(pos, -beta, -alpha, ply + 1, qdepth + 1, st);
    pos.unmake();
    if (s >= beta) return s;
    if (s > alpha) alpha = s;
  }
  return alpha;
}

function search(pos: Position, depth: number, alpha: number, beta: number, ply: number, st: SearchState): number {
  if (pos.halfmove >= 100 || pos.insufficientMaterial()) return 0;
  // At the horizon, quiescence takes over (it searches check evasions itself,
  // to a bounded depth — extending here could recurse through check chains).
  if (depth <= 0) return quiesce(pos, alpha, beta, ply, 0, st);
  const inCheck = pos.inCheck();
  if (++st.nodes > st.maxNodes || ((st.nodes & 2047) === 0 && Date.now() > st.deadline)) throw new SearchAbort();

  let legal = 0;
  let best = -Infinity;
  for (const m of sortMoves(pos.pseudoMoves())) {
    if (!pos.make(m)) continue;
    legal++;
    // Check extension: never drop into stand-pat while in check.
    const s = -search(pos, inCheck ? depth : depth - 1, -beta, -alpha, ply + 1, st);
    pos.unmake();
    if (s > best) best = s;
    if (s > alpha) alpha = s;
    if (alpha >= beta) break;
  }
  if (legal === 0) return inCheck ? -MATE_SCORE + ply : 0;
  return best;
}

export interface ScoredMove {
  /** SAN, e.g. "Nf3". */
  move: string;
  /** UCI, e.g. "g1f3". */
  uci: string;
  /** Centipawns from the mover's perspective; positive is good for the mover. */
  score: number;
}

export interface AnalyzeOptions {
  /** Plies searched below each root move (before quiescence). Default 2. */
  depth?: number;
  /** Abort deeper iterations after this long; the last completed depth is kept. */
  maxMs?: number;
  maxNodes?: number;
}

export interface Analysis {
  /** Every legal move, best first. */
  moves: ScoredMove[];
  /** Deepest fully completed depth. */
  depth: number;
  nodes: number;
}

/**
 * Scores every legal root move with a full-window search (exact scores, not
 * just the best), using iterative deepening so a time cap still returns the
 * last complete depth. Depth 1 (plus quiescence) is always completed.
 */
export function analyze(fen: string, opts: AnalyzeOptions = {}): Analysis {
  const pos = new Position(fen);
  const legal = pos.legalMoves();
  const sans = legal.map((m) => pos.san(m, legal));
  const maxDepth = Math.max(1, opts.depth ?? 2);
  const deadline = Date.now() + (opts.maxMs ?? 1_500);
  let result: ScoredMove[] = [];
  let completed = 0;
  let totalNodes = 0;

  for (let depth = 1; depth <= maxDepth; depth++) {
    // The first iteration may not be aborted, so it always produces scores.
    const st: SearchState = {
      nodes: 0,
      maxNodes: depth === 1 ? Infinity : opts.maxNodes ?? Infinity,
      deadline: depth === 1 ? Infinity : deadline,
    };
    try {
      const scored = legal.map((m, i) => {
        pos.make(m);
        const s = -search(pos, depth - 1, -MATE_SCORE * 2, MATE_SCORE * 2, 1, st);
        pos.unmake();
        return { move: sans[i], uci: Position.uci(m), score: s };
      });
      result = scored.sort((a, b) => b.score - a.score);
      completed = depth;
      totalNodes += st.nodes;
    } catch (e) {
      if (!(e instanceof SearchAbort)) throw e;
      pos.unmakeTo(0); // unwind any half-made moves from the aborted search
      totalNodes += st.nodes;
      break;
    }
  }
  return { moves: result, depth: completed, nodes: totalNodes };
}

/** Back-compat helper: every legal move scored, best first. */
export function scoreMoves(fen: string, depth = 2, maxMs?: number): ScoredMove[] {
  return analyze(fen, { depth, maxMs }).moves;
}

export function isMateScore(score: number): boolean {
  return Math.abs(score) >= MATE_THRESHOLD;
}

/** Human-friendly score from the mover's perspective: "+1.3", "-0.4", "M3", "-M2". */
export function formatScore(score: number): string {
  if (isMateScore(score)) {
    const plies = MATE_SCORE - Math.abs(score);
    const moves = Math.max(1, Math.ceil(plies / 2));
    return `${score > 0 ? "" : "-"}M${moves}`;
  }
  const pawns = score / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(1)}`;
}

// ---------------------------------------------------------------------------
// Static tactical brief (no search): what is attacked, what is loose.
// ---------------------------------------------------------------------------

const PIECE_NAMES = ["", "pawn", "knight", "bishop", "rook", "queen", "king"];

export interface PieceThreat {
  square: string;
  piece: string;
  /** Value at risk in centipawns (by the cheapest attacker's exchange). */
  atRisk: number;
  attackers: string[];
  defended: boolean;
}

function squareLabel(sq: number): string {
  return "abcdefgh"[fileOf(sq)] + (rankOf(sq) + 1);
}

/**
 * Pieces of `side` that the opponent can win material from right now: either
 * undefended and attacked, or attacked by a cheaper piece. Kings are skipped.
 */
export function loosePieces(fen: string, side: "white" | "black"): PieceThreat[] {
  const pos = new Position(fen);
  const us: Side = side === "white" ? WHITE : BLACK;
  const them = (us ^ 8) as Side;
  const out: PieceThreat[] = [];
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const p = pos.board[sq];
    if (!p || colorOf(p) !== us || typeOf(p) === KING) continue;
    const attackers = pos.attackers(sq, them);
    if (!attackers.length) continue;
    const value = PIECE_VALUE[typeOf(p)];
    const defended = pos.attackers(sq, us).length > 0;
    const cheapest = Math.min(...attackers.map((a) => PIECE_VALUE[typeOf(pos.board[a])] || 10_000));
    const atRisk = defended ? value - cheapest : value;
    if (atRisk <= 0) continue;
    out.push({
      square: squareLabel(sq),
      piece: PIECE_NAMES[typeOf(p)],
      atRisk,
      attackers: attackers.map((a) => `${PIECE_NAMES[typeOf(pos.board[a])]} on ${squareLabel(a)}`),
      defended,
    });
  }
  return out.sort((a, b) => b.atRisk - a.atRisk);
}

/** Static exchange-free material count, in pawns, per side. */
export function materialCount(fen: string): { white: number; black: number } {
  const pos = new Position(fen);
  const totals = { white: 0, black: 0 };
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const p = pos.board[sq];
    if (!p) continue;
    const pawns = [0, 1, 3, 3, 5, 9, 0][typeOf(p)];
    if (colorOf(p) === WHITE) totals.white += pawns;
    else totals.black += pawns;
  }
  return totals;
}

export { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING };
