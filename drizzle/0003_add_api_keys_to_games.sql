ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "groq_api_key" text;
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "gemini_api_key" text;
