import { NextResponse } from "next/server";
import { db } from "@/db";
import { tournament, games } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { processGame } from "@/lib/game-processor";

// A tick plays plies for up to GAME_RULES.TICK_BUDGET_MS plus one in-flight ply
// (bounded by PLY_DEADLINE_MS). Must be a literal for Next.js; tests assert it
// equals GAME_RULES.TICK_MAX_DURATION_S.
export const maxDuration = 300;

/**
 * Advances active games. Intentionally unauthenticated: there is no server cron
 * (the browser drives ticks while someone is watching), and a tick can only
 * advance already-active games, serialized by each game's processing claim.
 */
async function handleTick() {
  const activeGames = await db.select({ id: games.id }).from(games).where(eq(games.status, "active"));
  const results = await Promise.allSettled(activeGames.map((g) => processGame(g)));
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length) console.error(`[tick] ${failed.length} game(s) failed:`, failed.map((r) => (r as PromiseRejectedResult).reason));

  const [state] = await db
    .insert(tournament)
    .values({ id: 1, tickCount: 1, lastTickAt: new Date() })
    .onConflictDoUpdate({ target: tournament.id, set: { tickCount: sql`${tournament.tickCount} + 1`, lastTickAt: new Date() } })
    .returning({ tickCount: tournament.tickCount });

  return NextResponse.json({
    success: true,
    gamesProcessed: activeGames.length,
    gamesFailed: failed.length,
    pliesPlayed: results.reduce((n, r) => n + (r.status === "fulfilled" ? r.value.plies : 0), 0),
    tickCount: state?.tickCount ?? 0,
  });
}

export async function GET() {
  return handleTick();
}

export async function POST() {
  return handleTick();
}
