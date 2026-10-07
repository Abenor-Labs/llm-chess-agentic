-- Historical: global keys were removed in favour of per-match keys (0009 drops these).
ALTER TABLE "tournament" ADD COLUMN IF NOT EXISTS "groq_api_key" text;
ALTER TABLE "tournament" ADD COLUMN IF NOT EXISTS "gemini_api_key" text;
