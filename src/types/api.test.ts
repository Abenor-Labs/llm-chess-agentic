import { describe, it, expect } from "vitest";
import { StartGameRequestSchema, GameIdSchema, GameStatusSchema } from "./api";

describe("StartGameRequestSchema", () => {
  it("accepts two models with optional modes and keys", () => {
    const parsed = StartGameRequestSchema.parse({
      modelIds: ["a", "b"],
      whiteMode: "novice",
      blackMode: "grandmaster",
      keys: { groq: "  gsk_x  ", anthropic: "sk-ant" },
    });
    expect(parsed.keys?.groq).toBe("gsk_x");
    expect(parsed.whiteMode).toBe("novice");
  });

  it("accepts legacy key fields", () => {
    const parsed = StartGameRequestSchema.parse({ modelIds: ["a", "b"], groqApiKey: "g", geminiApiKey: "m" });
    expect(parsed.groqApiKey).toBe("g");
    expect(parsed.geminiApiKey).toBe("m");
  });

  it.each([
    [{ modelIds: ["a"] }, "one model"],
    [{ modelIds: [] }, "no models"],
    [{ modelIds: ["a", "b", "c"] }, "three models"],
    [{ modelIds: ["a", "a"] }, "self-play"],
    [{ modelIds: ["a", ""] }, "empty id"],
    [{ modelIds: ["a", "b"], whiteMode: "wizard" }, "unknown mode"],
    [{ modelIds: ["a", "b"], keys: { groq: "x".repeat(600) } }, "oversized key"],
    [{}, "missing modelIds"],
    [null, "null body"],
  ] as Array<[unknown, string]>)("rejects %j (%s)", (body) => {
    expect(StartGameRequestSchema.safeParse(body).success).toBe(false);
  });

  it("explains self-play", () => {
    const r = StartGameRequestSchema.safeParse({ modelIds: ["a", "a"] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/cannot play against itself/);
  });
});

describe("small schemas", () => {
  it("validates game ids and statuses", () => {
    expect(GameIdSchema.safeParse("00000000-0000-4000-8000-000000000001").success).toBe(true);
    expect(GameIdSchema.safeParse("not-a-uuid").success).toBe(false);
    expect(GameStatusSchema.safeParse("active").success).toBe(true);
    expect(GameStatusSchema.safeParse("aborted").success).toBe(false);
  });
});
