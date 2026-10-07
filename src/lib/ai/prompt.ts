import { Chess } from "chess.js";
import { modeConfig, type SkillMode } from "../modes";
import { toPgn } from "../chess";
import { formatScore, loosePieces, materialCount, type PieceThreat, type ScoredMove } from "../engine";

export interface PromptContext {
  fen: string;
  color: "white" | "black";
  /** Every legal move in SAN. */
  legalMoves: string[];
  /** The game so far, SAN in play order. */
  history: string[];
  mode?: SkillMode | string | null;
  /** This side's plan from its previous move, fed back so the player keeps a thread. */
  previousPlan?: string | null;
  /** Engine-ranked moves, best first; shown only if the mode allows hints. */
  candidates?: ScoredMove[];
  /** Judge feedback from a rejected attempt this turn. */
  feedback?: string | null;
}

/** Board diagram with rank and file labels, White at the bottom. */
export function renderBoard(fen: string): string {
  const rows = new Chess(fen).board();
  const lines = rows.map((row, i) => {
    const cells = row.map((sq) => (sq ? (sq.color === "w" ? sq.type.toUpperCase() : sq.type) : "."));
    return `${8 - i} | ${cells.join(" ")}`;
  });
  return [...lines, "    a b c d e f g h"].join("\n");
}

function describeThreat(t: PieceThreat): string {
  const by = t.attackers.join(", ");
  return `${t.piece} on ${t.square} (attacked by ${by}${t.defended ? "; defended, but the attacker is cheaper" : "; undefended"})`;
}

function materialLine(fen: string): string {
  const { white, black } = materialCount(fen);
  const diff = white - black;
  return `Material: White ${white}, Black ${black}${diff === 0 ? " (equal)" : ` (${diff > 0 ? "White" : "Black"} +${Math.abs(diff)})`}`;
}

/**
 * Builds the move prompt. Everything the model needs to avoid unforced errors
 * is stated plainly; the decision stays with the model.
 */
export function buildPrompt(ctx: PromptContext): string {
  const cfg = modeConfig(ctx.mode);
  const chess = new Chess(ctx.fen);
  const opponent = ctx.color === "white" ? "black" : "white";
  const moveNo = Number(ctx.fen.split(" ")[5]) || 1;
  const sections: string[] = [];

  sections.push(`${cfg.persona} You are playing ${ctx.color.toUpperCase()} in a chess game against another AI.`);

  sections.push(
    [
      `Position (${ctx.color} to move, move ${moveNo}). Uppercase = White, lowercase = Black.`,
      renderBoard(ctx.fen),
      `FEN: ${ctx.fen}`,
    ].join("\n"),
  );

  sections.push(
    ctx.history.length
      ? `Game so far: ${toPgn(ctx.history)}\nYour opponent's last move: ${ctx.history[ctx.history.length - 1]}`
      : "This is the first move of the game.",
  );

  if (cfg.brief !== "none") {
    const brief: string[] = [materialLine(ctx.fen)];
    if (chess.inCheck()) brief.push(`You are IN CHECK — only moves that get out of check are legal.`);
    if (cfg.brief === "threats") {
      const mine = loosePieces(ctx.fen, ctx.color);
      const theirs = loosePieces(ctx.fen, opponent);
      brief.push(
        mine.length
          ? `Your pieces at risk: ${mine.slice(0, 4).map(describeThreat).join("; ")}.`
          : "None of your pieces are currently hanging.",
      );
      if (theirs.length) {
        brief.push(`Opponent pieces you are attacking that look loose: ${theirs.slice(0, 4).map(describeThreat).join("; ")}.`);
      }
    }
    sections.push(`Briefing:\n- ${brief.join("\n- ")}`);
  }

  if (ctx.previousPlan) sections.push(`Your plan from your previous move: "${ctx.previousPlan}"`);

  sections.push(`Legal moves (${ctx.legalMoves.length}): ${ctx.legalMoves.join(", ")}`);

  if (cfg.hints && ctx.candidates?.length) {
    const top = ctx.candidates.slice(0, cfg.hints);
    const list = top.map((c) => (cfg.hintScores ? `${c.move} (${formatScore(c.score)})` : c.move)).join(", ");
    sections.push(
      `Engine shortlist (a quick search, best first${cfg.hintScores ? "; scores in pawns for you" : ""}): ${list}\nIt is advice, not a rule — any legal move is allowed if you calculate it is better.`,
    );
  }

  if (ctx.feedback) sections.push(`JUDGE FEEDBACK ON YOUR LAST ANSWER: ${ctx.feedback}`);

  sections.push(
    [
      "Think it through: what does the opponent threaten, which captures and checks exist, is the square you move to safe?",
      "Then reply with ONLY one JSON object, reasoning first:",
      `{"reasoning": "2-3 sentences on threats and why this move", "plan": "your plan for the next few moves", "move": "Nf3"}`,
      `"move" must be exactly one move from the legal list, in SAN.`,
    ].join("\n"),
  );

  return sections.join("\n\n");
}
