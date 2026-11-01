import { db } from "@/db";
import { games, models, moves, publicGameColumns } from "@/db/schema";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { isRatedPairing } from "./modes";
import { HUMAN_ID, isHuman } from "./provider-ids";
import type { GameDetailResponse, GameListItem, GameStatus, PublicGame } from "@/types/api";

type PublicRow = { [K in keyof typeof publicGameColumns]: unknown } & {
  whiteId: string;
  blackId: string;
  whiteMode: string;
  blackMode: string;
};

export function toPublicGame<T extends PublicRow>(row: T): T & { rated: boolean } {
  // Human games never move ratings, whatever the modes.
  return { ...row, rated: !isHuman(row.whiteId) && !isHuman(row.blackId) && isRatedPairing(row.whiteMode, row.blackMode) };
}

/** AI-vs-AI games only (the arena), as opposed to games with a human seat. */
export const arenaOnly = and(ne(games.whiteId, HUMAN_ID), ne(games.blackId, HUMAN_ID))!;

/** Human vs Human rooms still waiting for their second player. */
export const openRooms = and(
  eq(games.whiteId, HUMAN_ID),
  eq(games.blackId, HUMAN_ID),
  or(isNull(games.whiteUserId), isNull(games.blackUserId)),
)!;

/** Games where this user holds a seat. */
export const seatedBy = (userId: string) => or(eq(games.whiteUserId, userId), eq(games.blackUserId, userId))!;

/** Games by status, newest first, with both models and a move count. */
export async function listGames(status: GameStatus, limit: number, filter?: SQL): Promise<GameListItem[]> {
  const rows = await db
    .select(publicGameColumns)
    .from(games)
    .where(filter ? and(eq(games.status, status), filter) : eq(games.status, status))
    // Legacy rows can lack ended_at; Postgres sorts NULLs first under DESC, so fall back to started_at.
    .orderBy(sql`coalesce(${status === "complete" ? games.endedAt : games.startedAt}, ${games.startedAt}) desc`, desc(games.startedAt))
    .limit(limit);
  if (rows.length === 0) return [];

  const ids = Array.from(new Set(rows.flatMap((g) => [g.whiteId, g.blackId])));
  const [modelRows, counts] = await Promise.all([
    db.select().from(models).where(inArray(models.id, ids)),
    db
      .select({ gameId: moves.gameId, n: sql<number>`count(*)::int` })
      .from(moves)
      .where(inArray(moves.gameId, rows.map((g) => g.id)))
      .groupBy(moves.gameId),
  ]);
  const byId = new Map(modelRows.map((m) => [m.id, m]));
  const moveCounts = new Map(counts.map((c) => [c.gameId, Number(c.n)]));
  return rows.map((g) => ({
    ...(toPublicGame(g) as PublicGame),
    moveCount: moveCounts.get(g.id) ?? 0,
    whiteModel: byId.get(g.whiteId),
    blackModel: byId.get(g.blackId),
  }));
}

/** One game with its moves in ply order and both models, or null. */
export async function getGameDetail(id: string): Promise<GameDetailResponse | null> {
  const [game] = await db.select(publicGameColumns).from(games).where(eq(games.id, id));
  if (!game) return null;
  const [gameMoves, players] = await Promise.all([
    db
      .select()
      .from(moves)
      .where(eq(moves.gameId, id))
      // Fullmove number is shared by both plies of a pair; color (enum order
      // white < black) breaks the tie deterministically.
      .orderBy(asc(moves.moveNumber), asc(moves.color), asc(moves.createdAt)),
    db.select().from(models).where(inArray(models.id, [game.whiteId, game.blackId])),
  ]);
  const white = players.find((m) => m.id === game.whiteId);
  const black = players.find((m) => m.id === game.blackId);
  if (!white || !black) return null;
  return { game: toPublicGame(game) as PublicGame, moves: gameMoves, white, black };
}
