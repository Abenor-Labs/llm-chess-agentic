import { Chess, type Move as ChessJsMove } from "chess.js";

/** The standard starting position in Forsyth-Edwards Notation. */
export const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export type GameResult = "1-0" | "0-1" | "1/2-1/2";

/**
 * Rebuilds a game from its move history (SAN, in play order). Move history is
 * what makes threefold repetition and the fifty-move rule detectable — a FEN
 * alone cannot carry it. Throws if a move is illegal.
 */
export function replay(sanMoves: readonly string[]): Chess {
  const chess = new Chess();
  for (const san of sanMoves) chess.move(san);
  return chess;
}

/**
 * Loads the current game, preferring full history. If the history doesn't
 * reproduce `fen` (legacy rows, corrupted data), falls back to the FEN alone so
 * play can always continue.
 */
export function loadGame(fen: string, sanMoves: readonly string[] = []): Chess {
  if (sanMoves.length > 0) {
    try {
      const chess = replay(sanMoves);
      if (chess.fen() === fen) return chess;
    } catch {
      // fall through to FEN
    }
  } else if (fen === STARTING_FEN) {
    return new Chess();
  }
  return new Chess(fen);
}

/** Gets all legal moves for the current position, in SAN. */
export function getLegalMoves(fen: string): string[] {
  return new Chess(fen).moves();
}

/** The fullmove number from the FEN (1 for the first move pair). */
export function getMoveNumber(fen: string): number {
  return parseInt(fen.split(" ")[5], 10) || 1;
}

export interface GameStatus {
  over: boolean;
  result: GameResult | null;
  reason: string | null;
}

/** Terminal state of a game held in a chess.js instance (with history). */
export function gameStatus(chess: Chess): GameStatus {
  if (chess.isCheckmate()) {
    return { over: true, result: chess.turn() === "w" ? "0-1" : "1-0", reason: "Checkmate" };
  }
  if (chess.isStalemate()) return { over: true, result: "1/2-1/2", reason: "Stalemate" };
  if (chess.isInsufficientMaterial()) return { over: true, result: "1/2-1/2", reason: "Draw by insufficient material" };
  if (chess.isThreefoldRepetition()) return { over: true, result: "1/2-1/2", reason: "Draw by threefold repetition" };
  if (chess.isDrawByFiftyMoves()) return { over: true, result: "1/2-1/2", reason: "Draw by fifty-move rule" };
  return { over: false, result: null, reason: null };
}

/**
 * Applies a move to a game and returns the resulting position and full PGN.
 * Pass the game's history so the PGN (and repetition detection) stays complete.
 */
export function applyMove(
  fen: string,
  move: string,
  sanMoves: readonly string[] = [],
): { fen: string; pgn: string; san: string; status: GameStatus } | null {
  const chess = loadGame(fen, sanMoves);
  const resolved = resolveMove(chess.fen(), move);
  if (!resolved) return null;
  chess.move(resolved.san);
  return { fen: chess.fen(), pgn: toPgn(chess.history()), san: resolved.san, status: gameStatus(chess) };
}

/** Header-free PGN movetext, e.g. "1. e4 e5 2. Nf3". */
export function toPgn(sanMoves: readonly string[]): string {
  const parts: string[] = [];
  sanMoves.forEach((san, i) => {
    if (i % 2 === 0) parts.push(`${i / 2 + 1}. ${san}`);
    else parts[parts.length - 1] += ` ${san}`;
  });
  return parts.join(" ");
}

export interface ResolvedMove {
  san: string;
  uci: string;
  from: string;
  to: string;
  promotion?: string;
}

function toResolved(m: ChessJsMove): ResolvedMove {
  return {
    san: m.san,
    uci: m.from + m.to + (m.promotion ?? ""),
    from: m.from,
    to: m.to,
    ...(m.promotion ? { promotion: m.promotion } : {}),
  };
}

const SAN_SHAPE = /^([KQRBNP])?([a-h])?([1-8])?x?([a-h][1-8])(?:=?([QRBN]))?$/;
const UCI_SHAPE = /^([a-h][1-8])[-x:]?([a-h][1-8])=?([qrbn])?$/i;

/**
 * Resolves whatever notation a model produced into a legal move, or null.
 *
 * Models routinely say the right move in the wrong dialect: "e2e4", "0-0",
 * "Nxe5+!", "Ng1f3", "nf3", "Pe4", "Nd5" for a capture, "e8" for a queening
 * push. Rejecting those wastes a judge retry on a correct decision, so this
 * accepts any spelling that maps to exactly one legal move — and never guesses
 * between two.
 */
export function resolveMove(fen: string, raw: string): ResolvedMove | null {
  if (typeof raw !== "string") return null;
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }
  const legal = chess.moves({ verbose: true });
  if (legal.length === 0) return null;

  const text = raw
    .trim()
    .replace(/^["'`*]+|["'`*.,;:]+$/g, "")
    .replace(/^\d+\s*\.(\.\.)?\s*/, "") // "12." or "12..." move numbers
    .replace(/\s*e\.p\.?$/i, "")
    .replace(/[!?]+$/, "")
    .replace(/[+#]+$/, "")
    .replace(/[!?]+$/, "")
    .trim();
  if (!text) return null;

  const exact = legal.find((m) => m.san.replace(/[+#]$/, "") === text);
  if (exact) return toResolved(exact);

  // Castling in any spelling.
  const castle = text.replace(/0/g, "O").toUpperCase();
  if (castle === "O-O" || castle === "OO" || castle === "O-O-O" || castle === "OOO") {
    const want = castle.replace(/-/g, "") === "OOO" ? "O-O-O" : "O-O";
    const m = legal.find((l) => l.san.replace(/[+#]$/, "") === want);
    return m ? toResolved(m) : null;
  }

  // UCI / long algebraic: e2e4, e7e8q, e2-e4, Ng1-f3, Ng1xf3.
  const longForm = text.replace(/^[KQRBNP](?=[a-h][1-8][-x:]?[a-h][1-8])/i, "");
  const uci = longForm.match(UCI_SHAPE);
  if (uci) {
    const [, from, to, promo] = uci;
    const matches = legal.filter(
      (m) => m.from === from.toLowerCase() && m.to === to.toLowerCase() && (!promo || m.promotion === promo.toLowerCase()),
    );
    const pick = pickUnique(matches);
    if (pick) return toResolved(pick);
  }

  // Loose SAN: tolerate missing/extra "x", over-disambiguation, a "P" prefix,
  // a lowercase piece letter, and a missing "=Q".
  // A leading lowercase "b" is tried as a b-pawn first, then as a bishop.
  const variants = [text];
  if (/^[kqrbnp]/.test(text)) variants.push(text[0].toUpperCase() + text.slice(1));
  for (const v of variants) {
    const shape = v.match(SAN_SHAPE);
    if (!shape) continue;
    const [, pieceLetter, fromFile, fromRank, to, promo] = shape;
    const piece = (pieceLetter ?? "P").toLowerCase();
    const matches = legal.filter(
      (m) =>
        m.piece === piece &&
        m.to === to &&
        (!fromFile || m.from[0] === fromFile) &&
        (!fromRank || m.from[1] === fromRank) &&
        (!promo || m.promotion === promo.toLowerCase()),
    );
    const pick = pickUnique(matches);
    if (pick) return toResolved(pick);
  }
  return null;
}

/** One move, or — for an unspecified promotion — the queen promotion. Never a guess between distinct moves. */
function pickUnique(matches: ChessJsMove[]): ChessJsMove | null {
  if (matches.length === 1) return matches[0];
  if (matches.length > 1 && matches.every((m) => m.promotion && m.from === matches[0].from && m.to === matches[0].to)) {
    return matches.find((m) => m.promotion === "q") ?? null;
  }
  return null;
}

/**
 * True if playing `san` would produce a position that has now occurred three
 * times — i.e. the move hands the opponent (or the mover) a draw by repetition.
 */
export function moveCausesRepetition(chess: Chess, san: string): boolean {
  try {
    chess.move(san);
    const repeated = chess.isThreefoldRepetition();
    chess.undo();
    return repeated;
  } catch {
    return false;
  }
}

/** Position identity for repetition: placement, side, castling, en passant. */
export function positionKey(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

/**
 * Returns a predicate: does `san` lead back to a position seen earlier in this
 * game? Revisiting positions is how a winning side drifts into a repetition
 * draw, even when the opponent is the one who completes the threefold.
 */
export function revisitsPosition(chess: Chess): (san: string) => boolean {
  const seen = new Set<string>();
  const walk = new Chess();
  seen.add(positionKey(walk.fen()));
  for (const san of chess.history()) {
    walk.move(san);
    seen.add(positionKey(walk.fen()));
  }
  return (san) => {
    try {
      chess.move(san);
      const repeated = seen.has(positionKey(chess.fen()));
      chess.undo();
      return repeated;
    } catch {
      return false;
    }
  };
}
