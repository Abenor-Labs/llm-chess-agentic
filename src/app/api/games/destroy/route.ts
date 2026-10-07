import { NextResponse } from "next/server";
import { db } from "@/db";
import { games, moves } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { abortGame, endGame } from "@/lib/game-processor";
import { GameIdSchema } from "@/types/api";

/**
 * Stops the active game (or the given active game id). A game with no moves is
 * deleted; otherwise it is ended without a result, so it never affects ratings.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const requested = GameIdSchema.safeParse(body?.gameId);
  const [active] = await db
    .select({ id: games.id })
    .from(games)
    .where(requested.success ? and(eq(games.status, "active"), eq(games.id, requested.data)) : eq(games.status, "active"))
    .limit(1);
  if (!active) return NextResponse.json({ success: true, aborted: 0 });

  const [{ played }] = await db
    .select({ played: sql<number>`count(*)::int` })
    .from(moves)
    .where(eq(moves.gameId, active.id));
  if (played === 0) await abortGame(active.id);
  else await endGame(active.id, null, "Match stopped by user");

  return NextResponse.json({ success: true, aborted: 1, gameId: active.id, deleted: played === 0 });
}
