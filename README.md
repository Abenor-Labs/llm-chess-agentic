# LLM Chess Arena

Watch language models play chess against each other — and see *why* they play what they play.

Every move shows the model's reasoning and its plan, how long it thought, and what the judge did (illegal answers caught, notation repaired, blunders questioned). Finished games get a Stockfish review in the browser, which feeds accuracy, ACPL and blunder rate into the leaderboard next to ELO.

## Highlights

- **Bring your own key** for Groq, Google Gemini, Anthropic and OpenAI (other ids route through the Vercel AI Gateway). Keys stay in your browser and are sent only with the matches that need them.
- **Built-in engines** (Random Mover, Greedy Grabber, Arena Engine depth 2/4) — no key needed, and they anchor the rating pool.
- **Skill modes** per side, novice → grandmaster. A mode sets the model's *reasoning effort* (Groq `reasoning_effort`, Gemini thinking level/budget, Claude `effort` with adaptive thinking, OpenAI `reasoningEffort`), temperature, how much of the position is briefed in the prompt, an advisory engine shortlist, and the blunder-guard threshold.
- **A judge that respects the model's decision.** Any notation that maps to exactly one legal move is accepted (`e2e4`, `0-0`, `Nxe5+!`). Illegal or unreadable answers get specific feedback and another try. A clear blunder gets *one* "are you sure?" with the concrete refutation — the model's second answer stands. If a retry fails, the model's earlier legal move is played instead of costing it a timeout.
- **Fair ratings.** Only games where both sides use the same mode are rated. Cancelled or stopped matches never touch ratings.
- **Smooth live view.** Moves arriving in bursts are revealed one by one (faster when the board is behind). Browse any ply with ← / →, Home / End, or the move list; F flips the board.

## Quick start

```bash
pnpm install
docker compose up -d                       # Postgres on localhost:5434
echo 'DATABASE_URL=postgresql://chess:chess@localhost:5434/chess' > .env.local
pnpm db:setup                              # migrate + seed the model roster
pnpm dev                                   # http://localhost:3000
```

Open the app and click **watch two built-in engines** to see a game without any key, or add a key under **Settings** and pick LLMs.

From a shell: `pnpm simulate` plays a whole match through the real processor and prints each move (`pnpm simulate local/engine-4 groq/openai/gpt-oss-120b --black-mode grandmaster`).

## How a move is made

```
browser auto-tick ─► /api/cron/tick ─► processGame (atomic DB claim, plays plies for ≤25s)
                                          │
                                          ▼
                                   playTurn ── local/* ─► built-in engine
                                          │
                                          └─ LLM ─► judge ─► requestMove ─► provider (effort-scaled)
                                                     ▲             │
                                                     └─ feedback ◄─┘  (illegal / unreadable / blunder)
                                          ▼
                     transaction: guarded position update + move row (reasoning, plan, judge, think time)
```

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js |
| `pnpm db:migrate` | Apply `drizzle/*.sql` (idempotent, tracked in `_arena_migrations`) |
| `pnpm db:seed` | Upsert the model roster (never deletes games or ratings) |
| `pnpm db:setup` | Both of the above |
| `pnpm test` | Unit tests + database integration tests (the latter need `TEST_DATABASE_URL`) |
| `pnpm test:unit` / `pnpm test:db` | One project only |
| `pnpm test:e2e` | Playwright against a real server and database |
| `pnpm lint` / `pnpm typecheck` | Static checks |
| `pnpm simulate` | Play a full match from the command line |
| `pnpm healthcheck` | Ask every keyed model for one move and report latency / legality |
| `tsx scripts/list-available-models.ts` | List the model ids each provider currently serves |

## Configuration

Environment variables are documented in [.env.example](.env.example). Tunables live in [`src/lib/config.ts`](src/lib/config.ts) (timeouts per provider × effort, judge attempts, tick budget, ply deadline, claim staleness, polling) and [`src/lib/modes.ts`](src/lib/modes.ts) (skill modes).

## License

MIT
