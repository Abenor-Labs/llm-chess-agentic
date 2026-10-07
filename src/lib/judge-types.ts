/**
 * What the judge did during one ply, stored on the move row (moves.judge) and
 * rendered in the UI. Client-safe: no server imports.
 */
export type JudgeEvent =
  /** The answer couldn't be read as a move. */
  | { type: "parse"; attempt: number }
  /** The model proposed a move that isn't legal here. */
  | { type: "illegal"; attempt: number; move: string }
  /** A legal move written in non-standard notation, accepted as-is. */
  | { type: "notation"; attempt: number; from: string; to: string }
  /** The judge asked the model to reconsider a move the engine rates as a blunder. */
  | { type: "blunder"; attempt: number; move: string; lossCp: number; reply?: string; mate?: "missed" | "allowed" }
  /** The judge warned that a winning side was about to allow a draw by repetition. */
  | { type: "repetition"; attempt: number; move: string; advantageCp: number }
  /** The request failed (timeout, provider error). */
  | { type: "error"; attempt: number; detail: string }
  /** Later attempts failed, so the model's earlier legal move was played. */
  | { type: "fallback"; move: string };

export interface JudgeRecord {
  attempts: number;
  events: JudgeEvent[];
  /** The model's final move differs from its first legal proposal. */
  reconsidered?: boolean;
  /** Engine-backed player (no judge needed). */
  engine?: { depth: number; nodes: number; score: string };
}

export function describeJudgeEvent(e: JudgeEvent): string {
  switch (e.type) {
    case "parse":
      return `Attempt ${e.attempt}: answer could not be read`;
    case "illegal":
      return `Attempt ${e.attempt}: proposed illegal move "${e.move}"`;
    case "notation":
      return `Read "${e.from}" as ${e.to}`;
    case "blunder": {
      const cost =
        e.mate === "missed" ? "misses a forced mate" : e.mate === "allowed" ? "allows a forced mate" : `≈${(e.lossCp / 100).toFixed(1)} pawns`;
      return `Attempt ${e.attempt}: ${e.move} flagged as a blunder (${cost}${e.reply ? `; ${e.reply} punishes it` : ""}) — asked to reconsider`;
    }
    case "repetition":
      return `Attempt ${e.attempt}: ${e.move} would allow a draw by repetition while ahead (${
        e.advantageCp >= 10_000 ? "a forced mate is available" : `+${(e.advantageCp / 100).toFixed(1)}`
      })`;
    case "error":
      return `Attempt ${e.attempt}: ${e.detail}`;
    case "fallback":
      return `Kept the model's earlier legal move ${e.move}`;
  }
}
