/**
 * Post-game analysis math: turns a sequence of Stockfish evaluations into
 * per-move centipawn loss and accuracy (per-model aggregates are computed in SQL
 * by /api/analytics/accuracy). Pure and engine-agnostic so it can be unit-tested;
 * the actual engine runs in the browser (see src/hooks/use-game-analysis.ts).
 */

/** Evals beyond this magnitude are clamped for loss/blunder purposes ("winning is winning"). */
export const CP_CAP = 1000;

/** A move losing at least this many centipawns counts as a blunder. */
export const BLUNDER_CP = 300;

export type Color = "white" | "black";

export interface PlyEval {
  color: Color;
  /** Stockfish eval of the position AFTER this ply, from White's perspective, in centipawns. */
  evalCp: number;
}

export interface MoveAnalysis {
  evalCp: number;
  cpLoss: number;
  moveAccuracy: number;
}

/** Clamp a centipawn eval to [-CP_CAP, CP_CAP]. */
export function clampCp(cp: number): number {
  return Math.max(-CP_CAP, Math.min(CP_CAP, cp));
}

/**
 * White's win expectancy (0-100) for a White-perspective centipawn eval.
 * Logistic model used by Lichess; saturates for mate-scale evals.
 */
export function winPercent(cpWhite: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cpWhite)) - 1);
}

/** Win expectancy (0-100) from the moving side's perspective. */
export function moverWinPercent(cpWhite: number, color: Color): number {
  const white = winPercent(cpWhite);
  return color === "white" ? white : 100 - white;
}

/**
 * Per-move accuracy (0-100) from the drop in the mover's win expectancy.
 * Lichess accuracy formula; a move that holds or improves scores ~100.
 */
export function moveAccuracy(winBefore: number, winAfter: number): number {
  const raw = 103.1668 * Math.exp(-0.04354 * (winBefore - winAfter)) - 3.1669;
  return Math.max(0, Math.min(100, raw));
}

/**
 * Centipawn loss and accuracy for a single move, given the White-perspective
 * evals before and after it and which side moved.
 */
export function computeMoveLoss(params: {
  evalBeforeWhiteCp: number;
  evalAfterWhiteCp: number;
  color: Color;
}): { cpLoss: number; moveAccuracy: number } {
  const { evalBeforeWhiteCp, evalAfterWhiteCp, color } = params;
  const persp = color === "white" ? 1 : -1;

  // Centipawn loss from the mover's perspective, using capped evals so a single
  // decisive swing doesn't dominate the average.
  const before = clampCp(evalBeforeWhiteCp);
  const after = clampCp(evalAfterWhiteCp);
  const cpLoss = Math.max(0, Math.round(persp * (before - after)));

  const winBefore = moverWinPercent(evalBeforeWhiteCp, color);
  const winAfter = moverWinPercent(evalAfterWhiteCp, color);
  const acc = Math.round(moveAccuracy(winBefore, winAfter));

  return { cpLoss, moveAccuracy: acc };
}

/**
 * Analyzes a full game from the start-position eval plus the White-perspective
 * eval after every ply, returning per-move eval/cpLoss/accuracy in ply order.
 */
export function analyzeGame(startEvalWhiteCp: number, plies: PlyEval[]): MoveAnalysis[] {
  return plies.map((ply, i) => {
    const evalBeforeWhiteCp = i === 0 ? startEvalWhiteCp : plies[i - 1].evalCp;
    const { cpLoss, moveAccuracy: acc } = computeMoveLoss({
      evalBeforeWhiteCp,
      evalAfterWhiteCp: ply.evalCp,
      color: ply.color,
    });
    return { evalCp: Math.round(ply.evalCp), cpLoss, moveAccuracy: acc };
  });
}
