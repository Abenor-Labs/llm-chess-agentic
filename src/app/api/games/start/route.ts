import { NextResponse } from "next/server";
import { db } from "@/db";
import { games, models, tournament } from "@/db/schema";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { processGame, purgeLegacyCancelledGames } from "@/lib/game-processor";
import { providerOf, isKeyedProvider, resolveKey, PROVIDER_LABEL, type ApiKeys, type KeyedProvider } from "@/lib/ai";
import { StartGameRequestSchema } from "@/types/api";
import { encryptSecret } from "@/lib/crypto";
import { DEFAULT_MODE } from "@/lib/modes";
import { requireUser } from "@/lib/auth/server";
import { isHuman } from "@/lib/provider-ids";
import { arenaOnly } from "@/lib/game-queries";

// The first ply is played synchronously so a rejected key surfaces right here.
// Must be a literal for Next.js; tests assert it equals GAME_RULES.TICK_MAX_DURATION_S.
export const maxDuration = 300;

class StartError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const body = await request.json().catch(() => null);
  const parsed = StartGameRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { modelIds, whiteMode, blackMode } = parsed.data;
  const [whiteId, blackId] = modelIds;
  // Human games (vs AI, or a Human vs Human room) run alongside the AI arena.
  const humanGame = isHuman(whiteId) || isHuman(blackId);
  const mySeat = isHuman(whiteId) && isHuman(blackId) ? (parsed.data.seat ?? "white") : isHuman(whiteId) ? "white" : isHuman(blackId) ? "black" : null;
  const myName = user.name?.trim() || "Player";

  // Only keys for providers actually playing are kept (and only for this match).
  const supplied: ApiKeys = {
    groq: parsed.data.keys?.groq || parsed.data.groqApiKey,
    google: parsed.data.keys?.google || parsed.data.geminiApiKey,
    anthropic: parsed.data.keys?.anthropic,
    openai: parsed.data.keys?.openai,
    subq: parsed.data.keys?.subq,
  };
  const needed = new Set(modelIds.map(providerOf).filter(isKeyedProvider));
  for (const provider of needed) {
    if (!resolveKey(provider, supplied)) {
      return NextResponse.json(
        { error: `A ${PROVIDER_LABEL[provider]} API key is required for the selected models. Add it in Settings.`, provider },
        { status: 400 },
      );
    }
  }
  const stored = (p: KeyedProvider) => {
    const key = needed.has(p) ? supplied[p]?.trim() : undefined;
    return key ? encryptSecret(key) : null;
  };

  await purgeLegacyCancelledGames().catch((err) => console.error("[start] legacy purge failed", err));

  let gameId: string;
  try {
    gameId = await db.transaction(async (tx) => {
      // Serialize starts; the unique partial index on active games is the backstop.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(12345)`);
      if (humanGame) {
        const [mine] = await tx
          .select({ id: games.id })
          .from(games)
          .where(and(eq(games.status, "active"), or(eq(games.whiteUserId, user.id), eq(games.blackUserId, user.id))))
          .limit(1);
        if (mine) throw new StartError("You already have a live game. Finish it before starting another.", 409);
      } else {
        const [active] = await tx.select({ id: games.id }).from(games).where(and(eq(games.status, "active"), arenaOnly)).limit(1);
        if (active) throw new StartError("A game is already running. Stop it before starting another.", 409);
      }

      const rows = await tx
        .select({ id: models.id })
        .from(models)
        .where(and(inArray(models.id, [whiteId, blackId]), eq(models.active, true)));
      const found = new Set(rows.map((r) => r.id));
      const missing = modelIds.filter((id) => !found.has(id));
      if (missing.length) throw new StartError(`Unknown or inactive model: ${missing.join(", ")}`);

      const id = randomUUID();
      await tx.insert(games).values({
        id,
        whiteId,
        blackId,
        status: "active",
        startedAt: new Date(),
        startedBy: user.id,
        ...(mySeat === "white" ? { whiteUserId: user.id, whiteUserName: myName } : {}),
        ...(mySeat === "black" ? { blackUserId: user.id, blackUserName: myName } : {}),
        whiteMode: whiteMode ?? DEFAULT_MODE,
        blackMode: blackMode ?? DEFAULT_MODE,
        groqApiKey: stored("groq"),
        geminiApiKey: stored("google"),
        anthropicApiKey: stored("anthropic"),
        openaiApiKey: stored("openai"),
        subqApiKey: stored("subq"),
      });
      await tx
        .insert(tournament)
        .values({ id: 1, status: "running", startedAt: new Date() })
        .onConflictDoUpdate({ target: tournament.id, set: { status: "running", startedAt: new Date() } });
      return id;
    });
  } catch (error) {
    if (error instanceof StartError) return NextResponse.json({ error: error.message }, { status: error.status });
    if ((error as { code?: string })?.code === "23505") {
      return NextResponse.json({ error: "A game is already running. Stop it before starting another." }, { status: 409 });
    }
    console.error("[start] failed to create game", error);
    return NextResponse.json({ error: "Failed to start game" }, { status: 500 });
  }

  // Play the opening move now: a bad key or unknown model fails fast, here,
  // instead of leaving a dead game for the client to poll.
  const summary = await processGame({ id: gameId }, 0).catch((err) => {
    console.error("[start] first move failed", err);
    return { plies: 0, abortedReason: undefined };
  });
  if (summary.abortedReason) {
    return NextResponse.json({ error: `The match could not start — ${summary.abortedReason}.` }, { status: 400 });
  }

  return NextResponse.json({ success: true, gameId, white: whiteId, black: blackId });
}
