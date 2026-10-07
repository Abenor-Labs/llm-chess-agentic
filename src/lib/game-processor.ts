import { db } from "@/db";
import { games, moves, models, type Game } from "@/db/schema";
import { and, asc, desc, eq, isNull, lt, or, like, sql } from "drizzle-orm";
import { loadGame, gameStatus, toPgn, getMoveNumber, type GameResult } from "./chess";
import { adjudicate } from "./engine";
import { playTurn } from "./players";
import { providerOf, isKeyedProvider, resolveKey, PROVIDER_LABEL, type ApiKeys } from "./ai";
import { calculateNewElo, outcomeFromResult } from "./elo";
import { isRatedPairing } from "./modes";
import { GAME_RULES } from "./config";
import { decryptSecret } from "./crypto";
import { APIKeyError, ModelUnavailableError, RateLimitError } from "./errors";
import { JudgeFailedError } from "./judge";

/** "moved": applied, keep going. "ended": applied and the game is over. "stop": nothing applied. */
type PlyOutcome = "moved" | "ended" | "stop";

export interface ProcessSummary {
  /** Plies applied by this call. */
  plies: number;
  /** Set when the match was deleted before any move (bad key, unknown model…). */
  abortedReason?: string;
}
type Color = "white" | "black";

/**
 * Processes one game: atomically claims it, plays plies back-to-back until the
 * tick budget is spent or the game stops, then releases the claim.
 *
 * The claim (games.processing / processingStartedAt) is the serverless-safe
 * lock: only one caller can flip it for an active game whose prior claim is
 * clear or stale, so overlapping ticks never double-move. budgetMs=0 plays
 * exactly one ply (used by the start route).
 */
export async function processGame(
  game: Pick<Game, "id">,
  budgetMs: number = GAME_RULES.TICK_BUDGET_MS,
): Promise<ProcessSummary> {
  const summary: ProcessSummary = { plies: 0 };
  let stamp = new Date();
  const staleBefore = new Date(Date.now() - GAME_RULES.CLAIM_STALE_MS);
  const claimed = await db
    .update(games)
    .set({ processing: true, processingStartedAt: stamp })
    .where(
      and(
        eq(games.id, game.id),
        eq(games.status, "active"),
        or(eq(games.processing, false), isNull(games.processingStartedAt), lt(games.processingStartedAt, staleBefore)),
      ),
    )
    .returning({ id: games.id });
  if (claimed.length === 0) return summary;

  const deadline = Date.now() + budgetMs;
  let ownsClaim = true;
  try {
    while (true) {
      const outcome = await playOnePly(game.id, summary);
      if (outcome !== "stop") summary.plies++;
      if (outcome !== "moved" || Date.now() >= deadline) break;
      // Refresh the claim between plies; if it was taken over, stop.
      const next = new Date();
      const kept = await db
        .update(games)
        .set({ processingStartedAt: next })
        .where(and(eq(games.id, game.id), eq(games.processingStartedAt, stamp)))
        .returning({ id: games.id });
      if (kept.length === 0) {
        ownsClaim = false;
        break;
      }
      stamp = next;
    }
  } catch (error) {
    console.error(`[processGame] Unexpected error processing game ${game.id}:`, error);
  } finally {
    if (ownsClaim) {
      await db
        .update(games)
        .set({ processing: false, processingStartedAt: null })
        .where(and(eq(games.id, game.id), eq(games.processingStartedAt, stamp)))
        .catch((err) => console.error(`[processGame] Failed to release claim for ${game.id}:`, err));
    }
  }
  return summary;
}

/** Per-match keys (decrypted), falling back to the server env per provider. */
function gameKeys(game: Game): ApiKeys {
  return {
    groq: decryptSecret(game.groqApiKey),
    google: decryptSecret(game.geminiApiKey),
    anthropic: decryptSecret(game.anthropicApiKey),
    openai: decryptSecret(game.openaiApiKey),
  };
}

async function moveHistory(gameId: string) {
  // Ply order: fullmove number, then white before black (enum order).
  return db
    .select({ moveSan: moves.moveSan, color: moves.color, plan: moves.plan })
    .from(moves)
    .where(eq(moves.gameId, gameId))
    .orderBy(asc(moves.moveNumber), asc(moves.color), asc(moves.createdAt));
}

async function setNote(gameId: string, note: string | null, extra: Partial<Game> = {}) {
  await db.update(games).set({ statusNote: note, ...extra }).where(eq(games.id, gameId));
}

/** Plays a single ply (see PlyOutcome). */
async function playOnePly(gameId: string, summary: ProcessSummary): Promise<PlyOutcome> {
  const [game] = await db.select().from(games).where(eq(games.id, gameId));
  if (!game || game.status !== "active") return "stop";
  // No moves yet: delete the match without a trace. Otherwise end it unrated.
  const cancelOrAbort = async (movesPlayed: number, reason: string) => {
    if (movesPlayed === 0) {
      await abortGame(game.id);
      summary.abortedReason = reason;
    } else {
      await endGame(game.id, null, `Match cancelled: ${reason}`);
    }
  };

  const history = await moveHistory(game.id);
  const chess = loadGame(game.fen, history.map((m) => m.moveSan));

  // A game that is already decided (e.g. legacy rows) is closed out.
  const already = gameStatus(chess);
  if (already.over) {
    await endGame(game.id, already.result, already.reason!);
    return "stop";
  }

  if (game.startedAt && Date.now() - new Date(game.startedAt).getTime() > GAME_RULES.GAME_TIME_LIMIT_MS) {
    const verdict = adjudicate(game.fen);
    await endGame(game.id, verdict.result, verdict.reason);
    return "stop";
  }

  const color: Color = chess.turn() === "w" ? "white" : "black";
  const side = color === "white" ? "White" : "Black";
  const modelId = color === "white" ? game.whiteId : game.blackId;
  const mode = color === "white" ? game.whiteMode : game.blackMode;
  const keys = gameKeys(game);
  const provider = providerOf(modelId);

  // A missing key is a setup failure, not a chess result.
  if (isKeyedProvider(provider) && !resolveKey(provider, keys)) {
    await cancelOrAbort(history.length, `${side} has no ${PROVIDER_LABEL[provider]} API key`);
    return "stop";
  }

  const previousPlan = [...history].reverse().find((m) => m.color === color)?.plan ?? null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GAME_RULES.PLY_DEADLINE_MS);

  let turn;
  try {
    turn = await playTurn({ modelId, chess, color, mode, keys, previousPlan, signal: controller.signal });
  } catch (err) {
    if (err instanceof APIKeyError || err instanceof ModelUnavailableError) {
      await cancelOrAbort(history.length, `${side}: ${err.message}`);
      return "stop";
    }
    if (err instanceof RateLimitError) {
      // Rate limits are usually per-minute: wait for the next tick rather than
      // penalising the player. The game time limit bounds a dead quota.
      if (history.length === 0) {
        await cancelOrAbort(0, `${side}: ${err.message}`);
      } else {
        await setNote(game.id, `${side} is rate limited by ${PROVIDER_LABEL[provider]} — retrying shortly`);
      }
      return "stop";
    }
    // Transient failure (timeouts, unreadable answers, no legal move): a warning.
    const warningsKey = color === "white" ? "whiteTimeoutWarnings" : "blackTimeoutWarnings";
    const warnings = game[warningsKey] + 1;
    const detail = err instanceof JudgeFailedError ? err.message : err instanceof Error ? err.message : String(err);
    console.warn(`[processGame] ${modelId} failed its ply (${warnings}/${GAME_RULES.MAX_TIMEOUT_WARNINGS + 1}): ${detail}`);
    if (warnings > GAME_RULES.MAX_TIMEOUT_WARNINGS) {
      await endGame(game.id, color === "white" ? "0-1" : "1-0", `${side} forfeited: no legal move after repeated attempts`);
    } else {
      await setNote(game.id, `${side} failed to move (${detail}) — warning ${warnings}/${GAME_RULES.MAX_TIMEOUT_WARNINGS}`, {
        [warningsKey]: warnings,
      });
    }
    return "stop";
  } finally {
    clearTimeout(timer);
  }

  const moveNumber = getMoveNumber(chess.fen());
  chess.move(turn.san);
  const fenAfter = chess.fen();
  const status = gameStatus(chess);

  // Record the move and position together, guarded on the position we computed
  // the move for: a lost race (destroyed game, takeover) writes nothing.
  const applied = await db.transaction(async (tx) => {
    const updated = await tx
      .update(games)
      .set({
        fen: fenAfter,
        pgn: toPgn(chess.history()),
        statusNote: null,
        ...(color === "white" ? { whiteTimeoutWarnings: 0 } : { blackTimeoutWarnings: 0 }),
      })
      .where(and(eq(games.id, game.id), eq(games.fen, game.fen), eq(games.status, "active")))
      .returning({ id: games.id });
    if (updated.length === 0) return false;
    await tx.insert(moves).values({
      gameId: game.id,
      modelId,
      color,
      moveNumber,
      moveSan: turn.san,
      fenAfter,
      reasoning: turn.reasoning,
      plan: turn.plan,
      judge: turn.judge,
      thinkMs: turn.thinkMs,
    });
    return true;
  });
  if (!applied) return "stop";

  if (status.over) {
    await endGame(game.id, status.result, status.reason!);
    return "ended";
  }
  return "moved";
}

/** Deletes a game and its moves. For matches that never really started. */
export async function abortGame(gameId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(moves).where(eq(moves.gameId, gameId));
    await tx.delete(games).where(eq(games.id, gameId));
  });
}

/**
 * Ends a game exactly once. The status flip and the rating update share a
 * transaction, and the flip is conditional on the game still being active, so
 * two concurrent enders can never double-count. `result` null = no result
 * (cancelled / stopped): nothing is rated.
 */
export async function endGame(gameId: string, result: GameResult | null, reason: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [ended] = await tx
      .update(games)
      .set({ status: "complete", result, resultReason: reason, endedAt: new Date(), statusNote: null })
      .where(and(eq(games.id, gameId), eq(games.status, "active")))
      .returning();
    if (!ended) return false;
    if (!result || ended.whiteId === ended.blackId || !isRatedPairing(ended.whiteMode, ended.blackMode)) return true;

    // Lock both rating rows in a fixed order to avoid deadlocks.
    const ids = [ended.whiteId, ended.blackId].sort();
    const rows = await tx
      .select()
      .from(models)
      .where(or(eq(models.id, ids[0]), eq(models.id, ids[1])))
      .orderBy(asc(models.id))
      .for("update");
    const white = rows.find((r) => r.id === ended.whiteId);
    const black = rows.find((r) => r.id === ended.blackId);
    if (!white || !black) return true;

    for (const [me, opp, isWhite] of [[white, black, true], [black, white, false]] as const) {
      const outcome = outcomeFromResult(result, isWhite);
      const { newRating } = calculateNewElo(me.elo, opp.elo, outcome);
      await tx
        .update(models)
        .set({
          elo: newRating,
          gamesPlayed: sql`${models.gamesPlayed} + 1`,
          wins: sql`${models.wins} + ${outcome === "win" ? 1 : 0}`,
          losses: sql`${models.losses} + ${outcome === "loss" ? 1 : 0}`,
          draws: sql`${models.draws} + ${outcome === "draw" ? 1 : 0}`,
        })
        .where(eq(models.id, me.id));
    }
    return true;
  });
}

/**
 * Self-heal for databases from before cancelled matches were unrated: such
 * games were recorded as draws. Removes them and reverts their counters.
 */
export async function purgeLegacyCancelledGames(): Promise<number> {
  const legacy = await db
    .select({ id: games.id, whiteId: games.whiteId, blackId: games.blackId })
    .from(games)
    .where(and(eq(games.status, "complete"), eq(games.result, "1/2-1/2"), like(games.resultReason, "Match cancelled%")))
    .orderBy(desc(games.startedAt));

  for (const g of legacy) {
    await db.transaction(async (tx) => {
      await tx.delete(moves).where(eq(moves.gameId, g.id));
      await tx.delete(games).where(eq(games.id, g.id));
      for (const modelId of new Set([g.whiteId, g.blackId])) {
        await tx
          .update(models)
          .set({
            gamesPlayed: sql`GREATEST(0, ${models.gamesPlayed} - 1)`,
            draws: sql`GREATEST(0, ${models.draws} - 1)`,
          })
          .where(eq(models.id, modelId));
      }
    });
  }
  return legacy.length;
}
