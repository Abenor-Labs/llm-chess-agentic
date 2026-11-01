import { NextResponse } from "next/server";
import { db } from "@/db";
import { models, players } from "@/db/schema";
import { desc, ne, sql } from "drizzle-orm";
import { HUMAN_ID } from "@/lib/provider-ids";

export type HumanVsAiRow = {
  userId: string;
  name: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** Average rating of the AI opponents faced. */
  avgOpponentElo: number;
};

/**
 * GET /api/leaderboard?board=ai|vs-ai|humans
 * ai (default): model ratings. vs-ai: each player's record against AI models
 * (AI ratings never move in these games). humans: the Human vs Human ladder.
 */
export async function GET(request: Request) {
  const board = new URL(request.url).searchParams.get("board") ?? "ai";

  if (board === "humans") {
    const rows = await db.select().from(players).orderBy(desc(players.elo), desc(players.gamesPlayed), players.name);
    return NextResponse.json({ players: rows });
  }

  if (board === "vs-ai") {
    // One row per human seat in a decided Human vs AI game, scored from that seat's side.
    const rows = await db.execute<HumanVsAiRow>(sql`
      SELECT s.user_id AS "userId", coalesce(max(s.name), 'Player') AS name, count(*)::int AS games,
             sum(win)::int AS wins, sum(loss)::int AS losses, sum(draw)::int AS draws,
             round(avg(m.elo))::int AS "avgOpponentElo"
      FROM (
        SELECT white_user_id AS user_id, white_user_name AS name, black_id AS opponent,
               (result = '1-0')::int AS win, (result = '0-1')::int AS loss, (result = '1/2-1/2')::int AS draw
        FROM games WHERE status = 'complete' AND result IS NOT NULL AND white_id = ${HUMAN_ID} AND black_id <> ${HUMAN_ID}
        UNION ALL
        SELECT black_user_id, black_user_name, white_id,
               (result = '0-1')::int, (result = '1-0')::int, (result = '1/2-1/2')::int
        FROM games WHERE status = 'complete' AND result IS NOT NULL AND black_id = ${HUMAN_ID} AND white_id <> ${HUMAN_ID}
      ) s
      JOIN models m ON m.id = s.opponent
      WHERE s.user_id IS NOT NULL
      GROUP BY s.user_id
      ORDER BY (sum(win) + 0.5 * sum(draw)) / count(*) DESC, count(*) DESC
    `);
    return NextResponse.json({ players: [...rows] });
  }

  const leaderboard = await db.select().from(models).where(ne(models.id, HUMAN_ID)).orderBy(desc(models.elo), desc(models.gamesPlayed), models.name);
  return NextResponse.json({ models: leaderboard });
}
