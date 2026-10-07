/**
 * Seeds the model roster. Non-destructive by design: upserts names/providers,
 * keeps ratings and history, and deactivates retired models (rows referenced by
 * past games can't be deleted). There is deliberately no way to wipe the arena.
 *
 *   pnpm db:seed
 */
import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { notInArray } from "drizzle-orm";
import { models, tournament } from "./schema";

export const ROSTER: Array<{ id: string; name: string; provider: string }> = [
  // Built-in engines: no key needed; fixed anchors for the rating pool.
  { id: "local/random", name: "Random Mover", provider: "local" },
  { id: "local/greedy", name: "Greedy Grabber", provider: "local" },
  { id: "local/engine-2", name: "Arena Engine (depth 2)", provider: "local" },
  { id: "local/engine-4", name: "Arena Engine (depth 4)", provider: "local" },

  // Groq
  { id: "groq/openai/gpt-oss-120b", name: "GPT-OSS 120B", provider: "groq" },
  { id: "groq/openai/gpt-oss-20b", name: "GPT-OSS 20B", provider: "groq" },
  { id: "groq/qwen/qwen3.6-27b", name: "Qwen 3.6 27B", provider: "groq" },

  // Google Gemini
  { id: "google/models/gemini-3.5-flash", name: "Gemini 3.5 Flash", provider: "google" },
  { id: "google/models/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview", provider: "google" },
  { id: "google/models/gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", provider: "google" },
  { id: "google/models/gemini-3-flash-preview", name: "Gemini 3 Flash Preview", provider: "google" },
  { id: "google/models/gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "google" },
  { id: "google/models/gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "google" },

  // Anthropic
  { id: "anthropic/claude-opus-5-5", name: "Claude Opus 5.5", provider: "anthropic" },
  { id: "anthropic/claude-sonnet-5-5", name: "Claude Sonnet 5.5", provider: "anthropic" },
  { id: "anthropic/claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "anthropic" },

  // OpenAI
  { id: "openai/gpt-5.6-terra", name: "GPT-5.6 Terra", provider: "openai" },
  { id: "openai/gpt-5.6-luna", name: "GPT-5.6 Luna", provider: "openai" },
];

type Db = ReturnType<typeof drizzle>;

export async function seedRoster(db: Db) {
  for (const m of ROSTER) {
    await db
      .insert(models)
      .values({ ...m, active: true })
      .onConflictDoUpdate({ target: models.id, set: { name: m.name, provider: m.provider, active: true } });
  }
  await db
    .update(models)
    .set({ active: false })
    .where(notInArray(models.id, ROSTER.map((m) => m.id)));
  await db.insert(tournament).values({ id: 1 }).onConflictDoNothing();
}

if (process.argv[1]?.endsWith("seed.ts")) {
  config({ path: ".env.local", quiet: true });
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const client = postgres(url, { max: 1 });
  seedRoster(drizzle(client))
    .then(() => console.log(`Seeded ${ROSTER.length} models.`))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => client.end());
}
