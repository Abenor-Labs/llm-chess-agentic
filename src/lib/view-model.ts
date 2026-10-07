import { Chess } from "chess.js";
import { STARTING_FEN } from "./chess";
import { BLUNDER_CP } from "./analysis";
import type { JudgeRecord } from "./judge-types";

/**
 * Pure helpers that turn API data into what the game screen shows. Kept free
 * of React so they can be unit-tested.
 */

export interface PlyView {
  index: number;
  san: string;
  color: "white" | "black";
  moveNumber: number;
  from: string;
  to: string;
  fenAfter: string;
  /** Square of the king left in check after this ply, if any. */
  checkSquare: string | null;
}

/**
 * Replays the stored moves to recover from/to squares (for highlighting) and
 * check state. Stops at the first move that doesn't replay, so a corrupted row
 * never breaks the board.
 */
export function buildPlies(moves: ReadonlyArray<{ moveSan: string; color: "white" | "black"; moveNumber: number; fenAfter: string }>): PlyView[] {
  const chess = new Chess();
  const out: PlyView[] = [];
  for (const [index, m] of moves.entries()) {
    let played;
    try {
      played = chess.move(m.moveSan);
    } catch {
      break;
    }
    let checkSquare: string | null = null;
    if (chess.inCheck()) {
      const turn = chess.turn();
      for (const row of chess.board()) {
        for (const sq of row) if (sq?.type === "k" && sq.color === turn) checkSquare = sq.square;
      }
    }
    out.push({ index, san: played.san, color: m.color, moveNumber: m.moveNumber, from: played.from, to: played.to, fenAfter: m.fenAfter, checkSquare });
  }
  return out;
}

/** FEN after `count` plies (0 = start). */
export function fenAt(plies: PlyView[], count: number): string {
  if (count <= 0 || plies.length === 0) return STARTING_FEN;
  return plies[Math.min(count, plies.length) - 1].fenAfter;
}

export type MoveClass = "blunder" | "mistake" | "inaccuracy" | "good" | null;

export const MOVE_CLASS_THRESHOLDS = { inaccuracy: 60, mistake: 150, blunder: BLUNDER_CP } as const;

export function classifyMove(cpLoss: number | null | undefined): MoveClass {
  if (cpLoss == null) return null;
  if (cpLoss >= MOVE_CLASS_THRESHOLDS.blunder) return "blunder";
  if (cpLoss >= MOVE_CLASS_THRESHOLDS.mistake) return "mistake";
  if (cpLoss >= MOVE_CLASS_THRESHOLDS.inaccuracy) return "inaccuracy";
  return "good";
}

export const MOVE_CLASS_SYMBOL: Record<Exclude<MoveClass, null | "good">, string> = {
  blunder: "??",
  mistake: "?",
  inaccuracy: "?!",
};

/** Material difference in pawns from White's view, plus each side's captured pieces. */
export function materialSummary(fen: string): { diff: number; capturedByWhite: string[]; capturedByBlack: string[] } {
  const start: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const value: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  const counts = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 } as Record<string, number>, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } as Record<string, number> };
  const placement = fen.split(" ")[0] ?? "";
  for (const ch of placement) {
    const lower = ch.toLowerCase();
    if (!(lower in start)) continue;
    counts[ch === lower ? "b" : "w"][lower]++;
  }
  let diff = 0;
  const capturedByWhite: string[] = [];
  const capturedByBlack: string[] = [];
  for (const piece of ["q", "r", "b", "n", "p"]) {
    diff += (counts.w[piece] - counts.b[piece]) * value[piece];
    // Promotions can push a count above the start; never show negative captures.
    for (let i = 0; i < Math.max(0, start[piece] - counts.b[piece]); i++) capturedByWhite.push(piece);
    for (let i = 0; i < Math.max(0, start[piece] - counts.w[piece]); i++) capturedByBlack.push(piece);
  }
  return { diff, capturedByWhite, capturedByBlack };
}

export function resultHeadline(
  result: "1-0" | "0-1" | "1/2-1/2" | null,
  whiteName: string,
  blackName: string,
): string {
  if (result === "1-0") return `${whiteName} wins`;
  if (result === "0-1") return `${blackName} wins`;
  if (result === "1/2-1/2") return "Draw";
  return "No result";
}

/** "850ms", "3.2s", "1m 05s". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  const s = Math.round(ms / 1_000);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** One-line summary of what the judge did, or null when nothing notable happened. */
export function judgeSummary(judge: JudgeRecord | null | undefined): string | null {
  if (!judge || judge.engine) return null;
  const parts: string[] = [];
  if (judge.attempts > 1) parts.push(`${judge.attempts} attempts`);
  if (judge.events.some((e) => e.type === "blunder")) parts.push(judge.reconsidered ? "reconsidered after a blunder warning" : "kept its move after a blunder warning");
  if (judge.events.some((e) => e.type === "repetition")) parts.push("warned about a repetition draw");
  if (judge.events.some((e) => e.type === "fallback")) parts.push("earlier legal move kept");
  if (parts.length === 0 && judge.events.some((e) => e.type === "notation")) parts.push("notation corrected");
  return parts.length ? parts.join(" · ") : null;
}

/** Per-side aggregate over analyzed moves (null if none are analyzed yet). */
export function sideAccuracy(moves: ReadonlyArray<{ color: "white" | "black"; moveAccuracy: number | null; cpLoss: number | null }>, color: "white" | "black") {
  const mine = moves.filter((m) => m.color === color && m.moveAccuracy != null && m.cpLoss != null);
  if (mine.length === 0) return null;
  const accuracy = mine.reduce((s, m) => s + m.moveAccuracy!, 0) / mine.length;
  const acpl = mine.reduce((s, m) => s + m.cpLoss!, 0) / mine.length;
  return {
    accuracy: Math.round(accuracy * 10) / 10,
    acpl: Math.round(acpl),
    blunders: mine.filter((m) => classifyMove(m.cpLoss) === "blunder").length,
  };
}
