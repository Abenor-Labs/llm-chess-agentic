import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { APICallError } from "ai";
import { parseAIResponse, stripThinking, jsonObjects } from "./parse";
import { buildPrompt, renderBoard } from "./prompt";
import { effortOptions, planCall, providerOf, providerModelName, resolveKey, timeoutFor } from "./providers";
import { APIKeyError, RateLimitError, ModelUnavailableError, TimeoutError, ParseError, ProviderError } from "../errors";
import { STARTING_FEN } from "../chess";
import { scoreMoves } from "../engine";

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: vi.fn() };
});

const { generateText } = await import("ai");
const { requestMove, classifyError } = await import("./index");
const mockedGenerate = vi.mocked(generateText);

const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

describe("parseAIResponse", () => {
  it.each([
    ['{"move": "e4", "reasoning": "Center"}', "e4", "Center"],
    ['{"reasoning": "Develop first", "plan": "castle", "move": "Nf3"}', "Nf3", "Develop first"],
    ['```json\n{"move": "c5", "reasoning": "Sicilian"}\n```', "c5", "Sicilian"],
    ['Here is my move: {"move": "d4", "reasoning": "Space"} Good luck!', "d4", "Space"],
    ['{"move": "e5", "reason": "Counter"}', "e5", "Counter"],
    ['{"move": "Be7"}', "Be7", "No reasoning provided"],
    ["{'move': 'Nc6', 'reasoning': 'Develop'}", "Nc6", "Develop"],
  ])("parses %j", (input, move, reasoning) => {
    expect(parseAIResponse(input)).toMatchObject({ move, reasoning });
  });

  it("returns the plan when given", () => {
    expect(parseAIResponse('{"reasoning": "r", "plan": "push the h-pawn", "move": "h4"}')?.plan).toBe("push the h-pawn");
    expect(parseAIResponse('{"move": "h4"}')?.plan).toBeNull();
  });

  it("ignores draft JSON inside <think> blocks and takes the final answer", () => {
    const raw = '<think>maybe {"move": "Qh5", "reasoning": "draft"}? no, too early</think>\n{"reasoning": "solid", "move": "Nf3"}';
    expect(parseAIResponse(raw)).toMatchObject({ move: "Nf3", reasoning: "solid" });
  });

  it("takes the LAST object when several are present", () => {
    const raw = 'Option A: {"move": "e4"} Final answer: {"move": "d4", "reasoning": "flexible"}';
    expect(parseAIResponse(raw)?.move).toBe("d4");
  });

  it("handles braces inside reasoning strings", () => {
    const raw = '{"reasoning": "the {weak} squares on d5 } matter", "move": "c4"}';
    expect(parseAIResponse(raw)).toMatchObject({ move: "c4", reasoning: "the {weak} squares on d5 } matter" });
  });

  it("falls back to prose", () => {
    expect(parseAIResponse("I will play e4 to control the center")?.move).toBe("e4");
    expect(parseAIResponse("After thinking, my move is Nxe5+.")?.move).toBe("Nxe5+");
    expect(parseAIResponse("Final answer: O-O")?.move).toBe("O-O");
  });

  it("rejects non-answers", () => {
    expect(parseAIResponse("")).toBeNull();
    expect(parseAIResponse(null)).toBeNull();
    expect(parseAIResponse("hello world no moves here")).toBeNull();
    expect(parseAIResponse('{"reasoning": "no move key"}')).toBeNull();
    expect(parseAIResponse("<think>ran out of tokens mid-thought")).toBeNull();
    expect(parseAIResponse('{"move": "' + "x".repeat(40) + '"}')).toBeNull();
  });

  it("clips very long reasoning", () => {
    const parsed = parseAIResponse(JSON.stringify({ move: "e4", reasoning: "a ".repeat(2000) }));
    expect(parsed!.reasoning.length).toBeLessThanOrEqual(1200);
    expect(parsed!.reasoning.endsWith("…")).toBe(true);
  });
});

describe("stripThinking / jsonObjects", () => {
  it("strips closed, orphaned and unclosed traces", () => {
    expect(stripThinking("<think>a</think>answer")).toBe("answer");
    expect(stripThinking("leaked reasoning</think> answer")).toBe("answer");
    expect(stripThinking('{"move":"e4"}<thinking>cut off')).toBe('{"move":"e4"}');
    expect(stripThinking("<reasoning>x</reasoning><think>y</think>z")).toBe("z");
  });

  it("finds balanced top-level objects only", () => {
    expect(jsonObjects('a {"x": {"y": 1}} b {"z": "}"} {unclosed')).toEqual(['{"x": {"y": 1}}', '{"z": "}"}']);
  });
});

describe("prompt", () => {
  it("renders a labelled board", () => {
    const board = renderBoard(STARTING_FEN);
    expect(board.split("\n")[0]).toBe("8 | r n b q k b n r");
    expect(board.split("\n")[7]).toBe("1 | R N B Q K B N R");
    expect(board).toContain("a b c d e f g h");
  });

  it("includes the essentials for every mode", () => {
    const prompt = buildPrompt({ fen: AFTER_E4, color: "black", legalMoves: ["e5", "c5"], history: ["e4"], mode: "novice" });
    expect(prompt).toContain("BLACK");
    expect(prompt).toContain("Legal moves (2): e5, c5");
    expect(prompt).toContain("Game so far: 1. e4");
    expect(prompt).toContain("opponent's last move: e4");
    expect(prompt).toContain('"move"');
    expect(prompt).not.toContain("Briefing");
    expect(prompt).not.toContain("Engine shortlist");
  });

  it("adds a threat briefing for scholar and above", () => {
    // White knight on e5 is attacked by the d6 pawn and undefended.
    const fen = "rnbqkb1r/ppp2ppp/3p1n2/4N3/4P3/8/PPPP1PPP/RNBQKB1R w KQkq - 0 4";
    const prompt = buildPrompt({ fen, color: "white", legalMoves: ["Nf3"], history: [], mode: "scholar" });
    expect(prompt).toContain("Briefing");
    expect(prompt).toContain("knight on e5 (attacked by pawn on d6; undefended)");
  });

  it("says when the side is in check", () => {
    const fen = "rnb1kbnr/pppp1ppp/8/4p3/5PPq/8/PPPPP2P/RNBQKBNR w KQkq - 1 3";
    const prompt = buildPrompt({ fen, color: "white", legalMoves: [], history: [], mode: "apprentice" });
    expect(prompt).toContain("IN CHECK");
  });

  it("shows an advisory shortlist only for hint modes, scored only when allowed", () => {
    const candidates = scoreMoves(STARTING_FEN, 1);
    const base = { fen: STARTING_FEN, color: "white" as const, legalMoves: candidates.map((c) => c.move), history: [], candidates };
    expect(buildPrompt({ ...base, mode: "scholar" })).not.toContain("Engine shortlist");
    const strategist = buildPrompt({ ...base, mode: "strategist" });
    expect(strategist).toContain("Engine shortlist");
    expect(strategist).toContain("advice, not a rule");
    expect(strategist).not.toMatch(/\([+-]\d/);
    expect(buildPrompt({ ...base, mode: "grandmaster" })).toMatch(/\([+-]\d+\.\d\)/);
  });

  it("feeds back the previous plan and judge feedback", () => {
    const prompt = buildPrompt({
      fen: STARTING_FEN, color: "white", legalMoves: ["e4"], history: [],
      previousPlan: "castle kingside", feedback: '"Ke2" is not legal',
    });
    expect(prompt).toContain('Your plan from your previous move: "castle kingside"');
    expect(prompt).toContain('JUDGE FEEDBACK ON YOUR LAST ANSWER: "Ke2" is not legal');
  });
});

describe("providers", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it("routes by prefix", () => {
    expect(providerOf("groq/openai/gpt-oss-120b")).toBe("groq");
    expect(providerOf("google/models/gemini-3.5-flash")).toBe("google");
    expect(providerOf("anthropic/claude-sonnet-5-5")).toBe("anthropic");
    expect(providerOf("openai/gpt-5.6-terra")).toBe("openai");
    expect(providerOf("local/engine-3")).toBe("local");
    expect(providerOf("xai/grok-4")).toBe("gateway");
    expect(providerModelName("groq/openai/gpt-oss-120b")).toBe("openai/gpt-oss-120b");
    expect(providerModelName("xai/grok-4")).toBe("xai/grok-4");
  });

  it("maps effort onto each provider's reasoning controls", () => {
    expect(effortOptions("groq/openai/gpt-oss-120b", "minimal")).toEqual({ groq: { reasoningEffort: "low" } });
    expect(effortOptions("groq/openai/gpt-oss-120b", "high")).toEqual({ groq: { reasoningEffort: "high" } });
    expect(effortOptions("groq/qwen/qwen3.6-27b", "low")).toEqual({ groq: { reasoningEffort: "none", reasoningFormat: "hidden" } });
    expect(effortOptions("groq/qwen/qwen3.6-27b", "high")).toEqual({ groq: { reasoningEffort: "default", reasoningFormat: "hidden" } });
    expect(effortOptions("groq/llama-3.3-70b", "high")).toBeUndefined();
    expect(effortOptions("google/models/gemini-3.5-flash", "medium")).toEqual({ google: { thinkingConfig: { thinkingLevel: "low" } } });
    expect(effortOptions("google/models/gemini-3.1-pro-preview", "high")).toEqual({ google: { thinkingConfig: { thinkingLevel: "high" } } });
    expect(effortOptions("google/models/gemini-2.5-flash", "minimal")).toEqual({ google: { thinkingConfig: { thinkingBudget: 0 } } });
    expect(effortOptions("google/models/gemini-2.5-pro", "minimal")).toEqual({ google: { thinkingConfig: { thinkingBudget: 128 } } });
    expect(effortOptions("anthropic/claude-haiku-4-5", "low")).toBeUndefined();
    expect(effortOptions("anthropic/claude-sonnet-5-5", "high")).toEqual({ anthropic: { thinking: { type: "enabled", budgetTokens: 4096 } } });
    expect(effortOptions("openai/gpt-5.6-terra", "minimal")).toEqual({ openai: { reasoningEffort: "low" } });
    expect(effortOptions("xai/grok-4", "high")).toBeUndefined();
  });

  it("scales and caps timeouts by effort", () => {
    expect(timeoutFor("groq", "low")).toBe(12_000);
    expect(timeoutFor("groq", "high")).toBe(30_000);
    expect(timeoutFor("openai", "high")).toBe(100_000); // capped
  });

  it("prefers a per-match key over the environment", () => {
    process.env.GROQ_API_KEY = "env-key";
    expect(resolveKey("groq", { groq: "  mine  " })).toBe("mine");
    expect(resolveKey("groq", { groq: "  " })).toBe("env-key");
    delete process.env.GROQ_API_KEY;
    expect(resolveKey("groq", {})).toBeUndefined();
  });

  it("plans calls: drops temperature with thinking and adds the budget to max tokens", () => {
    const plan = planCall("anthropic/claude-sonnet-5-5", { effort: "high", temperature: 0.2, keys: { anthropic: "k" } });
    expect(plan.temperature).toBeUndefined();
    expect(plan.maxOutputTokens).toBe(8192 + 4096);
    const quick = planCall("groq/openai/gpt-oss-20b", { effort: "minimal", temperature: 0.9, keys: { groq: "k" } });
    expect(quick.temperature).toBe(0.9);
    expect(quick.maxOutputTokens).toBe(1024);
  });

  it("throws APIKeyError when a key is missing, and refuses local engines", () => {
    delete process.env.GEMINI_API_KEY;
    expect(() => planCall("google/models/gemini-3.5-flash", { effort: "low", temperature: 0.5 })).toThrow(APIKeyError);
    expect(() => planCall("local/engine-3", { effort: "low", temperature: 0.5 })).toThrow(/built-in/);
  });
});

function apiError(statusCode: number, message: string, responseBody = "") {
  return new APICallError({ message, url: "https://x", requestBodyValues: {}, statusCode, responseBody, isRetryable: false });
}

describe("classifyError", () => {
  const id = "groq/openai/gpt-oss-120b";
  it.each([
    [apiError(401, "Unauthorized"), APIKeyError],
    [apiError(403, "Forbidden"), APIKeyError],
    [apiError(429, "Too Many Requests"), RateLimitError],
    [apiError(404, "Not Found"), ModelUnavailableError],
    [apiError(400, "bad", '{"error":"The model `x` has been decommissioned"}'), ModelUnavailableError],
    [apiError(500, "Internal"), ProviderError],
    [Object.assign(new Error("The operation was aborted"), { name: "AbortError" }), TimeoutError],
    [new Error("fetch failed"), ProviderError],
    [new ParseError("x"), ParseError],
  ])("classifies %s", (err, type) => {
    expect(classifyError(err, id, 1000)).toBeInstanceOf(type);
  });
});

describe("requestMove", () => {
  const ctx = { fen: STARTING_FEN, color: "white" as const, legalMoves: ["e4", "d4"], history: [], mode: "scholar" };
  beforeEach(() => mockedGenerate.mockReset());

  it("returns the parsed proposal with latency and raw text", async () => {
    mockedGenerate.mockResolvedValueOnce({ text: '{"reasoning": "center", "plan": "d4 next", "move": "e4"}' } as never);
    const reply = await requestMove("groq/openai/gpt-oss-120b", ctx, { keys: { groq: "k" } });
    expect(reply).toMatchObject({ move: "e4", reasoning: "center", plan: "d4 next" });
    expect(reply.raw).toContain("e4");
    expect(reply.latencyMs).toBeGreaterThanOrEqual(0);
    const call = mockedGenerate.mock.calls[0][0] as Record<string, unknown>;
    expect(call.maxRetries).toBe(0);
    expect(call.temperature).toBe(0.5);
    expect(call.providerOptions).toEqual({ groq: { reasoningEffort: "low" } });
    expect(call.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("throws ParseError on an unparseable answer", async () => {
    mockedGenerate.mockResolvedValueOnce({ text: "I am not sure." } as never);
    await expect(requestMove("groq/openai/gpt-oss-120b", ctx, { keys: { groq: "k" } })).rejects.toBeInstanceOf(ParseError);
  });

  it("maps provider failures to typed errors", async () => {
    mockedGenerate.mockRejectedValueOnce(apiError(401, "Unauthorized"));
    await expect(requestMove("groq/openai/gpt-oss-120b", ctx, { keys: { groq: "bad" } })).rejects.toBeInstanceOf(APIKeyError);
    mockedGenerate.mockRejectedValueOnce(apiError(429, "slow down"));
    await expect(requestMove("groq/openai/gpt-oss-120b", ctx, { keys: { groq: "k" } })).rejects.toBeInstanceOf(RateLimitError);
  });

  it("retries once without effort options when the model rejects them", async () => {
    mockedGenerate
      .mockRejectedValueOnce(apiError(400, "Bad Request", '{"error":"reasoning_effort is not supported for this model"}'))
      .mockResolvedValueOnce({ text: '{"move": "d4"}' } as never);
    const reply = await requestMove("groq/openai/gpt-oss-120b", ctx, { keys: { groq: "k" } });
    expect(reply.move).toBe("d4");
    expect((mockedGenerate.mock.calls[1][0] as Record<string, unknown>).providerOptions).toBeUndefined();
  });

  it("does not retry other 400s", async () => {
    mockedGenerate.mockRejectedValueOnce(apiError(400, "Bad Request", "prompt too long"));
    await expect(requestMove("groq/openai/gpt-oss-120b", ctx, { keys: { groq: "k" } })).rejects.toBeInstanceOf(ProviderError);
    expect(mockedGenerate).toHaveBeenCalledTimes(1);
  });

  it("times out via abort signal", async () => {
    mockedGenerate.mockImplementationOnce((({ abortSignal }: { abortSignal: AbortSignal }) =>
      new Promise((_, reject) => abortSignal.addEventListener("abort", () => reject(abortSignal.reason)))) as never);
    await expect(
      requestMove("groq/openai/gpt-oss-120b", ctx, { keys: { groq: "k" }, timeoutMs: 20 }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it("honours an external abort (ply deadline)", async () => {
    const controller = new AbortController();
    mockedGenerate.mockImplementationOnce((({ abortSignal }: { abortSignal: AbortSignal }) =>
      new Promise((_, reject) => abortSignal.addEventListener("abort", () => reject(new Error("aborted"))))) as never);
    const pending = requestMove("groq/openai/gpt-oss-120b", ctx, { keys: { groq: "k" }, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(TimeoutError);
  });
});
