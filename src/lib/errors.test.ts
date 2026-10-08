import { describe, it, expect } from "vitest";
import {
  ChessError,
  APIKeyError,
  RateLimitError,
  ModelUnavailableError,
  TimeoutError,
  ParseError,
  ProviderError,
  isFatalError,
} from "./errors";

describe("error classes", () => {
  it.each([
    [new APIKeyError("Groq", 401), "API_KEY_ERROR", "Invalid or missing API key for Groq"],
    [new RateLimitError("Google", 30), "RATE_LIMIT_ERROR", "Rate limit exceeded for Google"],
    [new ModelUnavailableError("groq/x", "not found"), "MODEL_UNAVAILABLE", "Model groq/x is unavailable: not found"],
    [new TimeoutError("Groq request", 7000), "TIMEOUT_ERROR", "Groq request timed out after 7000ms"],
    [new ParseError("garbage"), "PARSE_ERROR", "Failed to parse AI response"],
    [new ProviderError("OpenAI", "HTTP 503", 503), "PROVIDER_ERROR", "OpenAI request failed: HTTP 503"],
  ])("%o carries code and message", (err, code, message) => {
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ChessError);
    expect(err.code).toBe(code);
    expect(err.message).toBe(message);
    expect(err.name).toBe(err.constructor.name);
    expect(err.stack).toContain(err.constructor.name);
  });

  it("keeps structured fields", () => {
    expect(new APIKeyError("Groq", 403).statusCode).toBe(403);
    expect(new APIKeyError("Groq").statusCode).toBeUndefined();
    expect(new RateLimitError("Groq", 60).retryAfter).toBe(60);
    expect(new TimeoutError("x", 5).timeoutMs).toBe(5);
    expect(new ParseError("raw").response).toBe("raw");
    expect(new ModelUnavailableError("m").message).toBe("Model m is unavailable");
  });

  it("classifies fatal vs transient", () => {
    expect(isFatalError(new APIKeyError("x"))).toBe(true);
    expect(isFatalError(new RateLimitError("x"))).toBe(true);
    expect(isFatalError(new ModelUnavailableError("x"))).toBe(true);
    expect(isFatalError(new TimeoutError("x", 1))).toBe(false);
    expect(isFatalError(new ParseError("x"))).toBe(false);
    expect(isFatalError(new ProviderError("x", "y"))).toBe(false);
    expect(isFatalError(new Error("plain"))).toBe(false);
    expect(isFatalError(null)).toBe(false);
  });
});
