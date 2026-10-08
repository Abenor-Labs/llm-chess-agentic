import { Position } from "./position";
import { analyze, materialBalance, MATE_THRESHOLD, type ScoredMove } from "./search";

export { Position, perft } from "./position";
export {
  analyze,
  scoreMoves,
  evaluate,
  formatScore,
  isMateScore,
  loosePieces,
  materialCount,
  MATE_SCORE,
  MATE_THRESHOLD,
  type Analysis,
  type AnalyzeOptions,
  type PieceThreat,
  type ScoredMove,
} from "./search";

/**
 * Engine-level verdict for a game that hit the wall-clock limit. Decisive only
 * when one side is up at least a rook's worth of material after the engine's
 * short search (or has a forced mate); otherwise the honest result is a draw.
 */
export function adjudicate(fen: string): { result: "1-0" | "0-1" | "1/2-1/2"; reason: string } {
  const pos = new Position(fen);
  const legal = pos.legalMoves();
  if (legal.length === 0) {
    if (!pos.inCheck()) return { result: "1/2-1/2", reason: "Stalemate" };
    return pos.side === 0
      ? { result: "0-1", reason: "Checkmate" }
      : { result: "1-0", reason: "Checkmate" };
  }
  const { moves } = analyze(fen, { depth: 2, maxMs: 1_000 });
  const best = moves[0]?.score ?? 0;
  const whiteScore = pos.side === 0 ? best : -best;
  const material = materialBalance(pos);
  const decisive = Math.abs(whiteScore) >= MATE_THRESHOLD || (Math.abs(whiteScore) >= 500 && Math.sign(material) === Math.sign(whiteScore));
  if (!decisive) return { result: "1/2-1/2", reason: "Time limit reached — adjudicated a draw (no decisive advantage)" };
  const winner = whiteScore > 0 ? "White" : "Black";
  return {
    result: whiteScore > 0 ? "1-0" : "0-1",
    reason: `Time limit reached — adjudicated for ${winner} (decisive advantage)`,
  };
}

/**
 * Picks a move for a baseline bot. `noiseCp` > 0 picks randomly among moves
 * within that many centipawns of the best, so bots don't play identical games.
 * `drawsByRepetition` flags moves that head toward a repetition draw — search
 * can't see game history, so a winning bot is steered away from them.
 */
export function pickEngineMove(
  fen: string,
  opts: {
    depth: number;
    maxMs?: number;
    noiseCp?: number;
    random?: () => number;
    drawsByRepetition?: (san: string) => boolean;
  },
): { move: ScoredMove; depth: number; nodes: number; considered: ScoredMove[] } {
  const analysis = analyze(fen, { depth: opts.depth, maxMs: opts.maxMs ?? 2_000 });
  if (analysis.moves.length === 0) throw new Error("No legal moves");
  if (opts.drawsByRepetition && analysis.moves[0].score > 0) {
    const keepPlaying = analysis.moves.filter((m) => !opts.drawsByRepetition!(m.move));
    if (keepPlaying.length) analysis.moves = keepPlaying;
  }
  const best = analysis.moves[0];
  const rand = opts.random ?? Math.random;
  const pool = opts.noiseCp
    ? analysis.moves.filter((m) => best.score - m.score <= opts.noiseCp!)
    : [best];
  const move = pool[Math.floor(rand() * pool.length)] ?? best;
  return { move, depth: analysis.depth, nodes: analysis.nodes, considered: analysis.moves.slice(0, 3) };
}
