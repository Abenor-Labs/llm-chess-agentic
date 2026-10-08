import type { Chess } from "chess.js";
import { requestMove, providerOf, type ApiKeys } from "./ai";
import { judgeMove } from "./judge";
import { revisitsPosition } from "./chess";
import { analyze, formatScore, pickEngineMove } from "./engine";
import { modeConfig, type SkillMode } from "./modes";
import { ENGINE } from "./config";
import type { JudgeRecord } from "./judge-types";

/**
 * Built-in engine players. They need no API key, cost nothing, and give the
 * rating pool fixed anchors: an LLM's ELO means more once it has been measured
 * against a random mover and a few search depths.
 */
export const LOCAL_BOTS: Record<string, { name: string; depth: number; noiseCp: number; maxMs: number; blurb: string }> = {
  "local/random": { name: "Random Mover", depth: 0, noiseCp: 0, maxMs: 0, blurb: "Plays a uniformly random legal move." },
  "local/greedy": { name: "Greedy Grabber", depth: 1, noiseCp: 0, maxMs: 500, blurb: "Grabs material: one ply plus capture search." },
  "local/engine-2": { name: "Arena Engine (depth 2)", depth: 2, noiseCp: 25, maxMs: 1_500, blurb: "Two-ply alpha-beta with quiescence." },
  "local/engine-4": { name: "Arena Engine (depth 4)", depth: 4, noiseCp: 0, maxMs: 3_000, blurb: "Four-ply alpha-beta with quiescence." },
};

export interface TurnInput {
  modelId: string;
  /** The game with full history. */
  chess: Chess;
  color: "white" | "black";
  mode: SkillMode | string;
  keys: ApiKeys;
  /** This side's plan from its previous move. */
  previousPlan: string | null;
  /** Aborted at the ply deadline. */
  signal: AbortSignal;
  random?: () => number;
}

export interface TurnResult {
  san: string;
  uci: string;
  reasoning: string;
  plan: string | null;
  judge: JudgeRecord;
  thinkMs: number;
}

export async function playTurn(input: TurnInput): Promise<TurnResult> {
  const started = Date.now();
  if (providerOf(input.modelId) === "local") {
    return { ...playLocal(input), thinkMs: Date.now() - started };
  }

  const fen = input.chess.fen();
  const cfg = modeConfig(input.mode);
  // Only search when the mode will use it (hints now, or the guard later).
  const analysis = cfg.hints ? analyze(fen, { depth: ENGINE.JUDGE_DEPTH, maxMs: ENGINE.JUDGE_MAX_MS }) : undefined;
  const legalMoves = input.chess.moves();
  const history = input.chess.history();

  const verdict = await judgeMove({
    chess: input.chess,
    mode: input.mode,
    signal: input.signal,
    analysis,
    ask: (feedback, signal) =>
      requestMove(
        input.modelId,
        {
          fen,
          color: input.color,
          legalMoves,
          history,
          mode: input.mode,
          previousPlan: input.previousPlan,
          candidates: analysis?.moves,
          feedback,
        },
        { keys: input.keys, signal },
      ),
  });

  return {
    san: verdict.san,
    uci: verdict.uci,
    reasoning: verdict.reasoning,
    plan: verdict.plan,
    judge: verdict.judge,
    thinkMs: Date.now() - started,
  };
}

function playLocal(input: TurnInput): Omit<TurnResult, "thinkMs"> {
  const bot = LOCAL_BOTS[input.modelId];
  if (!bot) throw new Error(`Unknown built-in player ${input.modelId}`);
  const rand = input.random ?? Math.random;
  const fen = input.chess.fen();

  if (bot.depth === 0) {
    const moves = input.chess.moves({ verbose: true });
    if (moves.length === 0) throw new Error("No legal moves");
    const m = moves[Math.floor(rand() * moves.length)];
    return {
      san: m.san,
      uci: m.from + m.to + (m.promotion ?? ""),
      reasoning: `Picked at random from ${moves.length} legal moves.`,
      plan: null,
      judge: { attempts: 1, events: [] },
    };
  }

  const { move, depth, nodes, considered } = pickEngineMove(fen, {
    depth: bot.depth,
    maxMs: bot.maxMs,
    noiseCp: bot.noiseCp,
    random: rand,
    drawsByRepetition: revisitsPosition(input.chess),
  });
  const alternatives = considered.filter((c) => c.move !== move.move).slice(0, 2);
  return {
    san: move.move,
    uci: move.uci,
    reasoning: `Searched ${nodes.toLocaleString("en-US")} positions to depth ${depth}; ${move.move} scores ${formatScore(move.score)}${
      alternatives.length ? ` (next best: ${alternatives.map((a) => `${a.move} ${formatScore(a.score)}`).join(", ")})` : ""
    }.`,
    plan: null,
    judge: { attempts: 1, events: [], engine: { depth, nodes, score: formatScore(move.score) } },
  };
}
