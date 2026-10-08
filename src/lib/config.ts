import type { Effort } from "./modes";

/**
 * Per-attempt AI request timeouts. A provider's base timeout is scaled by the
 * mode's reasoning effort (thinking takes time) and capped, so one attempt can
 * never outlive the ply deadline below.
 */
export const AI_TIMEOUTS = {
  BASE_MS: {
    groq: 12_000,
    google: 40_000,
    anthropic: 40_000,
    openai: 45_000,
    gateway: 30_000,
  },
  EFFORT_MULTIPLIER: { minimal: 1, low: 1, medium: 1.5, high: 2.5 } satisfies Record<Effort, number>,
  MAX_MS: 100_000,
} as const;

/** Output-token budgets per effort. Reasoning tokens count against these. */
export const OUTPUT_TOKENS: Record<Effort, number> = {
  minimal: 1_024,
  low: 2_048,
  medium: 4_096,
  high: 8_192,
};

/**
 * Game rules and the processing timeline. The invariants that keep the
 * serverless loop safe:
 *   TICK_BUDGET_MS + PLY_DEADLINE_MS  <  TICK_MAX_DURATION_S * 1000
 *   PLY_DEADLINE_MS                    <  CLAIM_STALE_MS
 * so a tick always finishes its in-flight ply before the platform kills it, and
 * a live processor's claim is never mistaken for an abandoned one.
 */
export const GAME_RULES = {
  /** Model attempts per ply (illegal / unparseable answers get feedback and a retry). */
  MAX_JUDGE_ATTEMPTS: 3,
  /** Consecutive failed plies a side may have; one more forfeits. */
  MAX_TIMEOUT_WARNINGS: 2,
  /** Wall-clock cap for a game; reaching it triggers engine adjudication. */
  GAME_TIME_LIMIT_MS: 30 * 60 * 1000,
  /** A tick starts new plies until this much time has passed. */
  TICK_BUDGET_MS: 25_000,
  /** Hard cap on one ply including every judge attempt. */
  PLY_DEADLINE_MS: 150_000,
  /** A claim older than this is considered abandoned (processor crashed). */
  CLAIM_STALE_MS: 240_000,
  /** Must match `maxDuration` exported by the tick route. */
  TICK_MAX_DURATION_S: 300,
} as const;

/** Engine settings for the judge (blunder guard, hints) and adjudication. */
export const ENGINE = {
  JUDGE_DEPTH: 3,
  JUDGE_MAX_MS: 1_500,
} as const;

export const ELO_CONFIG = {
  K_FACTOR: 32,
  DEFAULT_RATING: 1500,
} as const;

/**
 * UI polling intervals, tuned for serverless request quotas.
 *
 * GAME_REFRESH_MS: active game poll (visible tab)
 * GAMES_LIST_REFRESH_MS: history list poll (visible tab)
 * COMPLETED_GAME_REFRESH_MS: finished game poll
 * AUTO_TICK_MS: auto-tick cadence; ticks landing mid-processing return instantly
 * WHEN_TAB_HIDDEN_MS: any poll while the tab is hidden
 */
export const POLLING_INTERVALS = {
  GAME_REFRESH_MS: 1_500,
  GAMES_LIST_REFRESH_MS: 15_000,
  COMPLETED_GAME_REFRESH_MS: 60_000,
  AUTO_TICK_MS: 5_000,
  WHEN_TAB_HIDDEN_MS: 30_000,
} as const;

/**
 * How long each move is shown before the board advances to the next one. The
 * server plays moves in bursts; the client reveals them one at a time.
 */
export const MOVE_PLAYBACK_MS = 900;
