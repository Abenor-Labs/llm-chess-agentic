/**
 * "depth 5" NNUE: weights loader, feature indices and evaluation, ported from
 * ML-AI reasoning_harness/chess_nnue/net.py (same file format, same numbers).
 *
 * Network: 9216 inputs (768 piece-squares x 12 king buckets) -> 256 per
 * perspective (int16, SCReLU) -> 512 -> 32 -> 32 -> 1 (float32, clipped ReLU).
 * The output times SCALE is centipawns for the side to move.
 *
 * File (little endian): magic "NNUE" | version u32 | n_features u32 | ft u32 |
 * l1 u32 | l2 u32 | payload length u64 | sha256(payload) | payload, where the
 * payload is ft_w i16 [9216,256] | ft_b i16 [256] | w1 f32 [32,512] | b1 f32 [32]
 * | w2 f32 [32,32] | b2 f32 [32] | w3 f32 [32] | b3 f32 [1].
 */
import { createHash } from "crypto";
import { KING, typeOf, colorOf, type Move, type Position } from "../engine/position";

export const N_FEATURES = 9216;
export const FT = 256;
const L1 = 32;
const L2 = 32;
const QA = 255;
const SCALE = 400;
const HEADER = 64;

export interface Net {
  ftW: Int16Array;
  ftB: Int16Array;
  /** w1 pre-scaled by 1/QA^2 in float32, as net.py does. */
  w1: Float32Array;
  b1: Float32Array;
  w2: Float32Array;
  b2: Float32Array;
  w3: Float32Array;
  b3: number;
}

export function loadNet(bytes: Uint8Array): Net {
  if (bytes.length < HEADER) throw new Error("weights file too short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  const version = view.getUint32(4, true);
  if (magic !== "NNUE" || version !== 1) throw new Error(`bad header: magic ${JSON.stringify(magic)} version ${version}`);
  const shape = [8, 12, 16, 20].map((o) => view.getUint32(o, true));
  if (shape.join() !== [N_FEATURES, FT, L1, L2].join()) throw new Error(`unexpected shapes ${shape.join(",")}`);
  const size = Number(view.getBigUint64(24, true));
  const payload = bytes.subarray(HEADER);
  const digest = createHash("sha256").update(payload).digest();
  if (payload.length !== size || !digest.equals(bytes.subarray(32, 64))) throw new Error("weights checksum mismatch");

  // Copy so the typed arrays are aligned whatever the caller's offset (Buffer#slice is a view, so copy via the constructor).
  const buf = new Uint8Array(payload).buffer;
  let off = 0;
  const i16 = (n: number) => {
    const a = new Int16Array(buf, off, n);
    off += n * 2;
    return a;
  };
  const f32 = (n: number) => {
    const a = new Float32Array(buf, off, n);
    off += n * 4;
    return a;
  };
  const ftW = i16(N_FEATURES * FT);
  const ftB = i16(FT);
  const w1 = f32(L1 * 2 * FT).map((w) => w * Math.fround(1 / (QA * QA)));
  return { ftW, ftB, w1, b1: f32(L1), w2: f32(L2 * L1), b2: f32(L2), w3: f32(L2), b3: f32(1)[0] };
}

// Bucket of the perspective's own king on its (oriented, mirrored) square.
const BUCKET_ROWS = [[0, 1, 2, 3], [4, 4, 5, 5], [6, 6, 7, 7], [8, 8, 9, 9], [10, 10, 11, 11]];
// BASE[p*64 + king] and ORIENT[p*64 + king]: feature base and square xor for perspective p.
const BASE = new Int32Array(128);
const ORIENT = new Int32Array(128);
for (let p = 0; p < 2; p++) {
  for (let k = 0; k < 64; k++) {
    const kk = k ^ (56 * p);
    const m = kk % 8 >= 4 ? 7 : 0;
    const s = kk ^ m;
    BASE[p * 64 + k] = BUCKET_ROWS[Math.min(s >> 3, 4)][s & 7] * 768;
    ORIENT[p * 64 + k] = 56 * p ^ m;
  }
}

/** 0x88 square -> 0..63. */
export const sq64 = (sq: number) => (sq >> 4) * 8 + (sq & 7);

/** Feature row for `piece` (engine code, type | color) on 0x88 square `sq`, seen by perspective p with its king on k64. */
export function featureIndex(p: number, k64: number, piece: number, sq: number): number {
  const rel = 6 * ((colorOf(piece) >> 3) ^ p) + typeOf(piece) - 1;
  return BASE[p * 64 + k64] + rel * 64 + (sq64(sq) ^ ORIENT[p * 64 + k64]);
}

/** Two perspectives' accumulators, white's in [0, FT) and black's in [FT, 2FT). */
export type Acc = Int32Array;

export function refreshPersp(net: Net, pos: Position, p: number, acc: Acc): void {
  const k64 = sq64(pos.kings[p]);
  const o = p * FT;
  for (let i = 0; i < FT; i++) acc[o + i] = net.ftB[i];
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) {
      sq += 7;
      continue;
    }
    const piece = pos.board[sq];
    if (!piece) continue;
    const row = featureIndex(p, k64, piece, sq) * FT;
    for (let i = 0; i < FT; i++) acc[o + i] += net.ftW[row + i];
  }
}

export function refresh(net: Net, pos: Position, acc: Acc = new Int32Array(2 * FT)): Acc {
  refreshPersp(net, pos, 0, acc);
  refreshPersp(net, pos, 1, acc);
  return acc;
}

/**
 * Writes the accumulators after `m` into `out`, from `acc` before it. Call
 * with `pos` already moved (pos.make(m) returned true); a move of p's own king
 * refreshes p from the new position.
 */
export function push(net: Net, pos: Position, m: Move, acc: Acc, out: Acc): void {
  const us = colorOf(m.piece);
  const mover = us >> 3;
  const adds: number[] = [m.promotion ? m.promotion | us : m.piece, m.to];
  const subs: number[] = [m.piece, m.from];
  if (m.captured) subs.push(m.captured, m.flags & 2 ? (us ? m.to + 16 : m.to - 16) : m.to); // 2 = FLAG_EP
  if (m.flags & 4) {
    // castling: the rook moves too
    const base = us ? 112 : 0;
    const rook = 4 | us;
    const kingSide = (m.to & 7) === 6;
    adds.push(rook, base + (kingSide ? 5 : 3));
    subs.push(rook, base + (kingSide ? 7 : 0));
  }
  for (let p = 0; p < 2; p++) {
    if (p === mover && typeOf(m.piece) === KING) {
      refreshPersp(net, pos, p, out);
      continue;
    }
    const k64 = sq64(pos.kings[p]);
    const o = p * FT;
    for (let i = 0; i < FT; i++) out[o + i] = acc[o + i];
    for (let j = 0; j < adds.length; j += 2) {
      const row = featureIndex(p, k64, adds[j], adds[j + 1]) * FT;
      for (let i = 0; i < FT; i++) out[o + i] += net.ftW[row + i];
    }
    for (let j = 0; j < subs.length; j += 2) {
      const row = featureIndex(p, k64, subs[j], subs[j + 1]) * FT;
      for (let i = 0; i < FT; i++) out[o + i] -= net.ftW[row + i];
    }
  }
}

const x = new Float64Array(2 * FT);
const h1 = new Float64Array(L1);

/** Centipawns for side `stm` (0 white, 1 black) to move. */
export function evaluate(net: Net, acc: Acc, stm: number): number {
  const us = stm * FT;
  const them = (1 - stm) * FT;
  for (let i = 0; i < FT; i++) {
    const a = Math.min(Math.max(acc[us + i], 0), QA);
    const b = Math.min(Math.max(acc[them + i], 0), QA);
    x[i] = a * a;
    x[FT + i] = b * b;
  }
  const { w1, b1, w2, b2, w3 } = net;
  for (let j = 0; j < L1; j++) {
    let s = 0;
    const row = j * 2 * FT;
    for (let i = 0; i < 2 * FT; i++) s += w1[row + i] * x[i];
    h1[j] = Math.min(Math.max(s + b1[j], 0), 1);
  }
  let out = net.b3;
  for (let j = 0; j < L2; j++) {
    let s = b2[j];
    for (let i = 0; i < L1; i++) s += w2[j * L1 + i] * h1[i];
    out += w3[j] * Math.min(Math.max(s, 0), 1);
  }
  return Math.trunc(out * SCALE);
}
