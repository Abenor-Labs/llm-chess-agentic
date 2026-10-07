import { generateText, APICallError } from "ai";
import { modeConfig } from "../modes";
import {
  APIKeyError,
  RateLimitError,
  ModelUnavailableError,
  TimeoutError,
  ParseError,
  ProviderError,
  ChessError,
} from "../errors";
import { planCall, providerOf, PROVIDER_LABEL, type ApiKeys, type CallPlan } from "./providers";
import { parseAIResponse } from "./parse";
import { buildPrompt, type PromptContext } from "./prompt";

export { buildPrompt, renderBoard, type PromptContext } from "./prompt";
export { parseAIResponse, stripThinking, jsonObjects, type ParsedReply } from "./parse";
export {
  providerOf,
  providerModelName,
  resolveKey,
  effortOptions,
  planCall,
  timeoutFor,
  isKeyedProvider,
  KEYED_PROVIDERS,
  PROVIDER_LABEL,
  type ApiKeys,
  type KeyedProvider,
  type ProviderId,
} from "./providers";

export interface MoveReply {
  /** The move exactly as the model wrote it (the judge canonicalizes it). */
  move: string;
  reasoning: string;
  plan: string | null;
  raw: string;
  latencyMs: number;
}

/** Maps SDK / HTTP failures onto the typed errors the judge and processor act on. */
export function classifyError(err: unknown, modelId: string, timeoutMs: number): ChessError {
  if (err instanceof ChessError) return err;
  const provider = PROVIDER_LABEL[providerOf(modelId)];
  const name = (err as { name?: string })?.name;
  if (name === "AbortError" || name === "TimeoutError") return new TimeoutError(`${provider} request for ${modelId}`, timeoutMs);

  const status = APICallError.isInstance(err) ? err.statusCode : (err as { statusCode?: number })?.statusCode;
  const message = err instanceof Error ? err.message : String(err);
  const body = APICallError.isInstance(err) ? (err.responseBody ?? "") : "";
  const text = `${message} ${body}`.toLowerCase();

  if (status === 401 || status === 403 || /invalid api key|incorrect api key|api key not valid|unauthori[sz]ed|permission denied/.test(text)) {
    return new APIKeyError(provider, status);
  }
  if (status === 429 || /rate limit|quota|too many requests|resource.?exhausted/.test(text)) {
    const header = APICallError.isInstance(err) ? err.responseHeaders?.["retry-after"] : undefined;
    return new RateLimitError(provider, header ? Number(header) || undefined : undefined);
  }
  if (status === 404 || /model[^.]*(not found|does not exist|decommissioned|deprecated|not supported)/.test(text)) {
    return new ModelUnavailableError(modelId, message.slice(0, 200));
  }
  if (/timed? ?out|timeout|aborted/.test(text)) return new TimeoutError(`${provider} request for ${modelId}`, timeoutMs);
  return new ProviderError(provider, message.slice(0, 300), status);
}

/** A 400 that names a reasoning/thinking knob means this model doesn't take it. */
function rejectedEffortOptions(err: unknown): boolean {
  if (!APICallError.isInstance(err) || err.statusCode !== 400) return false;
  const text = `${err.message} ${err.responseBody ?? ""}`.toLowerCase();
  return /reasoning|thinking|effort|budget/.test(text);
}

async function generate(plan: CallPlan, prompt: string, signal: AbortSignal, withOptions: boolean): Promise<string> {
  const result = await generateText({
    model: plan.model,
    prompt,
    temperature: plan.temperature,
    maxOutputTokens: plan.maxOutputTokens,
    providerOptions: withOptions ? (plan.providerOptions as never) : undefined,
    // The judge owns retries (with feedback); SDK-level retries would only
    // multiply latency behind our timeout.
    maxRetries: 0,
    abortSignal: signal,
  });
  return result.text;
}

/**
 * One model call: prompt in, raw answer parsed into a move proposal out.
 * Throws typed errors; never invents a move.
 */
export async function requestMove(
  modelId: string,
  ctx: PromptContext,
  opts: { keys?: ApiKeys; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<MoveReply> {
  const cfg = modeConfig(ctx.mode);
  const plan = planCall(modelId, { effort: cfg.effort, temperature: cfg.temperature, keys: opts.keys });
  const timeoutMs = Math.min(plan.timeoutMs, opts.timeoutMs ?? Infinity);
  const prompt = buildPrompt(ctx);
  const started = Date.now();

  const timeout = AbortSignal.timeout(Math.max(1, timeoutMs));
  const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;

  let raw: string;
  try {
    try {
      raw = await generate(plan, prompt, signal, true);
    } catch (err) {
      if (!plan.providerOptions || !rejectedEffortOptions(err)) throw err;
      console.warn(`[requestMove] ${modelId} rejected effort options; retrying without them`);
      raw = await generate(plan, prompt, signal, false);
    }
  } catch (err) {
    throw classifyError(signal.aborted ? Object.assign(new Error("aborted"), { name: "AbortError" }) : err, modelId, timeoutMs);
  }

  const parsed = parseAIResponse(raw);
  if (!parsed) throw new ParseError(raw);
  return { ...parsed, raw, latencyMs: Date.now() - started };
}
