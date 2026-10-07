# Architecture

## Overview

A Next.js 16 app (App Router) with PostgreSQL via Drizzle. There is no server-side scheduler: while someone is watching, the browser calls `/api/cron/tick` every few seconds, and each tick plays moves until its time budget is spent.

```
src/
  app/                 pages (/, /game/[id], /games, /leaderboard) and API routes
  components/          GameView (live/replay screen), MatchSetup, SidePanel, MoveList, Board, EvalBar, …
  hooks/               useGameData, useAutoTick, useGamePlayback, useStockfish, useGameAnalysis
  lib/
    engine/            0x88 move generator + alpha-beta/quiescence search (perft-verified)
    ai/                providers (effort mapping), prompt, response parsing, requestMove
    judge.ts           turns a model's answers into a legal move it actually chose
    players.ts         LLM players (via the judge) and built-in engine bots
    game-processor.ts  claim → play plies → record → end game / rate
    chess.ts           chess.js wrappers: history-aware status, move resolver, repetition helpers
    modes.ts           skill modes
    view-model.ts      pure helpers for the game screen
  db/                  schema, lazy connection, roster seed
drizzle/               idempotent SQL migrations (applied by scripts/migrate.ts)
tests/                 database integration tests (real Postgres)
e2e/                   Playwright, full stack
```

## The game loop

`processGame` (in `game-processor.ts`):

1. **Claim** the game with a conditional `UPDATE … RETURNING` on `games.processing` / `processing_started_at`. Only one caller can claim an active game whose claim is clear or older than `CLAIM_STALE_MS`, so concurrent ticks (several tabs, serverless instances) never double-move. The claim is refreshed between plies and released only by its owner.
2. **Play plies** back-to-back until `TICK_BUDGET_MS` is spent or a ply stops the loop. Each ply has a hard deadline (`PLY_DEADLINE_MS`, enforced with an `AbortSignal` that cancels the HTTP request).
3. **Record** each move in one transaction: the position update is guarded on the FEN the move was computed for (and on the game still being active), and the move row is inserted only if that update succeeded. A stopped game or a lost race leaves no phantom move.
4. **End** the game in a transaction that flips `status` conditionally (so it can only happen once) and, for rated games, updates both models' ELO with row locks.

The timeline invariants (`TICK_BUDGET_MS + PLY_DEADLINE_MS < maxDuration`, `PLY_DEADLINE_MS < CLAIM_STALE_MS`) are asserted in tests.

### History

Move history is rebuilt from the `moves` table (ordered by `move_number, color`) and replayed in chess.js, so threefold repetition and the fifty-move rule are detected. The stored PGN is the full movetext. If history doesn't reproduce the stored FEN (legacy rows), play continues from the FEN.

### Failure handling

| Failure | Outcome |
| --- | --- |
| Missing / rejected key, model not found | No moves yet → the match is deleted (start route reports why). Otherwise → ended with no result ("Match cancelled"), unrated. |
| Rate limit (429) | First move → deleted with the reason. Mid-game → a status note ("rate limited — retrying") and the next tick tries again; no penalty. |
| Timeout, unreadable answer, no legal move after all judge attempts | A warning for that side (shown in the UI). More than `MAX_TIMEOUT_WARNINGS` consecutive failures forfeits. A successful move clears the count. |
| Game exceeds `GAME_TIME_LIMIT_MS` | Engine adjudication: a decisive edge (≥ a rook, or forced mate) wins; otherwise a draw. |

## The judge (`judge.ts`)

The judge's job is to get the *model's* decision onto the board:

- **Notation is forgiven.** `resolveMove` maps UCI, long algebraic, `0-0`, lowercase pieces, missing/extra `x`, check/annotation suffixes and a missing `=Q` onto the unique legal move — and never guesses between two.
- **Illegal / unreadable answers** get specific feedback (the legal list, "you are in check") and another attempt.
- **Blunder guard** (per mode): if the engine rates the move at least `blunderGuardCp` worse than the best, the model is asked once to reconsider, with the opponent's refuting reply. Its second answer stands, even if it's the same move.
- **Repetition guard:** a clearly winning side gets one warning before completing a threefold repetition.
- **Fallback:** if later attempts fail, the earlier legal proposal is played.

Everything the judge did is stored as structured events in `moves.judge` and shown in the side panel.

## Players and modes

`players.ts` routes `local/*` ids to the built-in engine and everything else to the judge + `requestMove`. Built-in bots avoid revisiting earlier positions when ahead (search can't see game history).

A skill mode (`modes.ts`) sets:

- **effort** → provider reasoning controls (`ai/providers.ts`), output-token budget and timeout
- **temperature**
- **brief**: none / basic (material, check) / threats (loose pieces for both sides)
- **hints**: an advisory engine shortlist (strategist and above), optionally with scores
- **blunderGuardCp**

The prompt (`ai/prompt.ts`) also includes the full PGN, a labelled board, the legal move list, the side's own plan from its previous move, and judge feedback. Models answer `{"reasoning", "plan", "move"}`; the parser strips `<think>` traces and takes the last valid JSON object.

## Engine (`lib/engine`)

A compact 0x88 board with legal move generation, make/unmake and SAN (verified by perft against the standard suite and by matching chess.js's legal-move set across hundreds of random positions), plus a negamax alpha-beta search with quiescence, MVV-LVA ordering, piece-square-table evaluation, mate scoring and iterative deepening under a time cap. `analyze()` scores every root move exactly. It powers the blunder guard, hints, the threat brief, adjudication and the built-in bots — about 1000× faster than searching with chess.js.

## Front end

`GameView` is the one game screen (home page when a game is live, and `/game/[id]`). `useGameData` polls (fast while live, slow when hidden or finished, not at all once analyzed); `useAutoTick` drives ticks without overlapping requests; `useGamePlayback` reveals moves one by one. `useGameAnalysis` runs Stockfish over a finished game in a Web Worker and posts evaluations to `/api/games/[id]/analysis`, which computes centipawn loss and accuracy server-side.

## API

| Route | Purpose |
| --- | --- |
| `POST /api/games/start` | `{ modelIds: [white, black], whiteMode?, blackMode?, keys? }`. Validates keys, creates the game (one active game at a time; advisory lock + unique index), plays the first move synchronously. 409 if a game is running. |
| `GET\|POST /api/cron/tick` | Advance all active games. Ungated by design (browser-driven; claims make it safe). |
| `GET /api/games?status=&limit=` | Games with both models and move counts. |
| `GET /api/games/[id]` | Game (no keys), moves in ply order, both models. |
| `POST /api/games/destroy` | Stop the active game: deleted if it has no moves, otherwise ended unrated. |
| `POST /api/games/[id]/analysis` | Store Stockfish evals (once per game). |
| `GET /api/leaderboard`, `GET /api/analytics/accuracy` | Ratings and accuracy aggregates. |
| `GET /api/providers` | Which providers have a server fallback key (booleans only). |
| `POST /api/tournament/reset` | Wipe games and ratings. Needs `ADMIN_TOKEN` (or development). |

## Data

- `models`: roster and ratings (`local/*` are built-in engines).
- `games`: FEN, PGN, status, result/reason, per-side modes and warnings, `status_note`, the processing claim, `analyzed`, and per-match encrypted keys (never returned to clients).
- `moves`: SAN, FEN after, color, reasoning, `plan`, `judge` (jsonb), `think_ms`, and post-analysis `eval_cp` / `cp_loss` / `move_accuracy`.
- `tournament`: singleton tick counter / run state.

Migrations in `drizzle/` are idempotent and tracked in `_arena_migrations`; `pnpm db:migrate` works on fresh databases, on databases created with `drizzle-kit push`, and on ones migrated by hand.
