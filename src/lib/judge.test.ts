import { describe, it, expect, vi } from "vitest";
import { judgeMove, JudgeFailedError } from "./judge";
import { replay } from "./chess";
import { APIKeyError, ParseError, RateLimitError, TimeoutError } from "./errors";
import { describeJudgeEvent } from "./judge-types";
import type { MoveReply } from "./ai";

const reply = (move: string, extra: Partial<MoveReply> = {}): MoveReply => ({
  move,
  reasoning: `because ${move}`,
  plan: null,
  raw: move,
  latencyMs: 1,
  ...extra,
});

/** An `ask` that returns (or throws) the scripted answers in order and records feedback. */
function scripted(...answers: Array<MoveReply | Error>) {
  const feedback: Array<string | null> = [];
  const ask = vi.fn(async (fb: string | null) => {
    feedback.push(fb);
    const next = answers.shift();
    if (!next) throw new Error("script exhausted");
    if (next instanceof Error) throw next;
    return next;
  });
  return { ask, feedback };
}

// 1.e4 d5 — Qg4?? hangs the queen to ...Bxg4.
const SCANDI = () => replay(["e4", "d5"]);

describe("judgeMove", () => {
  it("accepts a good move on the first try", async () => {
    const { ask, feedback } = scripted(reply("exd5", { plan: "win the pawn" }));
    const v = await judgeMove({ chess: SCANDI(), mode: "scholar", ask });
    expect(v).toMatchObject({ san: "exd5", uci: "e4d5", reasoning: "because exd5", plan: "win the pawn", judge: { attempts: 1, events: [] } });
    expect(feedback).toEqual([null]);
  });

  it("repairs notation and records it", async () => {
    const { ask } = scripted(reply("e4d5"));
    const v = await judgeMove({ chess: SCANDI(), mode: "novice", ask });
    expect(v.san).toBe("exd5");
    expect(v.judge.events).toEqual([{ type: "notation", attempt: 1, from: "e4d5", to: "exd5" }]);
  });

  it("does not report a notation fix for check suffix differences", async () => {
    const chess = replay(["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6"]);
    const { ask } = scripted(reply("Qxf7"));
    const v = await judgeMove({ chess, mode: "novice", ask });
    expect(v.san).toBe("Qxf7#");
    expect(v.judge.events).toEqual([]);
  });

  it("explains illegal moves, including check, and retries", async () => {
    const inCheck = replay(["e4", "f5", "Qh5+"]);
    const { ask, feedback } = scripted(reply("Nf6"), reply("g6"));
    const v = await judgeMove({ chess: inCheck, mode: "novice", ask });
    expect(v.san).toBe("g6");
    expect(feedback[1]).toContain('"Nf6" is not a legal move');
    expect(feedback[1]).toContain("You are in check");
    expect(feedback[1]).toContain("g6");
  });

  it("asks once about a blunder with the refutation; the second answer stands", async () => {
    const { ask, feedback } = scripted(reply("Qg4"), reply("Qg4"));
    const v = await judgeMove({ chess: SCANDI(), mode: "scholar", ask });
    expect(v.san).toBe("Qg4");
    expect(v.judge.reconsidered).toBeUndefined();
    expect(v.judge.events).toEqual([expect.objectContaining({ type: "blunder", move: "Qg4", reply: "Bxg4" })]);
    expect(feedback[1]).toMatch(/pawns worse than your best option — after Qg4, your opponent can answer Bxg4/);
  });

  it("flags a move that allows mate, and one that misses mate", async () => {
    // White to move; Qxf7# is mate, Qxe5+?? does not.
    const mating = replay(["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6"]);
    const missed = scripted(reply("d3"), reply("Qxf7#"));
    const v = await judgeMove({ chess: mating, mode: "apprentice", ask: missed.ask });
    expect(v.san).toBe("Qxf7#");
    expect(v.judge.reconsidered).toBe(true);
    expect(v.judge.events[0]).toMatchObject({ type: "blunder", mate: "missed" });
    expect(missed.feedback[1]).toContain("you have a forced checkmate");
    expect(describeJudgeEvent(v.judge.events[0])).toContain("misses a forced mate");

    // Black to move after 1.e4 e5 2.Bc4 Nc6 3.Qh5: ...Nf6?? allows Qxf7#.
    const danger = replay(["e4", "e5", "Bc4", "Nc6", "Qh5"]);
    const allowed = scripted(reply("Nf6"), reply("g6"));
    const w = await judgeMove({ chess: danger, mode: "scholar", ask: allowed.ask });
    expect(w.san).toBe("g6");
    expect(w.judge.events[0]).toMatchObject({ type: "blunder", move: "Nf6", mate: "allowed", reply: "Qxf7#" });
    expect(allowed.feedback[1]).toContain("allows a forced checkmate — your opponent can start it with Qxf7#");
  });

  it("never runs the guard on the last attempt", async () => {
    const { ask } = scripted(reply("Qg4"));
    const v = await judgeMove({ chess: SCANDI(), mode: "grandmaster", ask, maxAttempts: 1 });
    expect(v.san).toBe("Qg4");
    expect(v.judge.events).toEqual([]);
  });

  it("warns a winning side once before a threefold repetition", async () => {
    // White is a queen up and shuffling; Qb2 would create the same position a third time.
    const chess = replay([]);
    chess.load("4k3/8/8/8/8/8/8/Q3K3 w - - 0 1");
    for (const m of ["Qb2", "Kd8", "Qa2", "Ke8", "Qb2", "Kd8", "Qa2", "Ke8"]) chess.move(m);
    expect(chess.isThreefoldRepetition()).toBe(false);
    const { ask, feedback } = scripted(reply("Qb2"), reply("Qa8+"));
    const v = await judgeMove({ chess, mode: "novice", ask });
    expect(v.san).toBe("Qa8+");
    expect(v.judge.events[0]).toMatchObject({ type: "repetition", move: "Qb2" });
    expect(feedback[1]).toContain("repeats this position for the third time");
  });

  it("falls back to the earlier legal move when later attempts fail", async () => {
    const { ask } = scripted(reply("Qg4"), new ParseError("??"), new TimeoutError("x", 1));
    const v = await judgeMove({ chess: SCANDI(), mode: "scholar", ask });
    expect(v.san).toBe("Qg4");
    expect(v.judge.events.map((e) => e.type)).toEqual(["blunder", "parse", "error", "fallback"]);
  });

  it("gives parse feedback but no feedback after a transport error", async () => {
    const { ask, feedback } = scripted(new ParseError("??"), new TimeoutError("x", 1), reply("exd5"));
    const v = await judgeMove({ chess: SCANDI(), mode: "novice", ask });
    expect(v.san).toBe("exd5");
    expect(feedback[1]).toContain("could not be read");
    expect(feedback[2]).toBeNull();
    expect(v.judge.events).toEqual([
      { type: "parse", attempt: 1 },
      { type: "error", attempt: 2, detail: "timed out" },
    ]);
  });

  it("throws JudgeFailedError with the record when nothing legal was proposed", async () => {
    const { ask } = scripted(reply("Ke9"), new ParseError(""), reply("Qh8"));
    const err = await judgeMove({ chess: SCANDI(), mode: "novice", ask }).catch((e) => e);
    expect(err).toBeInstanceOf(JudgeFailedError);
    expect(err.record.attempts).toBe(3);
    expect(err.record.events.map((e: { type: string }) => e.type)).toEqual(["illegal", "parse", "illegal"]);
    expect(err.message).toMatch(/No legal move after 3 attempts/);
  });

  it("propagates fatal errors immediately", async () => {
    for (const fatal of [new APIKeyError("Groq", 401), new RateLimitError("Groq")]) {
      const { ask } = scripted(fatal, reply("exd5"));
      await expect(judgeMove({ chess: SCANDI(), mode: "novice", ask })).rejects.toBe(fatal);
      expect(ask).toHaveBeenCalledTimes(1);
    }
  });

  it("stops asking once the ply deadline has passed", async () => {
    const controller = new AbortController();
    const ask = vi.fn(async () => {
      controller.abort();
      throw new TimeoutError("x", 1);
    });
    await expect(judgeMove({ chess: SCANDI(), mode: "novice", ask, signal: controller.signal })).rejects.toBeInstanceOf(JudgeFailedError);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("leaves the game untouched", async () => {
    const chess = SCANDI();
    const before = chess.fen();
    const history = chess.history();
    const { ask } = scripted(reply("Qg4"), reply("exd5"));
    await judgeMove({ chess, mode: "scholar", ask });
    expect(chess.fen()).toBe(before);
    expect(chess.history()).toEqual(history);
  });
});
