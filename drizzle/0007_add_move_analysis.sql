-- Post-game analysis columns
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "analyzed" boolean DEFAULT false NOT NULL;
ALTER TABLE "moves" ADD COLUMN IF NOT EXISTS "eval_cp" integer;
ALTER TABLE "moves" ADD COLUMN IF NOT EXISTS "cp_loss" integer;
ALTER TABLE "moves" ADD COLUMN IF NOT EXISTS "move_accuracy" integer;
