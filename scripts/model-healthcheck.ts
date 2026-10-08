/**
 * Asks every active model with an available key for one opening move and
 * reports latency and the judge's view of the answer. Read-only.
 *
 *   pnpm healthcheck [--mode grandmaster]
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

async function main() {
  const [{ db }, { models }, { eq }, ai, { resolveMove, STARTING_FEN, getLegalMoves }] = await Promise.all([
    import("../src/db"),
    import("../src/db/schema"),
    import("drizzle-orm"),
    import("../src/lib/ai"),
    import("../src/lib/chess"),
  ]);
  const modeIdx = process.argv.indexOf("--mode");
  const mode = modeIdx >= 0 ? process.argv[modeIdx + 1] : "scholar";
  const roster = await db.select().from(models).where(eq(models.active, true));
  const rows: Array<Record<string, string | number>> = [];

  for (const m of roster) {
    const provider = ai.providerOf(m.id);
    if (provider === "local") continue;
    if (ai.isKeyedProvider(provider) && !ai.resolveKey(provider)) {
      rows.push({ model: m.id, status: "skipped (no key)" });
      continue;
    }
    try {
      const reply = await ai.requestMove(m.id, {
        fen: STARTING_FEN,
        color: "white",
        legalMoves: getLegalMoves(STARTING_FEN),
        history: [],
        mode,
      });
      const legal = resolveMove(STARTING_FEN, reply.move);
      rows.push({ model: m.id, status: legal ? "ok" : "illegal", move: legal?.san ?? reply.move, ms: reply.latencyMs });
    } catch (err) {
      rows.push({ model: m.id, status: `error: ${err instanceof Error ? err.message : String(err)}`.slice(0, 120) });
    }
  }
  console.table(rows);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
