import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { APICallError } from "ai";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { games, models, tournament } from "@/db/schema";
import { POST as start, maxDuration as startMaxDuration } from "@/app/api/games/start/route";
import { GET as tick, maxDuration as tickMaxDuration } from "@/app/api/cron/tick/route";
import { GET as listGames } from "@/app/api/games/route";
import { GET as gameDetail } from "@/app/api/games/[id]/route";
import { POST as analysis } from "@/app/api/games/[id]/analysis/route";
import { POST as destroy } from "@/app/api/games/destroy/route";
import { POST as humanMove } from "@/app/api/games/[id]/move/route";
import { POST as joinRoom } from "@/app/api/games/[id]/join/route";
import { POST as resign } from "@/app/api/games/[id]/resign/route";
import { GET as leaderboard } from "@/app/api/leaderboard/route";
import { GET as accuracy } from "@/app/api/analytics/accuracy/route";
import { GAME_RULES } from "@/lib/config";
import { endGame, processGame } from "@/lib/game-processor";
import { seedRoster } from "@/db/seed";
import { readdirSync, statSync } from "fs";
import { join, sep } from "path";
import { hasDb, resetDb, createGame, getGame, getMoves, getModel, jsonRequest } from "./helpers";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: vi.fn() };
});
const { generateText } = await import("ai");
const mockedGenerate = vi.mocked(generateText);

// Auth lives in Neon; tests swap the session user directly.
const session = vi.hoisted(() => ({ user: { id: "u-admin", email: "admin@test", name: "Admin", role: "admin" } as { id: string; email: string; name: string; role?: string } | null }));
// Self-contained: the real module imports next/headers, which only resolves inside Next.
vi.mock("@/lib/auth/server", () => ({
  requireUser: async (opts: { admin?: boolean } = {}) => {
    if (!session.user) return Response.json({ error: "Sign in to do that." }, { status: 401 });
    if (opts.admin && session.user.role !== "admin") return Response.json({ error: "Only the admin can do that." }, { status: 403 });
    return session.user;
  },
}));

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (url: string) => new Request(`http://localhost${url}`);

describe("route config", () => {
  it("keeps maxDuration literals in sync with the processing timeline", () => {
    expect(tickMaxDuration).toBe(GAME_RULES.TICK_MAX_DURATION_S);
    expect(startMaxDuration).toBe(GAME_RULES.TICK_MAX_DURATION_S);
    expect(GAME_RULES.TICK_BUDGET_MS + GAME_RULES.PLY_DEADLINE_MS).toBeLessThan(GAME_RULES.TICK_MAX_DURATION_S * 1000);
    expect(GAME_RULES.PLY_DEADLINE_MS).toBeLessThan(GAME_RULES.CLAIM_STALE_MS);
  });
});

describe("API surface", () => {
  // The arena's history is the benchmark: nothing may wipe it. Any new route
  // must be added here deliberately (and must not reset games or ratings).
  it("exposes exactly the reviewed routes — and no reset", () => {
    const root = join(process.cwd(), "src/app/api");
    const routes: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name === "route.ts") routes.push(dir.slice(root.length).split(sep).join("/") || "/");
      }
    };
    walk(root);
    expect(routes.sort()).toEqual([
      "/analytics/accuracy",
      "/auth/[...path]",
      "/cron/tick",
      "/games",
      "/games/[id]",
      "/games/[id]/analysis",
      "/games/[id]/join",
      "/games/[id]/move",
      "/games/[id]/resign",
      "/games/destroy",
      "/games/start",
      "/leaderboard",
      "/providers",
    ]);
    expect(routes.some((r) => /reset|wipe|clear/i.test(r))).toBe(false);
  });
});

describe.skipIf(!hasDb)("API routes (real database)", () => {
  const env = { ...process.env };
  beforeEach(async () => {
    await resetDb();
    mockedGenerate.mockReset();
    delete process.env.GROQ_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });
  afterEach(() => {
    process.env = { ...env };
    session.user = { id: "u-admin", email: "admin@test", name: "Admin", role: "admin" };
  });

  describe("auth", () => {
    it("requires a signed-in user to start a match, and records who started it", async () => {
      session.user = null;
      expect((await start(jsonRequest("/api/games/start", { modelIds: ["local/engine-2", "local/random"] }))).status).toBe(401);
      session.user = { id: "u-player", email: "p@test", name: "Player", role: "user" };
      const body = await (await start(jsonRequest("/api/games/start", { modelIds: ["local/engine-2", "local/random"] }))).json();
      expect(await getGame(body.gameId)).toMatchObject({ startedBy: "u-player" });
    });

    it("lets only the admin stop a match", async () => {
      const game = await createGame({ whiteId: "local/random", blackId: "local/greedy" });
      session.user = null;
      expect((await destroy(jsonRequest("/api/games/destroy", {}))).status).toBe(401);
      session.user = { id: "u-player", email: "p@test", name: "Player", role: "user" };
      expect((await destroy(jsonRequest("/api/games/destroy", {}))).status).toBe(403);
      expect(await getGame(game.id)).toMatchObject({ status: "active" });
    });
  });

  describe("POST /api/games/start", () => {
    it("starts a built-in match, plays the first move and marks the arena running", async () => {
      const res = await start(jsonRequest("/api/games/start", { modelIds: ["local/engine-2", "local/random"] }));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body).toMatchObject({ success: true, white: "local/engine-2", black: "local/random" });
      const game = await getGame(body.gameId);
      expect(game).toMatchObject({ status: "active", whiteMode: "scholar", blackMode: "scholar", processing: false });
      expect(await getMoves(body.gameId)).toHaveLength(1);
      const [t] = await db.select().from(tournament);
      expect(t.status).toBe("running");
    });

    it.each([
      [{ modelIds: ["local/random"] }, 400],
      [{ modelIds: ["local/random", "local/random"] }, 400],
      ["not json", 400],
      [{ modelIds: ["local/random", "nope/model"] }, 400],
    ])("rejects %j", async (body, status) => {
      const res = await start(jsonRequest("/api/games/start", body));
      expect(res.status).toBe(status);
      expect((await res.json()).error).toBeTruthy();
      expect(await db.select().from(games)).toHaveLength(0);
    });

    it("rejects inactive models", async () => {
      await db.update(models).set({ active: false }).where(eq(models.id, "local/greedy"));
      const res = await start(jsonRequest("/api/games/start", { modelIds: ["local/random", "local/greedy"] }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/inactive model: local\/greedy/);
    });

    it("requires a key for each LLM provider before creating anything", async () => {
      const res = await start(jsonRequest("/api/games/start", { modelIds: ["groq/openai/gpt-oss-120b", "local/random"] }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ provider: "groq", error: expect.stringMatching(/Groq API key is required/) });
      expect(await db.select().from(games)).toHaveLength(0);
    });

    it("stores only the keys this match needs, and reports a rejected key synchronously", async () => {
      mockedGenerate.mockRejectedValueOnce(
        new APICallError({ message: "Invalid API Key", url: "x", requestBodyValues: {}, statusCode: 401, isRetryable: false }),
      );
      const res = await start(
        jsonRequest("/api/games/start", {
          modelIds: ["groq/openai/gpt-oss-120b", "local/random"],
          keys: { groq: "bad-key", anthropic: "unused" },
        }),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/could not start — White: Invalid or missing API key for Groq/);
      expect(await db.select().from(games)).toHaveLength(0);
    });

    it("keeps an LLM match whose first move succeeds, without leaking keys", async () => {
      mockedGenerate.mockResolvedValue({ text: '{"reasoning":"center","move":"e4"}' } as never);
      const res = await start(
        jsonRequest("/api/games/start", {
          modelIds: ["groq/openai/gpt-oss-120b", "local/random"],
          whiteMode: "grandmaster",
          blackMode: "novice",
          keys: { groq: "good-key", anthropic: "unused" },
        }),
      );
      const { gameId } = await res.json();
      const row = await getGame(gameId);
      expect(row.groqApiKey).toBe("good-key");
      expect(row.anthropicApiKey).toBeNull();
      const detail = await (await gameDetail(get(`/api/games/${gameId}`), params(gameId))).json();
      expect(JSON.stringify(detail)).not.toContain("good-key");
      expect(detail.game).not.toHaveProperty("groqApiKey");
      expect(detail.game.rated).toBe(false); // mismatched modes
      expect(detail.moves[0]).toMatchObject({ moveSan: "e4", color: "white" });
    });

    it("accepts the legacy groqApiKey field", async () => {
      mockedGenerate.mockResolvedValue({ text: '{"move":"d4"}' } as never);
      const res = await start(jsonRequest("/api/games/start", { modelIds: ["groq/openai/gpt-oss-20b", "local/random"], groqApiKey: "legacy" }));
      expect(res.status).toBe(200);
    });

    it("refuses a second concurrent game, even under racing requests", async () => {
      const results = await Promise.all(
        Array.from({ length: 4 }, () => start(jsonRequest("/api/games/start", { modelIds: ["local/random", "local/greedy"] }))),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(3);
      expect(await db.select().from(games).where(eq(games.status, "active"))).toHaveLength(1);
    });
  });

  describe("GET /api/cron/tick", () => {
    it("advances active games and counts ticks", async () => {
      const game = await createGame({ whiteId: "local/random", blackId: "local/random" });
      const body = await (await tick()).json();
      expect(body).toMatchObject({ success: true, gamesProcessed: 1, gamesFailed: 0, tickCount: 1 });
      expect(body.pliesPlayed).toBeGreaterThan(0);
      expect((await getMoves(game.id)).length).toBe(body.pliesPlayed);
      expect((await (await tick()).json()).tickCount).toBe(2);
    });

    it("is a cheap no-op without active games", async () => {
      expect(await (await tick()).json()).toMatchObject({ gamesProcessed: 0, pliesPlayed: 0 });
    });
  });

  describe("GET /api/games and /api/games/[id]", () => {
    it("lists by status with models and move counts, newest first", async () => {
      const done = await createGame({ whiteId: "local/random", blackId: "local/greedy" });
      await processGame(done, 0);
      await endGame(done.id, "1-0", "Checkmate");
      const active = await createGame({ whiteId: "local/greedy", blackId: "local/random" });

      const activeList = await (await listGames(get("/api/games?status=active"))).json();
      expect(activeList.games.map((g: { id: string }) => g.id)).toEqual([active.id]);
      const completeList = await (await listGames(get("/api/games?status=complete&limit=5"))).json();
      expect(completeList.games[0]).toMatchObject({ id: done.id, moveCount: 1, rated: true, whiteModel: { name: "Random Mover" } });
      expect(completeList.games[0]).not.toHaveProperty("groqApiKey");
    });

    it.each(["status=bogus", "limit=0", "limit=101", "limit=abc"])("validates %s", async (q) => {
      expect((await listGames(get(`/api/games?${q}`))).status).toBe(400);
    });

    it("returns moves in ply order and 404s for unknown or malformed ids", async () => {
      const game = await createGame({ whiteId: "local/random", blackId: "local/greedy" });
      for (let i = 0; i < 6; i++) await processGame(game, 0);
      const detail = await (await gameDetail(get(""), params(game.id))).json();
      expect(detail.moves.map((m: { color: string }) => m.color)).toEqual(["white", "black", "white", "black", "white", "black"]);
      expect(detail.white.id).toBe("local/random");
      expect((await gameDetail(get(""), params("00000000-0000-4000-8000-000000000000"))).status).toBe(404);
      expect((await gameDetail(get(""), params("not-a-uuid"))).status).toBe(404);
    });
  });

  describe("Human vs AI", () => {
    const me = { id: "u-player", email: "p@test", name: "Player", role: "user" };
    const move = (id: string, m: string) => humanMove(jsonRequest(`/api/games/${id}/move`, { move: m }), params(id));

    it("waits for the human, accepts only the starter's legal moves, then the AI replies", async () => {
      session.user = me;
      const started = await (await start(jsonRequest("/api/games/start", { modelIds: ["human", "local/greedy"] }))).json();
      expect(await getMoves(started.gameId)).toHaveLength(0); // White is the human: no AI ply at start
      await processGame({ id: started.gameId }, 0);
      expect(await getMoves(started.gameId)).toHaveLength(0); // ticks wait on the human

      session.user = { ...me, id: "u-other" };
      expect((await move(started.gameId, "e2e4")).status).toBe(403);
      session.user = me;
      expect((await move(started.gameId, "e2e5")).status).toBe(400);
      expect((await move(started.gameId, "e2e4")).status).toBe(200);
      expect((await move(started.gameId, "d2d4")).status).toBe(409); // not your turn

      await processGame({ id: started.gameId }, 0);
      const plies = await getMoves(started.gameId);
      expect(plies.map((p) => p.color)).toEqual(["white", "black"]);
      expect(plies[0]).toMatchObject({ moveSan: "e4", modelId: "human" });
    });

    it("never touches ratings or counters", async () => {
      session.user = me;
      const started = await (await start(jsonRequest("/api/games/start", { modelIds: ["local/greedy", "human"] }))).json();
      await endGame(started.gameId, "1-0", "Checkmate");
      expect(await getModel("local/greedy")).toMatchObject({ elo: 1500, gamesPlayed: 0, wins: 0 });
    });
  });

  describe("Human vs Human rooms", () => {
    const alice = { id: "u-alice", email: "a@test", name: "Alice", role: "user" };
    const bob = { id: "u-bob", email: "b@test", name: "Bob", role: "user" };
    const move = (id: string, m: string) => humanMove(jsonRequest(`/api/games/${id}/move`, { move: m }), params(id));
    const join = (id: string) => joinRoom(jsonRequest(`/api/games/${id}/join`, {}), params(id));

    it("opens a room beside a running arena game, seats a joiner, and rates both players", async () => {
      await createGame({ whiteId: "local/random", blackId: "local/greedy" }); // the AI arena is busy
      session.user = alice;
      const res = await start(jsonRequest("/api/games/start", { modelIds: ["human", "human"], seat: "black" }));
      expect(res.status).toBe(200);
      const { gameId } = await res.json();
      const open = await (await listGames(get("/api/games?status=active&open=1"))).json();
      expect(open.games.map((g: { id: string }) => g.id)).toEqual([gameId]);
      expect((await move(gameId, "e2e4")).status).toBe(409); // White's seat is still empty

      session.user = bob;
      expect((await join(gameId)).status).toBe(200);
      expect(await getGame(gameId)).toMatchObject({ whiteUserId: "u-bob", whiteUserName: "Bob", blackUserId: "u-alice" });
      expect((await join(gameId)).status).toBe(200); // already seated: idempotent
      session.user = { ...bob, id: "u-carol" };
      expect((await join(gameId)).status).toBe(409); // full

      session.user = bob;
      expect((await move(gameId, "e2e4")).status).toBe(200);
      session.user = alice;
      expect((await move(gameId, "e7e5")).status).toBe(200);
      await endGame(gameId, "1-0", "Checkmate");
      const ladder = await (await leaderboard(get("/api/leaderboard?board=humans"))).json();
      expect(ladder.players.map((p: { name: string; elo: number }) => [p.name, p.elo])).toEqual([["Bob", 1516], ["Alice", 1484]]);
      expect(await getModel("human")).toMatchObject({ gamesPlayed: 0 });
    });

    it("lets a seated player resign, and cancels an unjoined room", async () => {
      session.user = alice;
      const vsAi = (await (await start(jsonRequest("/api/games/start", { modelIds: ["human", "local/greedy"] }))).json()).gameId;
      session.user = bob;
      expect((await resign(jsonRequest("", {}), params(vsAi))).status).toBe(403);
      session.user = alice;
      expect((await resign(jsonRequest("", {}), params(vsAi))).status).toBe(200);
      expect(await getGame(vsAi)).toMatchObject({ status: "complete", result: "0-1", resultReason: "White resigned" });

      const room = (await (await start(jsonRequest("/api/games/start", { modelIds: ["human", "human"] }))).json()).gameId;
      expect(await (await resign(jsonRequest("", {}), params(room))).json()).toMatchObject({ cancelled: true });
      expect(await getGame(room)).toBeUndefined();
    });

    it("lists Human vs AI records per player and allows one live human game each", async () => {
      session.user = alice;
      const { gameId } = await (await start(jsonRequest("/api/games/start", { modelIds: ["human", "local/greedy"] }))).json();
      expect((await start(jsonRequest("/api/games/start", { modelIds: ["human", "local/random"] }))).status).toBe(409);
      await endGame(gameId, "1-0", "Checkmate");
      const board = await (await leaderboard(get("/api/leaderboard?board=vs-ai"))).json();
      expect(board.players).toEqual([expect.objectContaining({ userId: "u-alice", name: "Alice", games: 1, wins: 1, avgOpponentElo: 1500 })]);
    });
  });

  describe("POST /api/games/destroy", () => {
    it("deletes an active game with no moves", async () => {
      const game = await createGame({ whiteId: "local/random", blackId: "local/greedy" });
      const body = await (await destroy(jsonRequest("/api/games/destroy", {}))).json();
      expect(body).toMatchObject({ aborted: 1, deleted: true, gameId: game.id });
      expect(await getGame(game.id)).toBeUndefined();
    });

    it("stops a game in progress without rating it", async () => {
      const game = await createGame({ whiteId: "local/random", blackId: "local/greedy" });
      await processGame(game, 0);
      await destroy(jsonRequest("/api/games/destroy", { gameId: game.id }));
      expect(await getGame(game.id)).toMatchObject({ status: "complete", result: null, resultReason: "Match stopped by the admin" });
      const rows = await db.select().from(models);
      expect(rows.every((m) => m.gamesPlayed === 0)).toBe(true);
    });

    it("is a no-op without an active game or with a non-matching id", async () => {
      expect(await (await destroy(jsonRequest("/api/games/destroy"))).json()).toMatchObject({ aborted: 0 });
      await createGame({ whiteId: "local/random", blackId: "local/greedy" });
      const body = await (await destroy(jsonRequest("/api/games/destroy", { gameId: "00000000-0000-4000-8000-000000000000" }))).json();
      expect(body.aborted).toBe(0);
    });
  });

  describe("POST /api/games/[id]/analysis + accuracy analytics", () => {
    async function finishedGame(plies: number) {
      const game = await createGame({ whiteId: "local/random", blackId: "local/greedy" });
      for (let i = 0; i < plies; i++) await processGame(game, 0);
      await endGame(game.id, "1/2-1/2", "Draw");
      return { game, rows: await getMoves(game.id) };
    }

    it("stores per-move loss/accuracy once and aggregates per model", async () => {
      const { game, rows } = await finishedGame(4);
      const evals = rows.map((m, i) => ({ moveId: m.id, evalCp: i >= 2 ? -500 : 20 }));
      const res = await analysis(jsonRequest("", { startEvalCp: 20, evals: [...evals].reverse() }), params(game.id));
      expect(await res.json()).toMatchObject({ success: true, analyzedMoves: 4 });

      const stored = await getMoves(game.id);
      expect(stored.map((m) => m.cpLoss)).toEqual([0, 0, 520, 0]); // white's 2nd move blundered
      expect((await getGame(game.id)).analyzed).toBe(true);

      const again = await analysis(jsonRequest("", { startEvalCp: 0, evals }), params(game.id));
      expect(await again.json()).toMatchObject({ alreadyAnalyzed: true });

      const stats = (await (await accuracy()).json()).models;
      const random = stats.find((s: { modelId: string }) => s.modelId === "local/random");
      expect(random).toMatchObject({ moveCount: 2, blunders: 1, blunderRate: 50, acpl: 260 });
    });

    it("validates input and game state", async () => {
      const { game, rows } = await finishedGame(2);
      const one = [{ moveId: rows[0].id, evalCp: 0 }];
      expect((await analysis(jsonRequest("", { startEvalCp: 0, evals: one }), params(game.id))).status).toBe(400);
      expect((await analysis(jsonRequest("", { startEvalCp: 0, evals: [] }), params(game.id))).status).toBe(400);
      expect((await analysis(jsonRequest("", { startEvalCp: 1e9, evals: one }), params(game.id))).status).toBe(400);
      const foreign = [rows[0], { id: "00000000-0000-4000-8000-000000000009" }].map((m) => ({ moveId: m.id, evalCp: 0 }));
      expect((await analysis(jsonRequest("", { startEvalCp: 0, evals: foreign }), params(game.id))).status).toBe(400);
      expect((await analysis(jsonRequest("", { startEvalCp: 0, evals: one }), params("bad"))).status).toBe(404);

      const active = await createGame({ whiteId: "local/random", blackId: "local/greedy" });
      expect((await analysis(jsonRequest("", { startEvalCp: 0, evals: one }), params(active.id))).status).toBe(400);
    });
  });

  describe("seeding", () => {
    it("never deletes games or touches ratings, even when re-run", async () => {
      const game = await createGame({ whiteId: "local/engine-2", blackId: "local/random" });
      await processGame(game, 0);
      await endGame(game.id, "1-0", "Checkmate");
      const before = await getModel("local/engine-2");
      await seedRoster(db);
      await seedRoster(db);
      expect(await getGame(game.id)).toMatchObject({ status: "complete", result: "1-0" });
      expect(await getMoves(game.id)).toHaveLength(1);
      expect(await getModel("local/engine-2")).toEqual(before);
    });
  });

  describe("GET /api/leaderboard", () => {
    it("orders by rating", async () => {
      await db.update(models).set({ elo: 1700 }).where(eq(models.id, "local/engine-4"));
      const { models: rows } = await (await leaderboard(get("/api/leaderboard"))).json();
      expect(rows[0].id).toBe("local/engine-4");
      expect(rows.length).toBeGreaterThan(10);
    });
  });
});
