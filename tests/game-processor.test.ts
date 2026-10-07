import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { APICallError } from "ai";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { games, models } from "@/db/schema";
import { processGame, endGame, abortGame, purgeLegacyCancelledGames } from "@/lib/game-processor";
import { replay, STARTING_FEN } from "@/lib/chess";
import { GAME_RULES } from "@/lib/config";
import { hasDb, resetDb, createGame, getGame, getMoves, getModel } from "./helpers";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: vi.fn() };
});
const { generateText } = await import("ai");
const mockedGenerate = vi.mocked(generateText);

const LLM = "groq/openai/gpt-oss-120b";
const LLM_B = "groq/openai/gpt-oss-20b";

/** Scripts the model's answers in order; an Error entry is thrown instead. */
function script(...answers: Array<string | Error>) {
  const queue = [...answers];
  mockedGenerate.mockImplementation(async () => {
    const next = queue.shift();
    if (next === undefined) throw new Error("script exhausted");
    if (next instanceof Error) throw next;
    return { text: next } as never;
  });
}

const answer = (move: string, extra: Record<string, string> = {}) =>
  JSON.stringify({ reasoning: `I play ${move}`, plan: "keep developing", ...extra, move });

function apiError(statusCode: number, message: string) {
  return new APICallError({ message, url: "https://x", requestBodyValues: {}, statusCode, isRetryable: false });
}

async function playToEnd(gameId: string, maxTicks = 400) {
  for (let i = 0; i < maxTicks; i++) {
    const g = await getGame(gameId);
    if (!g || g.status !== "active") return g;
    await processGame({ id: gameId }, 5_000);
  }
  return getGame(gameId);
}

describe.skipIf(!hasDb)("game processor (real database)", () => {
  beforeEach(async () => {
    await resetDb();
    mockedGenerate.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("plays a complete game between built-in engines and records it faithfully", async () => {
    const game = await createGame({ whiteId: "local/engine-2", blackId: "local/random" });
    const ended = await playToEnd(game.id);

    expect(ended?.status).toBe("complete");
    expect(ended?.result).toMatch(/^(1-0|0-1|1\/2-1\/2)$/);
    expect(ended?.resultReason).toBeTruthy();
    expect(ended?.endedAt).toBeTruthy();
    expect(ended?.processing).toBe(false);

    // The move rows replay exactly to the stored final position and full PGN.
    const rows = await getMoves(game.id);
    const chess = replay(rows.map((m) => m.moveSan));
    expect(chess.fen()).toBe(ended!.fen);
    expect(ended!.pgn.startsWith("1. ")).toBe(true);
    expect(ended!.pgn.split(/\s+/).filter((t) => !/^\d+\.$/.test(t))).toHaveLength(rows.length);
    rows.forEach((m, i) => {
      expect(m.color).toBe(i % 2 === 0 ? "white" : "black");
      expect(m.modelId).toBe(i % 2 === 0 ? "local/engine-2" : "local/random");
      expect(m.judge).toMatchObject({ attempts: 1, events: [] });
    });

    // Rated (same modes): both models' counters moved exactly once.
    const white = await getModel("local/engine-2");
    const black = await getModel("local/random");
    expect(white.gamesPlayed).toBe(1);
    expect(black.gamesPlayed).toBe(1);
    expect(white.wins + white.losses + white.draws).toBe(1);
    expect(white.elo + black.elo).toBe(3000); // equal ratings → symmetric change
  });

  it("canonicalizes notation and gives illegal answers feedback (LLM via judge)", async () => {
    const game = await createGame({ whiteId: LLM, blackId: "local/random", groqApiKey: "test-key" });
    script(answer("Ke2"), answer("e2e4"));
    const summary = await processGame(game, 0);

    expect(summary.plies).toBe(1);
    const [move] = await getMoves(game.id);
    expect(move.moveSan).toBe("e4");
    expect(move.reasoning).toBe("I play e2e4");
    expect(move.plan).toBe("keep developing");
    expect(move.thinkMs).toBeGreaterThanOrEqual(0);
    expect(move.judge).toEqual({
      attempts: 2,
      events: [
        { type: "illegal", attempt: 1, move: "Ke2" },
        { type: "notation", attempt: 2, from: "e2e4", to: "e4" },
      ],
    });
    // The second prompt carried the judge's feedback.
    const secondPrompt = (mockedGenerate.mock.calls[1][0] as { prompt: string }).prompt;
    expect(secondPrompt).toContain('"Ke2" is not a legal move');
    expect((await getGame(game.id)).pgn).toBe("1. e4");
  });

  it("asks once about a blunder and accepts the reconsidered move", async () => {
    // 1.e4 d5: Qg4?? hangs the queen to Bxg4.
    const fen = "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
    const game = await createGame({ whiteId: LLM, blackId: LLM_B, fen, groqApiKey: "k", whiteMode: "scholar", blackMode: "scholar" });
    script(answer("Qg4"), answer("exd5"));
    await processGame(game, 0);

    const [move] = await getMoves(game.id);
    expect(move.moveSan).toBe("exd5");
    expect(move.judge?.reconsidered).toBe(true);
    expect(move.judge?.events[0]).toMatchObject({ type: "blunder", attempt: 1, move: "Qg4", reply: "Bxg4" });
    const feedback = (mockedGenerate.mock.calls[1][0] as { prompt: string }).prompt;
    expect(feedback).toContain("your opponent can answer Bxg4");
  });

  it("lets the model insist on its move after the warning", async () => {
    const fen = "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
    const game = await createGame({ whiteId: LLM, blackId: LLM_B, fen, groqApiKey: "k" });
    script(answer("Qg4"), answer("Qg4"));
    await processGame(game, 0);
    const [move] = await getMoves(game.id);
    expect(move.moveSan).toBe("Qg4");
    expect(move.judge?.reconsidered).toBeUndefined();
  });

  it("novice mode has no blunder guard", async () => {
    const fen = "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
    const game = await createGame({ whiteId: LLM, blackId: LLM_B, fen, groqApiKey: "k", whiteMode: "novice" });
    script(answer("Qg4"));
    await processGame(game, 0);
    expect((await getMoves(game.id))[0].moveSan).toBe("Qg4");
    expect(mockedGenerate).toHaveBeenCalledTimes(1);
  });

  it("falls back to the model's earlier legal move when later attempts fail", async () => {
    const fen = "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
    const game = await createGame({ whiteId: LLM, blackId: LLM_B, fen, groqApiKey: "k" });
    script(answer("Qg4"), "no idea", "still no idea");
    await processGame(game, 0);
    const [move] = await getMoves(game.id);
    expect(move.moveSan).toBe("Qg4");
    expect(move.judge?.events.map((e) => e.type)).toEqual(["blunder", "parse", "parse", "fallback"]);
    expect((await getGame(game.id)).whiteTimeoutWarnings).toBe(0);
  });

  it("warns, then forfeits a side that never produces a legal move", async () => {
    const game = await createGame({ whiteId: LLM, blackId: "local/random", groqApiKey: "k" });
    mockedGenerate.mockResolvedValue({ text: "I resign from thinking" } as never);

    for (let warning = 1; warning <= GAME_RULES.MAX_TIMEOUT_WARNINGS; warning++) {
      await processGame(game, 0);
      const g = await getGame(game.id);
      expect(g.status).toBe("active");
      expect(g.whiteTimeoutWarnings).toBe(warning);
      expect(g.statusNote).toContain(`warning ${warning}/${GAME_RULES.MAX_TIMEOUT_WARNINGS}`);
    }
    await processGame(game, 0);
    const g = await getGame(game.id);
    expect(g.status).toBe("complete");
    expect(g.result).toBe("0-1");
    expect(g.resultReason).toMatch(/White forfeited/);
    expect(g.statusNote).toBeNull();
    expect((await getModel("local/random")).wins).toBe(1);
  });

  it("clears a side's warnings after a successful move", async () => {
    const game = await createGame({ whiteId: LLM, blackId: "local/random", groqApiKey: "k" });
    mockedGenerate.mockResolvedValue({ text: "??" } as never);
    await processGame(game, 0);
    expect((await getGame(game.id)).whiteTimeoutWarnings).toBe(1);
    script(answer("d4"));
    await processGame(game, 0);
    const g = await getGame(game.id);
    expect(g.whiteTimeoutWarnings).toBe(0);
    expect(g.statusNote).toBeNull();
  });

  it("deletes a match whose key is rejected before any move", async () => {
    const game = await createGame({ whiteId: LLM, blackId: "local/random", groqApiKey: "bad" });
    script(apiError(401, "Invalid API Key"));
    const summary = await processGame(game, 0);
    expect(summary.abortedReason).toMatch(/White: Invalid or missing API key for Groq/);
    expect(await getGame(game.id)).toBeUndefined();
    expect((await getModel(LLM)).gamesPlayed).toBe(0);
  });

  it("cancels (unrated) a match whose key fails mid-game", async () => {
    const game = await createGame({ whiteId: "local/random", blackId: LLM, groqApiKey: "k" });
    await processGame(game, 0); // white's random move
    script(apiError(403, "Forbidden"));
    await processGame(game, 0);
    const g = await getGame(game.id);
    expect(g.status).toBe("complete");
    expect(g.result).toBeNull();
    expect(g.resultReason).toMatch(/^Match cancelled: Black/);
    expect((await getModel(LLM)).gamesPlayed).toBe(0);
    expect((await getModel("local/random")).elo).toBe(1500);
  });

  it("aborts when the model no longer exists", async () => {
    const game = await createGame({ whiteId: LLM, blackId: "local/random", groqApiKey: "k" });
    script(apiError(404, "model not found"));
    const summary = await processGame(game, 0);
    expect(summary.abortedReason).toMatch(/unavailable/);
  });

  it("waits out a mid-game rate limit without penalising the player", async () => {
    const game = await createGame({ whiteId: "local/random", blackId: LLM, groqApiKey: "k" });
    await processGame(game, 0);
    script(apiError(429, "Too Many Requests"));
    await processGame(game, 0);
    const g = await getGame(game.id);
    expect(g.status).toBe("active");
    expect(g.blackTimeoutWarnings).toBe(0);
    expect(g.statusNote).toMatch(/rate limited by Groq/);
  });

  it("aborts when no key is available at all", async () => {
    delete process.env.GROQ_API_KEY;
    const game = await createGame({ whiteId: LLM, blackId: "local/random" });
    const summary = await processGame(game, 0);
    expect(summary.abortedReason).toBe("White has no Groq API key");
    expect(mockedGenerate).not.toHaveBeenCalled();
  });

  it("feeds the side's previous plan into its next prompt", async () => {
    const game = await createGame({ whiteId: LLM, blackId: "local/random", groqApiKey: "k" });
    script(answer("e4", { plan: "Italian setup with Bc4" }));
    await processGame(game, 0);
    await processGame(game, 0); // random reply
    script(answer("Nf3"));
    await processGame(game, 0);
    const prompt = (mockedGenerate.mock.calls[1][0] as { prompt: string }).prompt;
    expect(prompt).toContain('Your plan from your previous move: "Italian setup with Bc4"');
    expect(prompt).toMatch(/Game so far: 1\. e4 \S+/);
  });

  it("never double-moves under concurrent ticks", async () => {
    const game = await createGame({ whiteId: LLM, blackId: LLM_B, groqApiKey: "k" });
    mockedGenerate.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 150));
      return { text: answer("e4") } as never;
    });
    const results = await Promise.all([processGame(game, 0), processGame(game, 0), processGame(game, 0)]);
    expect(results.reduce((n, r) => n + r.plies, 0)).toBe(1);
    expect(await getMoves(game.id)).toHaveLength(1);
    expect((await getGame(game.id)).processing).toBe(false);
  });

  it("takes over a stale claim but respects a fresh one", async () => {
    const game = await createGame({ whiteId: "local/random", blackId: "local/random" });
    await db.update(games).set({ processing: true, processingStartedAt: new Date() }).where(eq(games.id, game.id));
    expect((await processGame(game, 0)).plies).toBe(0);
    await db
      .update(games)
      .set({ processingStartedAt: new Date(Date.now() - GAME_RULES.CLAIM_STALE_MS - 1_000) })
      .where(eq(games.id, game.id));
    expect((await processGame(game, 0)).plies).toBe(1);
  });

  it("drops a move computed for a position that changed underneath", async () => {
    const game = await createGame({ whiteId: LLM, blackId: LLM_B, groqApiKey: "k" });
    mockedGenerate.mockImplementation(async () => {
      // Someone stops the match while the model is thinking.
      await endGame(game.id, null, "Match stopped by user");
      return { text: answer("e4") } as never;
    });
    expect((await processGame(game, 0)).plies).toBe(0);
    expect(await getMoves(game.id)).toHaveLength(0);
    expect((await getGame(game.id)).fen).toBe(STARTING_FEN);
  });

  it("adjudicates a game that exceeds the time limit", async () => {
    const game = await createGame({
      whiteId: "local/random",
      blackId: "local/random",
      fen: "4k3/8/8/8/8/8/8/QQ2K3 w - - 0 40",
      startedAt: new Date(Date.now() - GAME_RULES.GAME_TIME_LIMIT_MS - 1_000),
    });
    await processGame(game, 0);
    const g = await getGame(game.id);
    expect(g.result).toBe("1-0");
    expect(g.resultReason).toMatch(/adjudicated for White/);
  });

  it("closes out a position that is already decided", async () => {
    const game = await createGame({ whiteId: "local/random", blackId: "local/random", fen: "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1" });
    await processGame(game, 0);
    expect(await getGame(game.id)).toMatchObject({ status: "complete", result: "1/2-1/2", resultReason: "Stalemate" });
  });

  it("detects threefold repetition from the stored history", async () => {
    const history = ["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1"];
    const game = await createGame({ whiteId: "local/random", blackId: LLM, groqApiKey: "k", fen: replay(history).fen() });
    for (const [i, san] of history.entries()) {
      await db.execute(
        sql`insert into moves (game_id, model_id, color, move_number, move_san, fen_after, reasoning)
          values (${game.id}, ${i % 2 === 0 ? "local/random" : LLM}, ${i % 2 === 0 ? "white" : "black"}, ${Math.floor(i / 2) + 1}, ${san}, ${replay(history.slice(0, i + 1)).fen()}, 'r')`,
      );
    }
    script(answer("Ng8"));
    await processGame(game, 0);
    expect(await getGame(game.id)).toMatchObject({ status: "complete", result: "1/2-1/2", resultReason: "Draw by threefold repetition" });
  });
});

describe.skipIf(!hasDb)("endGame (real database)", () => {
  beforeEach(resetDb);

  it("rates exactly once under concurrent enders", async () => {
    const game = await createGame({ whiteId: "local/engine-2", blackId: "local/random" });
    const outcomes = await Promise.all([
      endGame(game.id, "1-0", "Checkmate"),
      endGame(game.id, "1-0", "Checkmate"),
      endGame(game.id, "0-1", "Black forfeited"),
    ]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const w = await getModel("local/engine-2");
    const b = await getModel("local/random");
    expect(w.gamesPlayed + b.gamesPlayed).toBe(2);
    expect(Math.abs(w.elo - 1500)).toBe(16);
    expect(w.elo + b.elo).toBe(3000);
  });

  it("does not rate mismatched modes or null results", async () => {
    const unrated = await createGame({ whiteId: "local/engine-2", blackId: "local/random", whiteMode: "grandmaster", blackMode: "novice" });
    await endGame(unrated.id, "1-0", "Checkmate");
    const noResult = await createGame({ whiteId: "local/engine-2", blackId: "local/random" });
    await endGame(noResult.id, null, "Match stopped by user");
    const rows = await db.select().from(models);
    expect(rows.every((m) => m.elo === 1500 && m.gamesPlayed === 0)).toBe(true);
    expect(await getGame(unrated.id)).toMatchObject({ status: "complete", result: "1-0" });
  });

  it("abortGame removes the game and its moves", async () => {
    const game = await createGame({ whiteId: "local/random", blackId: "local/random" });
    await processGame(game, 0);
    await abortGame(game.id);
    expect(await getGame(game.id)).toBeUndefined();
    expect(await getMoves(game.id)).toHaveLength(0);
  });

  it("purges legacy cancelled-as-draw games and reverts their counters", async () => {
    await db.update(models).set({ gamesPlayed: 1, draws: 1 }).where(eq(models.id, "local/random"));
    await createGame({ whiteId: "local/random", blackId: "local/greedy", status: "complete", result: "1/2-1/2", resultReason: "Match cancelled: Invalid key" });
    const keep = await createGame({ whiteId: "local/random", blackId: "local/greedy", status: "complete", result: null, resultReason: "Match cancelled: key revoked" });
    expect(await purgeLegacyCancelledGames()).toBe(1);
    expect(await getModel("local/random")).toMatchObject({ gamesPlayed: 0, draws: 0 });
    expect(await getModel("local/greedy")).toMatchObject({ gamesPlayed: 0, draws: 0 });
    expect(await getGame(keep.id)).toBeDefined();
  });
});
