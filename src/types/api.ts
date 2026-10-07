import { z } from "zod";
import type { Game, Model, Move } from "@/db/schema";
import { SkillModeSchema } from "@/lib/modes";

export const GameStatusSchema = z.enum(["active", "complete"]);
export type GameStatus = z.infer<typeof GameStatusSchema>;

export const GameIdSchema = z.string().uuid();

const Key = z.string().trim().max(512).optional();

export const StartGameRequestSchema = z
  .object({
    /** [white, black] */
    modelIds: z.tuple([z.string().min(1).max(200), z.string().min(1).max(200)]),
    whiteMode: SkillModeSchema.optional(),
    blackMode: SkillModeSchema.optional(),
    keys: z
      .object({ groq: Key, google: Key, anthropic: Key, openai: Key })
      .partial()
      .optional(),
    /** Legacy field names, still accepted. */
    groqApiKey: Key,
    geminiApiKey: Key,
  })
  .refine((data) => data.modelIds[0] !== data.modelIds[1], {
    message: "A model cannot play against itself; pick two different models",
    path: ["modelIds"],
  });
export type StartGameRequest = z.infer<typeof StartGameRequestSchema>;

/** Game columns safe for clients, plus derived fields. */
export type PublicGame = Omit<
  Game,
  "groqApiKey" | "geminiApiKey" | "anthropicApiKey" | "openaiApiKey" | "processing" | "processingStartedAt"
> & { rated: boolean };

export interface GameDetailResponse {
  game: PublicGame;
  moves: Move[];
  white: Model;
  black: Model;
}

export type GameListItem = PublicGame & { whiteModel?: Model; blackModel?: Model; moveCount: number };

export interface GamesListResponse {
  games: GameListItem[];
}

export interface LeaderboardResponse {
  models: Model[];
}

export interface AccuracyStat {
  modelId: string;
  name: string;
  provider: string;
  moveCount: number;
  acpl: number;
  accuracy: number;
  blunders: number;
  blunderRate: number;
}
