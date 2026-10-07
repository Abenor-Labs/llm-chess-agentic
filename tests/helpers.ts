import { sql, eq } from "drizzle-orm";
import { db } from "@/db";
import { games, models, moves } from "@/db/schema";
import { seedRoster } from "@/db/seed";
import { STARTING_FEN } from "@/lib/chess";

export const hasDb = Boolean(process.env.TEST_DATABASE_URL);

/** Empty every table and re-seed the roster (ratings at 1500). */
export async function resetDb() {
  await db.execute(sql`TRUNCATE moves, games, models, tournament RESTART IDENTITY CASCADE`);
  await seedRoster(db);
}

export async function createGame(values: Partial<typeof games.$inferInsert> & { whiteId: string; blackId: string }) {
  const [game] = await db
    .insert(games)
    .values({ fen: STARTING_FEN, status: "active", startedAt: new Date(), ...values })
    .returning();
  return game;
}

export async function getGame(id: string) {
  const [game] = await db.select().from(games).where(eq(games.id, id));
  return game;
}

export async function getMoves(gameId: string) {
  return db
    .select()
    .from(moves)
    .where(eq(moves.gameId, gameId))
    .orderBy(moves.moveNumber, moves.color, moves.createdAt);
}

export async function getModel(id: string) {
  const [model] = await db.select().from(models).where(eq(models.id, id));
  return model;
}

export function jsonRequest(url: string, body?: unknown, init: RequestInit = {}) {
  return new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}
