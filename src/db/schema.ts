import { pgTable, text, integer, uuid, timestamp, pgEnum, boolean, jsonb, index } from "drizzle-orm/pg-core";
import type { JudgeRecord } from "@/lib/judge-types";
import { STARTING_FEN } from "@/lib/chess";

export const tournamentStatusEnum = pgEnum("tournament_status", ["stopped", "running"]);
export const gameStatusEnum = pgEnum("game_status", ["active", "complete"]);
export const gameResultEnum = pgEnum("game_result", ["1-0", "0-1", "1/2-1/2"]);
export const colorEnum = pgEnum("color", ["white", "black"]);

export const models = pgTable("models", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  provider: text("provider").notNull(),
  elo: integer("elo").notNull().default(1500),
  gamesPlayed: integer("games_played").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  draws: integer("draws").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const games = pgTable("games", {
  id: uuid("id").primaryKey().defaultRandom(),
  whiteId: text("white_id").notNull().references(() => models.id),
  blackId: text("black_id").notNull().references(() => models.id),
  pgn: text("pgn").notNull().default(""),
  fen: text("fen").notNull().default(STARTING_FEN),
  status: gameStatusEnum("status").notNull().default("active"),
  result: gameResultEnum("result"),
  resultReason: text("result_reason"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
  whiteTimeoutWarnings: integer("white_timeout_warnings").notNull().default(0),
  blackTimeoutWarnings: integer("black_timeout_warnings").notNull().default(0),
  // Skill mode per side (novice..grandmaster) — drives temperature, candidate
  // filtering and the blunder guard in the game processor.
  whiteMode: text("white_mode").notNull().default("scholar"),
  blackMode: text("black_mode").notNull().default("scholar"),
  // Bring-your-own keys for this match only, encrypted at rest when
  // ENCRYPTION_KEY is set. Never returned to clients (see publicGameColumns).
  groqApiKey: text("groq_api_key"),
  geminiApiKey: text("gemini_api_key"),
  anthropicApiKey: text("anthropic_api_key"),
  openaiApiKey: text("openai_api_key"),
  // Why the game is waiting, e.g. "Black: rate limited by Groq — retrying".
  // Cleared by the next successful move.
  statusNote: text("status_note"),
  // Serverless-safe processing claim: a game is claimed atomically before a tick
  // processes it, preventing overlapping ticks / instances from double-moving.
  processing: boolean("processing").notNull().default(false),
  processingStartedAt: timestamp("processing_started_at"),
  // Set true once post-game Stockfish analysis (per-move eval/cpLoss/accuracy)
  // has been computed and stored, so it is only done once per game.
  analyzed: boolean("analyzed").notNull().default(false),
});

export const moves = pgTable(
  "moves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id").notNull().references(() => games.id),
    modelId: text("model_id").notNull().references(() => models.id),
    color: colorEnum("color").notNull(), // Which side made this move: white or black
    moveNumber: integer("move_number").notNull(),
    moveSan: text("move_san").notNull(),
    fenAfter: text("fen_after").notNull(),
    reasoning: text("reasoning").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    // Post-game Stockfish analysis (nullable until the game is analyzed):
    // evalCp   - engine eval of fenAfter, white's perspective, in centipawns
    // cpLoss   - centipawns lost by this move vs. holding the prior eval (>= 0)
    // moveAccuracy - per-move accuracy 0-100 (Lichess-style win%-based)
    evalCp: integer("eval_cp"),
    cpLoss: integer("cp_loss"),
    moveAccuracy: integer("move_accuracy"),
    // The player's stated plan, fed back into its next prompt.
    plan: text("plan"),
    // What the judge did this ply (retries, notation fixes, blunder warnings).
    judge: jsonb("judge").$type<JudgeRecord>(),
    // Wall-clock time the side spent producing this move.
    thinkMs: integer("think_ms"),
  },
  (t) => [index("moves_game_ply_idx").on(t.gameId, t.moveNumber)],
);

export const tournament = pgTable("tournament", {
  id: integer("id").primaryKey().default(1),
  status: tournamentStatusEnum("status").notNull().default("stopped"),
  tickCount: integer("tick_count").notNull().default(0),
  lastTickAt: timestamp("last_tick_at"),
  startedAt: timestamp("started_at"),
});

// Game columns safe to return to clients — excludes per-game API keys and the
// internal processing claim.
export const publicGameColumns = {
  id: games.id,
  whiteId: games.whiteId,
  blackId: games.blackId,
  pgn: games.pgn,
  fen: games.fen,
  status: games.status,
  result: games.result,
  resultReason: games.resultReason,
  startedAt: games.startedAt,
  endedAt: games.endedAt,
  whiteTimeoutWarnings: games.whiteTimeoutWarnings,
  blackTimeoutWarnings: games.blackTimeoutWarnings,
  whiteMode: games.whiteMode,
  blackMode: games.blackMode,
  analyzed: games.analyzed,
  statusNote: games.statusNote,
};

export type Model = typeof models.$inferSelect;
export type Game = typeof games.$inferSelect;
export type Move = typeof moves.$inferSelect;
export type Tournament = typeof tournament.$inferSelect;