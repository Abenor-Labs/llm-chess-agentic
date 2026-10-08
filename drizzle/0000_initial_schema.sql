-- Base schema. Every migration in this folder is idempotent (IF NOT EXISTS /
-- guarded DO blocks), so `pnpm db:migrate` is safe on fresh and existing DBs.
DO $$ BEGIN
  CREATE TYPE "public"."game_result" AS ENUM('1-0', '0-1', '1/2-1/2');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."game_status" AS ENUM('active', 'complete');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "public"."tournament_status" AS ENUM('stopped', 'running');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "models" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"elo" integer DEFAULT 1500 NOT NULL,
	"games_played" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"draws" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);

CREATE TABLE IF NOT EXISTS "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"white_id" text NOT NULL REFERENCES "public"."models"("id"),
	"black_id" text NOT NULL REFERENCES "public"."models"("id"),
	"pgn" text DEFAULT '' NOT NULL,
	"fen" text DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' NOT NULL,
	"status" "game_status" DEFAULT 'active' NOT NULL,
	"result" "game_result",
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);

CREATE TABLE IF NOT EXISTS "moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL REFERENCES "public"."games"("id"),
	"model_id" text NOT NULL REFERENCES "public"."models"("id"),
	"move_number" integer NOT NULL,
	"move_san" text NOT NULL,
	"fen_after" text NOT NULL,
	"reasoning" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "tournament" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"status" "tournament_status" DEFAULT 'stopped' NOT NULL,
	"tick_count" integer DEFAULT 0 NOT NULL,
	"last_tick_at" timestamp,
	"started_at" timestamp
);
