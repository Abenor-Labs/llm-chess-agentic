import { z } from "zod";

/**
 * Skill modes. A mode is the whole "how hard does this player try, and how
 * much help does it get" package for one side:
 *
 * - effort: how long the model may think (provider reasoning effort / thinking
 *   budget, output-token budget and timeout all scale with it)
 * - temperature: sampling randomness
 * - brief: how much of the position is spelled out in the prompt (threats,
 *   loose pieces) — LLMs read boards badly, so a briefing turns "sees the
 *   right idea, hangs a piece" into "sees the right idea"
 * - hints: an advisory engine shortlist. Advisory only: the model may play any
 *   legal move; the judge never rejects a move for being off the list
 * - blunderGuardCp: the judge asks the model to reconsider (once) a move that
 *   loses at least this much versus the engine's best. Its second answer stands.
 *
 * Games are rated only when both sides use the same mode, so assistance never
 * skews the leaderboard.
 */

export const SkillModeSchema = z.enum([
  "novice",
  "apprentice",
  "scholar",
  "strategist",
  "virtuoso",
  "grandmaster",
]);
export type SkillMode = z.infer<typeof SkillModeSchema>;

export const DEFAULT_MODE: SkillMode = "scholar";

export type Effort = "minimal" | "low" | "medium" | "high";
export type BriefLevel = "none" | "basic" | "threats";

export interface ModeConfig {
  label: string;
  /** One line for the UI. */
  description: string;
  temperature: number;
  effort: Effort;
  brief: BriefLevel;
  /** Size of the advisory engine shortlist (null = none). */
  hints: number | null;
  /** Show engine scores next to the hints. */
  hintScores: boolean;
  /** Judge reconsider threshold in centipawns (null = off). */
  blunderGuardCp: number | null;
  persona: string;
}

export const MODES: Record<SkillMode, ModeConfig> = {
  novice: {
    label: "Novice",
    description: "Raw instinct. Minimal thinking, no briefing, no safety net.",
    temperature: 0.9,
    effort: "minimal",
    brief: "none",
    hints: null,
    hintScores: false,
    blunderGuardCp: null,
    persona: "You are a casual beginner. Play quickly on instinct.",
  },
  apprentice: {
    label: "Apprentice",
    description: "Light thinking. The judge only stops outright piece hangs.",
    temperature: 0.7,
    effort: "low",
    brief: "basic",
    hints: null,
    hintScores: false,
    blunderGuardCp: 500,
    persona: "You are an improving club player. Follow opening principles and don't give pieces away for nothing.",
  },
  scholar: {
    label: "Scholar",
    description: "Threat briefing every move; the judge flags blunders of 3+ pawns.",
    temperature: 0.5,
    effort: "low",
    brief: "threats",
    hints: null,
    hintScores: false,
    blunderGuardCp: 300,
    persona: "You are a solid tournament player. Before moving, check what your opponent attacks and keep your pieces defended.",
  },
  strategist: {
    label: "Strategist",
    description: "Medium reasoning effort, threat briefing and an 8-move engine shortlist.",
    temperature: 0.4,
    effort: "medium",
    brief: "threats",
    hints: 8,
    hintScores: false,
    blunderGuardCp: 200,
    persona: "You are a strong positional player. Weigh pawn structure, piece activity and king safety before committing.",
  },
  virtuoso: {
    label: "Virtuoso",
    description: "High reasoning effort with a scored engine shortlist; tight blunder guard.",
    temperature: 0.3,
    effort: "high",
    brief: "threats",
    hints: 6,
    hintScores: true,
    blunderGuardCp: 150,
    persona: "You are a master-level tactician. Calculate forcing lines — checks, captures, threats — before every move.",
  },
  grandmaster: {
    label: "Grandmaster",
    description: "Maximum effort, scored top-5 shortlist, judge catches anything over a pawn.",
    temperature: 0.2,
    effort: "high",
    brief: "threats",
    hints: 5,
    hintScores: true,
    blunderGuardCp: 100,
    persona: "You are a grandmaster. Find the objectively best move by calculating concrete variations.",
  },
};

export const SKILL_MODES = SkillModeSchema.options.map((id) => ({ id, ...MODES[id] }));

export function modeConfig(mode: string | null | undefined): ModeConfig {
  const parsed = SkillModeSchema.safeParse(mode);
  return MODES[parsed.success ? parsed.data : DEFAULT_MODE];
}

/** A game feeds the rating pool only when both sides played under identical conditions. */
export function isRatedPairing(whiteMode: string | null | undefined, blackMode: string | null | undefined): boolean {
  const w = SkillModeSchema.safeParse(whiteMode);
  const b = SkillModeSchema.safeParse(blackMode);
  return w.success && b.success && w.data === b.data;
}
