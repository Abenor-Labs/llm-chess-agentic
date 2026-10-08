ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "white_timeout_warnings" integer DEFAULT 0 NOT NULL;
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "black_timeout_warnings" integer DEFAULT 0 NOT NULL;
