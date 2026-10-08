/**
 * Typed errors for the move pipeline. The split that matters is fatal vs
 * transient:
 *
 * - fatal (APIKeyError, RateLimitError, ModelUnavailableError): retrying can't
 *   help; the match is cancelled (or deleted if no move was played yet)
 * - transient (TimeoutError, ParseError, ProviderError): the judge retries, and
 *   repeated failures cost the side a timeout warning
 */

export class ChessError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = this.constructor.name;
    if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
  }
}

export class APIKeyError extends ChessError {
  constructor(provider: string, public readonly statusCode?: number) {
    super(`Invalid or missing API key for ${provider}`, "API_KEY_ERROR");
  }
}

export class RateLimitError extends ChessError {
  constructor(provider: string, public readonly retryAfter?: number) {
    super(`Rate limit exceeded for ${provider}`, "RATE_LIMIT_ERROR");
  }
}

/** The provider says the model doesn't exist (renamed, retired, no access). */
export class ModelUnavailableError extends ChessError {
  constructor(public readonly modelId: string, detail?: string) {
    super(`Model ${modelId} is unavailable${detail ? `: ${detail}` : ""}`, "MODEL_UNAVAILABLE");
  }
}

export class TimeoutError extends ChessError {
  constructor(operation: string, public readonly timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms`, "TIMEOUT_ERROR");
  }
}

export class ParseError extends ChessError {
  constructor(public readonly response: string) {
    super("Failed to parse AI response", "PARSE_ERROR");
  }
}

/** A server-side or network failure that may succeed on retry. */
export class ProviderError extends ChessError {
  constructor(provider: string, detail: string, public readonly statusCode?: number) {
    super(`${provider} request failed: ${detail}`, "PROVIDER_ERROR");
  }
}

export function isFatalError(err: unknown): err is APIKeyError | RateLimitError | ModelUnavailableError {
  return err instanceof APIKeyError || err instanceof RateLimitError || err instanceof ModelUnavailableError;
}
