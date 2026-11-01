-- Human seats: who plays each "human" side, and the name shown for them.
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "white_user_id" text;
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "black_user_id" text;
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "white_user_name" text;
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "black_user_name" text;

-- Human vs AI games from before seats existed: the starter was the human.
UPDATE "games" SET "white_user_id" = "started_by" WHERE "white_id" = 'human' AND "white_user_id" IS NULL;
UPDATE "games" SET "black_user_id" = "started_by" WHERE "black_id" = 'human' AND "black_user_id" IS NULL;

-- Only the AI-vs-AI arena is limited to one live game; human games run alongside it.
DROP INDEX IF EXISTS "games_single_active_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "games_single_arena_idx" ON "games" ("status")
  WHERE "status" = 'active' AND "white_id" <> 'human' AND "black_id" <> 'human';

-- Human vs Human ratings.
CREATE TABLE IF NOT EXISTS "players" (
  "user_id" text PRIMARY KEY,
  "name" text NOT NULL,
  "elo" integer NOT NULL DEFAULT 1500,
  "games_played" integer NOT NULL DEFAULT 0,
  "wins" integer NOT NULL DEFAULT 0,
  "losses" integer NOT NULL DEFAULT 0,
  "draws" integer NOT NULL DEFAULT 0
);

-- Names for those earlier human seats, where Neon Auth lives in this database.
DO $$
BEGIN
  IF to_regclass('neon_auth."user"') IS NOT NULL THEN
    UPDATE "games" g SET "white_user_name" = u."name" FROM neon_auth."user" u
      WHERE g."white_user_id" = u."id"::text AND g."white_user_name" IS NULL;
    UPDATE "games" g SET "black_user_name" = u."name" FROM neon_auth."user" u
      WHERE g."black_user_id" = u."id"::text AND g."black_user_name" IS NULL;
  END IF;
END $$;
