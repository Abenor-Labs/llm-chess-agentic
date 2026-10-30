-- Bring-your-own key for SubQ (https://subq.ai).
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "subq_api_key" text;
