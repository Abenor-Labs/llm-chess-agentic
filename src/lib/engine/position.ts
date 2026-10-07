/**
 * Fast 0x88 board with legal move generation, make/unmake and SAN output.
 *
 * chess.js is the source of truth for game state, but it computes SAN (with a
 * check test) for every generated move, which makes it ~1000x too slow to
 * search with. This is a minimal, self-contained position used only by the
 * engine. It is perft-verified and cross-checked against chess.js in tests.
 */

export const WHITE = 0;
export const BLACK = 8;
export type Side = typeof WHITE | typeof BLACK;

export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

export const FLAG_CAPTURE = 1;
export const FLAG_EP = 2;
export const FLAG_CASTLE = 4;
export const FLAG_DOUBLE = 8;
export const FLAG_PROMO = 16;

export interface Move {
  from: number;
  to: number;
  /** Moving piece code (type | color). */
  piece: number;
  /** Captured piece code, 0 if none. */
  captured: number;
  /** Promotion piece type, 0 if none. */
  promotion: number;
  flags: number;
}

interface Undo {
  move: Move;
  castling: number;
  ep: number;
  halfmove: number;
}

const KNIGHT_OFFSETS = [33, 31, 18, 14, -33, -31, -18, -14];
const KING_OFFSETS = [1, -1, 16, -16, 15, 17, -15, -17];
const BISHOP_DIRS = [15, 17, -15, -17];
const ROOK_DIRS = [1, -1, 16, -16];

const CASTLE_WK = 1;
const CASTLE_WQ = 2;
const CASTLE_BK = 4;
const CASTLE_BQ = 8;

const SQ_A1 = 0, SQ_C1 = 2, SQ_D1 = 3, SQ_E1 = 4, SQ_F1 = 5, SQ_G1 = 6, SQ_H1 = 7;
const SQ_A8 = 112, SQ_E8 = 116, SQ_H8 = 119;

// Castling rights kept after a move touches a square.
const CASTLE_MASK = new Int8Array(128).fill(15);
CASTLE_MASK[SQ_A1] = 15 & ~CASTLE_WQ;
CASTLE_MASK[SQ_H1] = 15 & ~CASTLE_WK;
CASTLE_MASK[SQ_E1] = 15 & ~(CASTLE_WK | CASTLE_WQ);
CASTLE_MASK[SQ_A8] = 15 & ~CASTLE_BQ;
CASTLE_MASK[SQ_H8] = 15 & ~CASTLE_BK;
CASTLE_MASK[SQ_E8] = 15 & ~(CASTLE_BK | CASTLE_BQ);

const PIECE_CHARS = " pnbrqk";

export const typeOf = (piece: number) => piece & 7;
export const colorOf = (piece: number): Side => (piece & 8) as Side;
export const fileOf = (sq: number) => sq & 7;
export const rankOf = (sq: number) => sq >> 4;

export function squareName(sq: number): string {
  return "abcdefgh"[fileOf(sq)] + (rankOf(sq) + 1);
}

export function parseSquare(name: string): number {
  if (!/^[a-h][1-8]$/.test(name)) return -1;
  return (name.charCodeAt(1) - 49) * 16 + (name.charCodeAt(0) - 97);
}

export class Position {
  board = new Int8Array(128);
  side: Side = WHITE;
  castling = 0;
  ep = -1;
  halfmove = 0;
  fullmove = 1;
  kings: [number, number] = [-1, -1]; // indexed by side >> 3
  private history: Undo[] = [];

  constructor(fen: string) {
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 4) throw new Error(`Invalid FEN: ${fen}`);
    const rows = parts[0].split("/");
    if (rows.length !== 8) throw new Error(`Invalid FEN board: ${fen}`);
    for (let r = 0; r < 8; r++) {
      let f = 0;
      for (const ch of rows[r]) {
        if (/\d/.test(ch)) {
          f += Number(ch);
          continue;
        }
        const type = PIECE_CHARS.indexOf(ch.toLowerCase());
        if (type <= 0 || f > 7) throw new Error(`Invalid FEN piece: ${fen}`);
        const color = ch === ch.toLowerCase() ? BLACK : WHITE;
        const sq = (7 - r) * 16 + f;
        this.board[sq] = type | color;
        if (type === KING) this.kings[color >> 3] = sq;
        f++;
      }
      if (f !== 8) throw new Error(`Invalid FEN rank: ${fen}`);
    }
    if (this.kings[0] < 0 || this.kings[1] < 0) throw new Error(`FEN missing a king: ${fen}`);
    this.side = parts[1] === "b" ? BLACK : WHITE;
    const c = parts[2];
    if (c.includes("K")) this.castling |= CASTLE_WK;
    if (c.includes("Q")) this.castling |= CASTLE_WQ;
    if (c.includes("k")) this.castling |= CASTLE_BK;
    if (c.includes("q")) this.castling |= CASTLE_BQ;
    this.ep = parts[3] === "-" ? -1 : parseSquare(parts[3]);
    this.halfmove = Number(parts[4] ?? 0) || 0;
    this.fullmove = Number(parts[5] ?? 1) || 1;
  }

  fen(): string {
    const rows: string[] = [];
    for (let r = 7; r >= 0; r--) {
      let row = "";
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.board[r * 16 + f];
        if (!p) {
          empty++;
          continue;
        }
        if (empty) row += empty;
        empty = 0;
        const ch = PIECE_CHARS[typeOf(p)];
        row += colorOf(p) === WHITE ? ch.toUpperCase() : ch;
      }
      if (empty) row += empty;
      rows.push(row);
    }
    let c = "";
    if (this.castling & CASTLE_WK) c += "K";
    if (this.castling & CASTLE_WQ) c += "Q";
    if (this.castling & CASTLE_BK) c += "k";
    if (this.castling & CASTLE_BQ) c += "q";
    return [
      rows.join("/"),
      this.side === WHITE ? "w" : "b",
      c || "-",
      this.ep >= 0 ? squareName(this.ep) : "-",
      this.halfmove,
      this.fullmove,
    ].join(" ");
  }

  /** True if `sq` is attacked by any piece of side `by`. */
  attacked(sq: number, by: Side): boolean {
    const b = this.board;
    // Pawns: a white pawn on p attacks p+15 / p+17.
    if (by === WHITE) {
      if (!((sq - 15) & 0x88) && b[sq - 15] === (PAWN | WHITE)) return true;
      if (!((sq - 17) & 0x88) && b[sq - 17] === (PAWN | WHITE)) return true;
    } else {
      if (!((sq + 15) & 0x88) && b[sq + 15] === (PAWN | BLACK)) return true;
      if (!((sq + 17) & 0x88) && b[sq + 17] === (PAWN | BLACK)) return true;
    }
    for (const o of KNIGHT_OFFSETS) {
      const t = sq + o;
      if (!(t & 0x88) && b[t] === (KNIGHT | by)) return true;
    }
    for (const o of KING_OFFSETS) {
      const t = sq + o;
      if (!(t & 0x88) && b[t] === (KING | by)) return true;
    }
    for (const d of BISHOP_DIRS) {
      for (let t = sq + d; !(t & 0x88); t += d) {
        const p = b[t];
        if (!p) continue;
        if (p === (BISHOP | by) || p === (QUEEN | by)) return true;
        break;
      }
    }
    for (const d of ROOK_DIRS) {
      for (let t = sq + d; !(t & 0x88); t += d) {
        const p = b[t];
        if (!p) continue;
        if (p === (ROOK | by) || p === (QUEEN | by)) return true;
        break;
      }
    }
    return false;
  }

  /** All squares holding pieces of side `by` that attack `sq`. */
  attackers(sq: number, by: Side): number[] {
    const out: number[] = [];
    const b = this.board;
    const pawnFrom = by === WHITE ? [sq - 15, sq - 17] : [sq + 15, sq + 17];
    for (const t of pawnFrom) if (!(t & 0x88) && b[t] === (PAWN | by)) out.push(t);
    for (const o of KNIGHT_OFFSETS) {
      const t = sq + o;
      if (!(t & 0x88) && b[t] === (KNIGHT | by)) out.push(t);
    }
    for (const o of KING_OFFSETS) {
      const t = sq + o;
      if (!(t & 0x88) && b[t] === (KING | by)) out.push(t);
    }
    for (const [dirs, kind] of [[BISHOP_DIRS, BISHOP], [ROOK_DIRS, ROOK]] as const) {
      for (const d of dirs) {
        for (let t = sq + d; !(t & 0x88); t += d) {
          const p = b[t];
          if (!p) continue;
          if (p === (kind | by) || p === (QUEEN | by)) out.push(t);
          break;
        }
      }
    }
    return out;
  }

  inCheck(side: Side = this.side): boolean {
    return this.attacked(this.kings[side >> 3], (side ^ 8) as Side);
  }

  /** Pseudo-legal moves for the side to move. `capturesOnly` also keeps promotions. */
  pseudoMoves(capturesOnly = false): Move[] {
    const moves: Move[] = [];
    const b = this.board;
    const us = this.side;
    const them = (us ^ 8) as Side;

    const add = (from: number, to: number, piece: number, captured: number, flags: number) => {
      if (typeOf(piece) === PAWN && (rankOf(to) === 7 || rankOf(to) === 0)) {
        for (const promo of [QUEEN, ROOK, BISHOP, KNIGHT]) {
          moves.push({ from, to, piece, captured, promotion: promo, flags: flags | FLAG_PROMO });
        }
      } else {
        moves.push({ from, to, piece, captured, promotion: 0, flags });
      }
    };

    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) {
        sq += 7;
        continue;
      }
      const piece = b[sq];
      if (!piece || colorOf(piece) !== us) continue;
      const type = typeOf(piece);

      if (type === PAWN) {
        const dir = us === WHITE ? 16 : -16;
        const startRank = us === WHITE ? 1 : 6;
        const one = sq + dir;
        if (!(one & 0x88) && !b[one]) {
          const promoting = rankOf(one) === 7 || rankOf(one) === 0;
          if (!capturesOnly || promoting) add(sq, one, piece, 0, 0);
          const two = one + dir;
          if (!capturesOnly && rankOf(sq) === startRank && !b[two]) {
            moves.push({ from: sq, to: two, piece, captured: 0, promotion: 0, flags: FLAG_DOUBLE });
          }
        }
        for (const side of [-1, 1]) {
          const t = one + side;
          if (t & 0x88) continue;
          if (b[t] && colorOf(b[t]) === them) add(sq, t, piece, b[t], FLAG_CAPTURE);
          else if (t === this.ep) {
            moves.push({ from: sq, to: t, piece, captured: PAWN | them, promotion: 0, flags: FLAG_CAPTURE | FLAG_EP });
          }
        }
        continue;
      }

      if (type === KNIGHT || type === KING) {
        for (const o of type === KNIGHT ? KNIGHT_OFFSETS : KING_OFFSETS) {
          const t = sq + o;
          if (t & 0x88) continue;
          const target = b[t];
          if (!target) {
            if (!capturesOnly) add(sq, t, piece, 0, 0);
          } else if (colorOf(target) === them) add(sq, t, piece, target, FLAG_CAPTURE);
        }
      } else {
        const dirs = type === BISHOP ? BISHOP_DIRS : type === ROOK ? ROOK_DIRS : KING_OFFSETS;
        for (const d of dirs) {
          for (let t = sq + d; !(t & 0x88); t += d) {
            const target = b[t];
            if (!target) {
              if (!capturesOnly) add(sq, t, piece, 0, 0);
              continue;
            }
            if (colorOf(target) === them) add(sq, t, piece, target, FLAG_CAPTURE);
            break;
          }
        }
      }
    }

    if (!capturesOnly) this.addCastling(moves);
    return moves;
  }

  private addCastling(moves: Move[]) {
    const b = this.board;
    const us = this.side;
    const them = (us ^ 8) as Side;
    const base = us === WHITE ? 0 : 112;
    const king = KING | us;
    const rook = ROOK | us;
    if (b[base + SQ_E1] !== king) return;
    const kRight = us === WHITE ? CASTLE_WK : CASTLE_BK;
    const qRight = us === WHITE ? CASTLE_WQ : CASTLE_BQ;
    if (!(this.castling & (kRight | qRight))) return;
    if (this.attacked(base + SQ_E1, them)) return;
    if (
      this.castling & kRight &&
      b[base + SQ_H1] === rook &&
      !b[base + SQ_F1] &&
      !b[base + SQ_G1] &&
      !this.attacked(base + SQ_F1, them) &&
      !this.attacked(base + SQ_G1, them)
    ) {
      moves.push({ from: base + SQ_E1, to: base + SQ_G1, piece: king, captured: 0, promotion: 0, flags: FLAG_CASTLE });
    }
    if (
      this.castling & qRight &&
      b[base + SQ_A1] === rook &&
      !b[base + SQ_D1] &&
      !b[base + SQ_C1] &&
      !b[base + 1] &&
      !this.attacked(base + SQ_D1, them) &&
      !this.attacked(base + SQ_C1, them)
    ) {
      moves.push({ from: base + SQ_E1, to: base + SQ_C1, piece: king, captured: 0, promotion: 0, flags: FLAG_CASTLE });
    }
  }

  /** Makes a pseudo-legal move. Returns false (and leaves it unmade) if it leaves the mover in check. */
  make(m: Move): boolean {
    const b = this.board;
    const us = this.side;
    this.history.push({ move: m, castling: this.castling, ep: this.ep, halfmove: this.halfmove });

    b[m.to] = m.promotion ? m.promotion | us : m.piece;
    b[m.from] = 0;
    if (m.flags & FLAG_EP) b[us === WHITE ? m.to - 16 : m.to + 16] = 0;
    if (m.flags & FLAG_CASTLE) {
      const base = us === WHITE ? 0 : 112;
      if (m.to === base + SQ_G1) {
        b[base + SQ_F1] = b[base + SQ_H1];
        b[base + SQ_H1] = 0;
      } else {
        b[base + SQ_D1] = b[base + SQ_A1];
        b[base + SQ_A1] = 0;
      }
    }
    if (typeOf(m.piece) === KING) this.kings[us >> 3] = m.to;

    this.castling &= CASTLE_MASK[m.from] & CASTLE_MASK[m.to];
    this.ep = m.flags & FLAG_DOUBLE ? (m.from + m.to) >> 1 : -1;
    this.halfmove = typeOf(m.piece) === PAWN || m.captured ? 0 : this.halfmove + 1;
    if (us === BLACK) this.fullmove++;
    this.side = (us ^ 8) as Side;

    if (this.attacked(this.kings[us >> 3], this.side)) {
      this.unmake();
      return false;
    }
    return true;
  }

  /** Number of moves currently made on top of the constructed position. */
  get ply(): number {
    return this.history.length;
  }

  /** Unmakes moves until only `ply` remain (used to recover from an aborted search). */
  unmakeTo(ply: number): void {
    while (this.history.length > ply) this.unmake();
  }

  unmake(): void {
    const u = this.history.pop();
    if (!u) return;
    const m = u.move;
    const b = this.board;
    this.side = (this.side ^ 8) as Side;
    const us = this.side;
    if (us === BLACK) this.fullmove--;
    this.castling = u.castling;
    this.ep = u.ep;
    this.halfmove = u.halfmove;

    b[m.from] = m.piece;
    if (m.flags & FLAG_EP) {
      b[m.to] = 0;
      b[us === WHITE ? m.to - 16 : m.to + 16] = m.captured;
    } else {
      b[m.to] = m.captured;
    }
    if (m.flags & FLAG_CASTLE) {
      const base = us === WHITE ? 0 : 112;
      if (m.to === base + SQ_G1) {
        b[base + SQ_H1] = b[base + SQ_F1];
        b[base + SQ_F1] = 0;
      } else {
        b[base + SQ_A1] = b[base + SQ_D1];
        b[base + SQ_D1] = 0;
      }
    }
    if (typeOf(m.piece) === KING) this.kings[us >> 3] = m.from;
  }

  legalMoves(): Move[] {
    const out: Move[] = [];
    for (const m of this.pseudoMoves()) {
      if (this.make(m)) {
        out.push(m);
        this.unmake();
      }
    }
    return out;
  }

  /** Standard Algebraic Notation for a legal move in the current position. */
  san(m: Move, legal: Move[] = this.legalMoves()): string {
    let s: string;
    if (m.flags & FLAG_CASTLE) {
      s = fileOf(m.to) === 6 ? "O-O" : "O-O-O";
    } else {
      const type = typeOf(m.piece);
      const capture = m.captured ? "x" : "";
      if (type === PAWN) {
        s = (capture ? "abcdefgh"[fileOf(m.from)] + "x" : "") + squareName(m.to);
        if (m.promotion) s += "=" + PIECE_CHARS[m.promotion].toUpperCase();
      } else {
        const rivals = legal.filter(
          (o) => o.to === m.to && o.piece === m.piece && o.from !== m.from,
        );
        let dis = "";
        if (rivals.length) {
          const sameFile = rivals.some((o) => fileOf(o.from) === fileOf(m.from));
          const sameRank = rivals.some((o) => rankOf(o.from) === rankOf(m.from));
          if (!sameFile) dis = "abcdefgh"[fileOf(m.from)];
          else if (!sameRank) dis = String(rankOf(m.from) + 1);
          else dis = squareName(m.from);
        }
        s = PIECE_CHARS[type].toUpperCase() + dis + capture + squareName(m.to);
      }
    }
    this.make(m);
    if (this.inCheck()) s += this.legalMoves().length === 0 ? "#" : "+";
    this.unmake();
    return s;
  }

  /** UCI long-algebraic form, e.g. "e2e4", "e7e8q". */
  static uci(m: Move): string {
    return squareName(m.from) + squareName(m.to) + (m.promotion ? PIECE_CHARS[m.promotion] : "");
  }

  /** Only kings, or king + a single minor piece per side, cannot mate. */
  insufficientMaterial(): boolean {
    let minors = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) {
        sq += 7;
        continue;
      }
      const t = typeOf(this.board[sq]);
      if (t === PAWN || t === ROOK || t === QUEEN) return false;
      if (t === KNIGHT || t === BISHOP) minors++;
    }
    return minors <= 1;
  }
}

export function perft(pos: Position, depth: number): number {
  if (depth === 0) return 1;
  let nodes = 0;
  for (const m of pos.pseudoMoves()) {
    if (!pos.make(m)) continue;
    nodes += depth === 1 ? 1 : perft(pos, depth - 1);
    pos.unmake();
  }
  return nodes;
}
