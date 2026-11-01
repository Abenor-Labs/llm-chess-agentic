import { readFileSync } from "fs";
import path from "path";
import { Position } from "../engine/position";
import { MATE_SCORE } from "../engine/search";
import { loadNet } from "./nnue";
import { Depth5, MATE, type SearchInfo } from "./search";

export { Depth5 } from "./search";
export { loadNet } from "./nnue";

/** Shipped with the tick, start and move routes via outputFileTracingIncludes in next.config.ts. */
export const WEIGHTS_PATH = path.join(process.cwd(), "src/lib/neural/depth5.nnue");

let engine: Depth5 | undefined;

/** Loaded on first use and kept for the life of the server instance (the TT carries over between moves). */
function depth5(): Depth5 {
  return (engine ??= new Depth5(loadNet(readFileSync(WEIGHTS_PATH))));
}

/**
 * The "depth 5" NNUE engine's move for `fen`; `historyFens` are the game's
 * earlier positions. info.score is on the arena engine's scale (mate = MATE_SCORE - plies).
 */
export function neuralMove(fen: string, historyFens: string[], maxMs: number): { san: string; uci: string; info: SearchInfo } {
  const { move, info } = depth5().search(fen, historyFens, maxMs);
  const s = info.score;
  const score = Math.abs(s) >= MATE - 1000 ? Math.sign(s) * (MATE_SCORE - (MATE - Math.abs(s))) : s;
  return { san: new Position(fen).san(move), uci: Position.uci(move), info: { ...info, score } };
}
