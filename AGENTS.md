# AGENTS.md

Guidance for agents working in this repository. Architecture details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Commands

- `pnpm lint`, `pnpm typecheck` — must be clean (CI blocks on both)
- `pnpm test` — unit tests (`src/**/*.test.ts`) plus database integration tests (`tests/**`). The DB project is skipped unless `TEST_DATABASE_URL` is set (put it in `.env.test`; the database is truncated between tests)
- `pnpm test:e2e` — Playwright against a real server + DB. Locally it reuses `pnpm dev`; set `PLAYWRIGHT_BASE_URL` to target a running server and `PLAYWRIGHT_CHROMIUM_PATH` for a preinstalled Chromium
- `pnpm db:migrate` / `pnpm db:seed` / `pnpm db:setup` — idempotent; `db:seed --reset` wipes games and ratings
- `pnpm simulate [white] [black] [--white-mode m] [--black-mode m]` — play a full match through the real processor

A throwaway Postgres for tests: `docker compose up -d` (port 5434), or any local Postgres 16.

## Rules of the road

- **Move ordering** is `move_number, color, created_at` everywhere (color enum order is white < black). Never order plies by `move_number` alone.
- **History matters**: load games with `loadGame(fen, sanHistory)` / `applyMove(..., history)`; a FEN alone cannot detect threefold repetition. Store PGN via `toPgn(history)`.
- **Moves from models go through `resolveMove`** — store the canonical SAN it returns, never the model's raw string.
- **Never write to the game without the guards**: position updates are conditional on the FEN the move was computed for and `status = 'active'`; `endGame` is the only way to finish a game (transactional, idempotent, rates only `isRatedPairing` games with a result).
- **Search with `lib/engine`, not chess.js** (chess.js generates SAN + check info per move and is ~1000× too slow). The engine is perft-tested; keep `src/lib/engine/engine.test.ts` green when touching it.
- **Client code must not import `@/lib/ai`** (it pulls provider SDKs). Use `@/lib/provider-ids` for provider metadata.
- **Route segment config must be literal** (`export const maxDuration = 300`). `tests/api.test.ts` asserts it matches `GAME_RULES.TICK_MAX_DURATION_S`.
- New DB columns: add to `src/db/schema.ts` **and** a new idempotent `drizzle/00NN_*.sql` (`IF NOT EXISTS`, guarded `DO` blocks).
- Errors: fatal (`APIKeyError`, `RateLimitError`, `ModelUnavailableError`) vs transient (`TimeoutError`, `ParseError`, `ProviderError`) — see `src/lib/errors.ts` and the failure table in the architecture doc.

## Security posture

- Keys are bring-your-own: stored per match (encrypted when `ENCRYPTION_KEY` is set), never returned by any API (`publicGameColumns`). Env keys are a self-hosting fallback; `/api/providers` exposes only booleans.
- `/api/cron/tick`, `/api/games/start`, `/api/games/destroy` are intentionally ungated (browser-driven arena). `/api/tournament/reset` requires `ADMIN_TOKEN` (or development mode).

## Testing expectations

Anything live must be tested. Unit-test pure logic next to the code; exercise DB-touching behavior in `tests/` against real Postgres, mocking only the AI SDK's `generateText` (see `tests/game-processor.test.ts` for the scripted-model helper). UI flows that matter get an e2e spec using the built-in engines (no keys needed).
