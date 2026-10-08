-- Serverless-safe processing-claim columns
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "processing" boolean DEFAULT false NOT NULL;
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "processing_started_at" timestamp;
