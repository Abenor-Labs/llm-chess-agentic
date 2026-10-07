import { db } from "@/db";
import { games, models, moves, publicGameColumns } from "@/db/schema";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { isRatedPairing } from "./modes";
import type { GameDetailResponse, GameListItem, GameStatus, PublicGame } from "@/types/api";

type PublicRow = { [K in keyof typeof publicGameColumns]: unknown } & {
  whiteMode: string;
  blackMode: string;
};

export function toPublicGame<T extends PublicRow>(row: T): T & { rated: boolean } {
  return { ...row, rated: isRatedPairing(row.whiteMode, row.blackMode) };
}

/** Games by status, newest first, with both models and a move count. */
export async function listGames(status: GameStatus, limit: number): Promise<GameListItem[]> {
  const rows = await db
    .select(publicGameColumns)
    .from(games)
    .where(eq(games.status, status))
    .orderBy(desc(status === "complete" ? games.endedAt : games.startedAt), desc(games.startedAt))
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
