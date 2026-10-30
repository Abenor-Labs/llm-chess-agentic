import { generateText, APICallError } from "ai";
import { Chess } from "chess.js";
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
import { planCall, providerOf, providerModelName, resolveKey, PROVIDER_LABEL, SUBQ_BASE_URL, type ApiKeys, type CallPlan } from "./providers";
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

  // A valid key without access to this model (e.g. SubQ early-access models).
  if (/model_not_allowed|not permitted for this api key/.test(text)) return new ModelUnavailableError(modelId, message.slice(0, 200));
  // 402 = out of credits (SubQ): fatal like a bad key, retrying can't help.
  if (status === 401 || status === 402 || status === 403 || /invalid api key|incorrect api key|api key not valid|unauthori[sz]ed|permission denied/.test(text)) {
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
  // Anthropic refusals arrive as an empty "content-filter" finish; say so instead of a blank parse error.
  if (!result.text.trim() && result.finishReason === "content-filter") {
    throw new ProviderError(PROVIDER_LABEL[plan.provider], "the model refused this request (safety filter)");
  }
  return result.text;
}

/**
 * SubQ Snap is a decision model: instead of writing a move it picks one option
 * from a list, so it is offered every legal move (keys UCI, descriptions SAN).
 */
async function decideMove(name: string, apiKey: string, ctx: PromptContext, signal: AbortSignal): Promise<Omit<MoveReply, "latencyMs">> {
  const legal = new Chess(ctx.fen).moves({ verbose: true });
  if (legal.length === 1) {
    return { move: legal[0].san, reasoning: "The only legal move.", plan: null, raw: "" };
  }
  const criteria = Object.fromEntries(legal.map((m) => [m.lan, m.san]));
  const url = `${SUBQ_BASE_URL}/systemone`;
  const requestBody = {
    model: name,
    state: buildPrompt(ctx),
    questions: {
      move: { type: "choice", instructions: `Choose the strongest move for ${ctx.color}. Calculate concrete variations.`, criteria },
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    signal,
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new APICallError({
      message: `SubQ ${res.status}: ${raw.slice(0, 200)}`,
      url,
      requestBodyValues: requestBody,
      statusCode: res.status,
      responseHeaders: Object.fromEntries(res.headers),
      responseBody: raw,
    });
  }
  let answer: { choice?: string; confidence?: number; probabilities?: Record<string, number> } | undefined;
  try {
    answer = JSON.parse(raw)?.answers?.move;
  } catch {
    throw new ParseError(raw);
  }
  const san = answer?.choice ? criteria[answer.choice] : undefined;
  if (!san) throw new ParseError(raw);
  const top = Object.entries(answer?.probabilities ?? {})
    .filter(([uci]) => criteria[uci])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([uci, p]) => `${criteria[uci]} ${Math.round(p * 100)}%`);
  const confidence = typeof answer?.confidence === "number" ? ` with ${Math.round(answer.confidence * 100)}% confidence` : "";
  return {
    move: san,
    reasoning: `Chose ${san}${confidence}${top.length ? ` (top options: ${top.join(", ")})` : ""}.`,
    plan: null,
    raw,
  };
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

  if (plan.provider === "subq" && providerModelName(modelId).startsWith("subq-snap")) {
    try {
      const reply = await decideMove(providerModelName(modelId), resolveKey("subq", opts.keys)!, ctx, signal);
      return { ...reply, latencyMs: Date.now() - started };
    } catch (err) {
      throw classifyError(signal.aborted ? Object.assign(new Error("aborted"), { name: "AbortError" }) : err, modelId, timeoutMs);
    }
  }

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
