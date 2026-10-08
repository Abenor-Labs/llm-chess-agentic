import { describe, it, expect, vi, afterEach } from "vitest";
import { requestMove } from "./index";
import { STARTING_FEN } from "../chess";
import { ProviderError } from "../errors";

/**
 * What actually goes over the wire for each provider, through the real AI SDK.
 * fetch is stubbed to capture the request and fail it, so nothing leaves the
 * machine. These catch SDK/model drift that option-mapping unit tests can't
 * (e.g. a model that rejects temperature or thinking budgets with a 400).
 */

const ctx = (mode: string) => ({ fen: STARTING_FEN, color: "white" as const, legalMoves: ["e4", "d4"], history: [], mode });

async function captureRequest(modelId: string, mode: string) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
      return new Response(JSON.stringify({ error: { message: "stubbed" } }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  const keys = { groq: "k", google: "k", anthropic: "k", openai: "k" };
  await expect(requestMove(modelId, ctx(mode), { keys })).rejects.toBeInstanceOf(ProviderError);
  expect(calls).toHaveLength(1);
  return calls[0];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider requests", () => {
  it.each(["anthropic/claude-opus-5-5", "anthropic/claude-sonnet-5-5", "anthropic/claude-haiku-5-5", "anthropic/claude-fable-5-1"])(
    "%s: effort, no sampling parameters, no thinking budget",
    async (id) => {
      for (const [mode, effort] of [["novice", "low"], ["strategist", "medium"], ["grandmaster", "high"]] as const) {
        const { url, body } = await captureRequest(id, mode);
        expect(url).toContain("api.anthropic.com");
        expect(body.model).toBe(id.slice("anthropic/".length));
        expect(body).not.toHaveProperty("temperature");
        expect(body).not.toHaveProperty("top_p");
        expect((body.thinking as { budget_tokens?: number } | undefined)?.budget_tokens).toBeUndefined();
        expect((body.output_config as { effort?: string }).effort).toBe(effort);
        expect(body.max_tokens).toBeGreaterThanOrEqual(2048);
      }
    },
  );

  it("older Claude keeps a manual thinking budget", async () => {
    const { body } = await captureRequest("anthropic/claude-haiku-4-5", "grandmaster");
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 4096 });
    expect(body).not.toHaveProperty("temperature");
  });

  it.each(["openai/gpt-6-astra", "openai/gpt-6.1-sol", "openai/gpt-6-luna"])("%s: reasoning effort, no temperature", async (id) => {
    const { url, body } = await captureRequest(id, "grandmaster");
    expect(url).toContain("api.openai.com");
    expect(body.model).toBe(id.slice("openai/".length));
    expect(body).not.toHaveProperty("temperature");
    expect(body.reasoning).toMatchObject({ effort: "high" });
  });

  it.each(["google/models/gemini-3.8-flash", "google/models/gemini-3.5-flash-lite", "google/models/gemini-3.1-pro-preview"])(
    "%s: thinking level",
    async (id) => {
      const { url, body } = await captureRequest(id, "scholar");
      expect(url).toContain(`generativelanguage.googleapis.com/v1beta/${id.slice("google/".length)}:generateContent`);
      expect(body.generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: "low" }, temperature: 0.5 });
    },
  );

  it("groq/qwen/qwen3.8-27b: hidden reasoning", async () => {
    const { url, body } = await captureRequest("groq/qwen/qwen3.8-27b", "novice");
    expect(url).toContain("api.groq.com");
    expect(body).toMatchObject({ model: "qwen/qwen3.8-27b", reasoning_effort: "none", reasoning_format: "hidden" });
  });

  it("groq/openai/gpt-oss-120b: reasoning effort", async () => {
    const { body } = await captureRequest("groq/openai/gpt-oss-120b", "grandmaster");
    expect(body).toMatchObject({ model: "openai/gpt-oss-120b", reasoning_effort: "high" });
  });
});
