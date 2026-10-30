-- Who started the match (neon_auth."user".id). Kept as plain text: auth lives in
-- the Neon branch's neon_auth schema, which local/test databases don't have.
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "started_by" text;
