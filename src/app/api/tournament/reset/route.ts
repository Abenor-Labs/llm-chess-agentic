import { NextResponse } from "next/server";
import { db } from "@/db";
import { tournament, games, moves, models } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Wipes every game and resets all ratings. Destructive and global, so it needs
 * `Authorization: Bearer $ADMIN_TOKEN`; without ADMIN_TOKEN configured it is only
 * available in development. (`pnpm db:seed --reset` does the same from a shell.)
 */
export async function POST(request: Request) {
  const token = process.env.ADMIN_TOKEN;
  if (token) {
    if (request.headers.get("authorization") !== `Bearer ${token}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Reset is disabled (set ADMIN_TOKEN to enable it)" }, { status: 403 });
  }

  await db.transaction(async (tx) => {
    await tx.delete(moves);
    await tx.delete(games);
    await tx.update(models).set({ elo: 1500, gamesPlayed: 0, wins: 0, losses: 0, draws: 0 });
    await tx.update(tournament).set({ status: "stopped", tickCount: 0, startedAt: null }).where(eq(tournament.id, 1));
  });
  return NextResponse.json({ success: true });
}
