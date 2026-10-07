/**
 * Applies drizzle/*.sql in order, recording each in _arena_migrations.
 * Every migration is idempotent, so this is safe on a fresh database, on one
 * created with `drizzle-kit push`, and on one migrated by hand.
 *
 *   pnpm db:migrate                  # uses DATABASE_URL (.env.local)
 *   DATABASE_URL=... pnpm db:migrate
 */
import { config } from "dotenv";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });

export async function migrate(url: string, opts: { log?: boolean } = {}): Promise<string[]> {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const dir = join(process.cwd(), "drizzle");
  const applied: string[] = [];
  try {
    await sql`CREATE TABLE IF NOT EXISTS _arena_migrations (name text PRIMARY KEY, applied_at timestamp NOT NULL DEFAULT now())`;
    const done = new Set((await sql<{ name: string }[]>`SELECT name FROM _arena_migrations`).map((r) => r.name));
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      await sql.begin(async (tx) => {
        await tx.unsafe(readFileSync(join(dir, file), "utf8"));
        await tx`INSERT INTO _arena_migrations (name) VALUES (${file})`;
      });
      applied.push(file);
      if (opts.log) console.log(`applied ${file}`);
    }
    if (opts.log && applied.length === 0) console.log("database is up to date");
  } finally {
    await sql.end();
  }
  return applied;
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  migrate(url, { log: true }).catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
