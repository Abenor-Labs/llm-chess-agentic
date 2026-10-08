/**
 * Plays a full match through the real processor and database, printing each
 * move as it lands. Built-in engines need no keys; LLMs use the env keys.
 *
 *   pnpm simulate                                   # Arena Engine (depth 2) vs Random Mover
 *   pnpm simulate local/engine-4 groq/openai/gpt-oss-120b --black-mode grandmaster
 *
 * Refuses to run while another game is active.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

async function main() {
  const [{ db }, { games, moves }, { processGame }, { eq, asc }] = await Promise.all([
    import("../src/db"),
    import("../src/db/schema"),
    import("../src/lib/game-processor"),
    import("drizzle-orm"),
  ]);
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args.splice(i, 2)[1] : undefined;
  };
  const whiteMode = flag("--white-mode") ?? "scholar";
  const blackMode = flag("--black-mode") ?? "scholar";
  const [whiteId = "local/engine-2", blackId = "local/random"] = args;

  const [active] = await db.select({ id: games.id }).from(games).where(eq(games.status, "active"));
  if (active) throw new Error(`Game ${active.id} is already active; stop it first.`);

  const [game] = await db.insert(games).values({ whiteId, blackId, whiteMode, blackMode }).returning();
  console.log(`${whiteId} (${whiteMode}) vs ${blackId} (${blackMode}) — game ${game.id}`);

  let printed = 0;
  for (;;) {
    const summary = await processGame(game, 10_000);
    const rows = await db.select().from(moves).where(eq(moves.gameId, game.id)).orderBy(asc(moves.moveNumber), asc(moves.color));
    for (const m of rows.slice(printed)) {
      const judge = m.judge?.events.length ? `  [judge: ${m.judge.events.map((e) => e.type).join(", ")}]` : "";
      console.log(`${m.moveNumber}${m.color === "white" ? "." : "..."} ${m.moveSan.padEnd(8)} ${m.thinkMs ?? 0}ms  ${m.reasoning.slice(0, 90)}${judge}`);
    }
    printed = rows.length;
    const [now] = await db.select().from(games).where(eq(games.id, game.id));
    if (!now) {
      console.log(`Match aborted: ${summary.abortedReason ?? "unknown reason"}`);
      break;
    }
    if (now.statusNote) console.log(`  … ${now.statusNote}`);
    if (now.status !== "active") {
      console.log(`\nResult: ${now.result ?? "no result"} — ${now.resultReason}\nPGN: ${now.pgn}`);
      break;
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
