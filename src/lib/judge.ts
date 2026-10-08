import type { Chess } from "chess.js";
import { resolveMove, moveCausesRepetition, type ResolvedMove } from "./chess";
import { analyze, formatScore, isMateScore, type Analysis } from "./engine";
import { modeConfig, type SkillMode } from "./modes";
import { GAME_RULES, ENGINE } from "./config";
import { isFatalError, ParseError, TimeoutError, ChessError } from "./errors";
import type { MoveReply } from "./ai";
import type { JudgeEvent, JudgeRecord } from "./judge-types";

/**
 * The judge sits between a model and the board. Its job is to get the MODEL'S
 * decision onto the board, not to substitute its own:
 *
 * - notation is forgiven: any spelling that maps to exactly one legal move is
 *   accepted ("e2e4", "0-0", "Nxe5+!")
 * - illegal or unreadable answers get specific feedback and another attempt
 * - a move the engine rates as a clear blunder (per the mode's threshold) gets
 *   ONE "are you sure?" with a concrete refutation; the second answer stands
 * - a side that is clearly winning gets one warning before repeating into a draw
 * - if a later attempt fails, the model's earlier legal move is played rather
 *   than costing the side a timeout
 *
 * Only when no attempt produced a legal move does the judge give up.
 */

export interface JudgeInput {
  /** The game with full history (needed for repetition checks). */
  chess: Chess;
  mode?: SkillMode | string | null;
  /** Asks the model for a move; `feedback` explains what was wrong last time. */
  ask: (feedback: string | null, signal: AbortSignal) => Promise<MoveReply>;
  /** Aborted when the ply deadline passes. */
  signal?: AbortSignal;
  /** Pre-computed engine analysis of the position (computed lazily otherwise). */
  analysis?: Analysis;
  maxAttempts?: number;
}

export interface Verdict extends ResolvedMove {
  reasoning: string;
  plan: string | null;
  judge: JudgeRecord;
}

/** Thrown when no attempt produced a legal move; carries what happened. */
export class JudgeFailedError extends ChessError {
  constructor(public readonly record: JudgeRecord, public readonly lastError: unknown) {
    super(
      `No legal move after ${record.attempts} attempt${record.attempts === 1 ? "" : "s"}${
        lastError instanceof Error ? ` (${lastError.message})` : ""
      }`,
      "JUDGE_FAILED",
    );
  }
}

const REPETITION_ADVANTAGE_CP = 200;

function stripSuffix(san: string): string {
  return san.replace(/[+#]+$/, "");
}

/** Short list of legal moves for feedback; full list if small. */
function legalList(chess: Chess): string {
  const moves = chess.moves();
  return moves.length <= 40 ? moves.join(", ") : `${moves.slice(0, 40).join(", ")} …`;
}

export async function judgeMove(input: JudgeInput): Promise<Verdict> {
  const { chess } = input;
  const cfg = modeConfig(input.mode);
  const maxAttempts = input.maxAttempts ?? GAME_RULES.MAX_JUDGE_ATTEMPTS;
  const fen = chess.fen();
  const events: JudgeEvent[] = [];
  let analysis = input.analysis;
  const getAnalysis = () =>
    (analysis ??= analyze(fen, { depth: ENGINE.JUDGE_DEPTH, maxMs: ENGINE.JUDGE_MAX_MS }));

  let feedback: string | null = null;
  let fallback: { resolved: ResolvedMove; reply: MoveReply } | null = null;
  let firstLegal: string | null = null;
  let guardUsed = false;
  let repetitionWarned = false;
  let lastError: unknown = null;
  let attempts = 0;
  const signal = input.signal ?? new AbortController().signal;

  const record = (extra: Partial<JudgeRecord> = {}): JudgeRecord => ({ attempts, events, ...extra });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal.aborted) break;
    attempts = attempt;
    const isLast = attempt === maxAttempts;

    let reply: MoveReply;
    try {
      reply = await input.ask(feedback, signal);
    } catch (err) {
      if (isFatalError(err)) throw err;
      lastError = err;
      if (err instanceof ParseError) {
        events.push({ type: "parse", attempt });
        feedback = `Your answer could not be read. Reply with ONLY the JSON object, e.g. {"reasoning": "...", "plan": "...", "move": "${chess.moves()[0]}"}.`;
      } else {
        const detail = err instanceof TimeoutError ? "timed out" : err instanceof Error ? err.message.slice(0, 160) : String(err);
        events.push({ type: "error", attempt, detail });
        feedback = null; // nothing the model did wrong; just ask again
      }
      continue;
    }

    const resolved = resolveMove(fen, reply.move);
    if (!resolved) {
      events.push({ type: "illegal", attempt, move: reply.move.slice(0, 20) });
      feedback = `"${reply.move}" is not a legal move in this position.${
        chess.inCheck() ? " You are in check and must get out of it." : ""
      } Choose exactly one of: ${legalList(chess)}.`;
      continue;
    }
    if (stripSuffix(reply.move.trim()) !== stripSuffix(resolved.san)) {
      events.push({ type: "notation", attempt, from: reply.move.slice(0, 20), to: resolved.san });
    }
    fallback = { resolved, reply };
    firstLegal ??= resolved.san;

    // Blunder guard: one reconsideration, with a concrete refutation.
    if (cfg.blunderGuardCp !== null && !guardUsed && !isLast) {
      const { moves } = getAnalysis();
      const best = moves[0];
      const chosen = moves.find((m) => m.move === resolved.san);
      if (best && chosen) {
        const loss = best.score - chosen.score;
        const bothMating = isMateScore(best.score) && isMateScore(chosen.score) && chosen.score > 0;
        if (loss >= cfg.blunderGuardCp && !bothMating) {
          guardUsed = true;
          const mate = isMateScore(chosen.score) && chosen.score < 0 ? "allowed" : isMateScore(best.score) && best.score > 0 ? "missed" : undefined;
          const refutation = punishingReply(chess, resolved.san);
          events.push({
            type: "blunder",
            attempt,
            move: resolved.san,
            lossCp: Math.min(loss, 99_999),
            ...(refutation ? { reply: refutation } : {}),
            ...(mate ? { mate } : {}),
          });
          const keep = `(you may keep ${resolved.san} if you are sure)`;
          feedback =
            mate === "allowed"
              ? `Before you commit to ${resolved.san}: it allows a forced checkmate${refutation ? ` — your opponent can start it with ${refutation}` : ""}. Check your king's safety, then answer again ${keep}.`
              : mate === "missed"
                ? `Before you commit to ${resolved.san}: you have a forced checkmate in this position. Look at checks and captures near the enemy king, then answer again ${keep}.`
                : `Before you commit to ${resolved.san}: a quick engine check rates it about ${(Math.min(loss, 2_000) / 100).toFixed(1)} pawns worse than your best option${
                    refutation ? ` — after ${resolved.san}, your opponent can answer ${refutation}` : ""
                  }. Re-check what is attacked and defended, then answer again ${keep}.`;
          continue;
        }
      }
    }

    // Don't let a clearly winning side stumble into a draw by repetition.
    if (!repetitionWarned && !isLast && moveCausesRepetition(chess, resolved.san)) {
      const advantage = getAnalysis().moves[0]?.score ?? 0;
      if (advantage >= REPETITION_ADVANTAGE_CP) {
        repetitionWarned = true;
        events.push({ type: "repetition", attempt, move: resolved.san, advantageCp: Math.min(advantage, 99_999) });
        feedback = `${resolved.san} repeats this position for the third time, which ends the game in an immediate draw — but you are clearly better (engine: ${formatScore(advantage)}). Choose a move that keeps playing for the win, unless you really want the draw.`;
        continue;
      }
    }

    return {
      ...resolved,
      reasoning: reply.reasoning,
      plan: reply.plan,
      judge: record(firstLegal !== resolved.san ? { reconsidered: true } : {}),
    };
  }

  if (fallback) {
    events.push({ type: "fallback", move: fallback.resolved.san });
    return {
      ...fallback.resolved,
      reasoning: fallback.reply.reasoning,
      plan: fallback.reply.plan,
      judge: record(),
    };
  }
  throw new JudgeFailedError(record(), lastError);
}

/** The opponent's best answer to `san`, in SAN, for blunder feedback. */
function punishingReply(chess: Chess, san: string): string | null {
  try {
    chess.move(san);
    const fen = chess.fen();
    chess.undo();
    return analyze(fen, { depth: 2, maxMs: 300 }).moves[0]?.move ?? null;
  } catch {
    return null;
  }
}
