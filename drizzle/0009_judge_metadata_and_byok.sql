-- Judge transparency: the player's plan, what the judge did, and think time.
ALTER TABLE "moves" ADD COLUMN IF NOT EXISTS "plan" text;
ALTER TABLE "moves" ADD COLUMN IF NOT EXISTS "judge" jsonb;
ALTER TABLE "moves" ADD COLUMN IF NOT EXISTS "think_ms" integer;
CREATE INDEX IF NOT EXISTS "moves_game_ply_idx" ON "moves" ("game_id", "move_number");

-- Bring-your-own keys for every direct provider, and a visible status note.
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "anthropic_api_key" text;
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "openai_api_key" text;
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "status_note" text;

-- Server-wide keys are gone (anyone could overwrite them); drop the leftovers.
ALTER TABLE "tournament" DROP COLUMN IF EXISTS "groq_api_key";
ALTER TABLE "tournament" DROP COLUMN IF EXISTS "gemini_api_key";
ALTER TABLE "tournament" DROP COLUMN IF EXISTS "tick_interval_sec";

-- At most one active game at a time (the start route also serializes this).
-- Close any stray duplicates first (keeping the newest) so the index can build.
UPDATE "games" SET "status" = 'complete', "ended_at" = now(), "result_reason" = 'Closed: duplicate active game'
WHERE "status" = 'active' AND "id" <> (
  SELECT "id" FROM "games" WHERE "status" = 'active' ORDER BY "started_at" DESC LIMIT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS "games_single_active_idx" ON "games" ("status") WHERE "status" = 'active';
