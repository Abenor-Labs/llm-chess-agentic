import { createGateway, type LanguageModel } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { AI_TIMEOUTS, OUTPUT_TOKENS } from "../config";
import type { Effort } from "../modes";
import { APIKeyError } from "../errors";

import {
  providerOf,
  PROVIDER_LABEL,
  type ApiKeys,
  type KeyedProvider,
  type ProviderId,
} from "../provider-ids";

export { providerOf, isKeyedProvider, PROVIDER_LABEL, KEYED_PROVIDERS } from "../provider-ids";
export type { ApiKeys, KeyedProvider, ProviderId } from "../provider-ids";

const ENV_KEY: Record<KeyedProvider, string> = {
  groq: "GROQ_API_KEY",
  google: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

/** The id the provider's own API expects (prefix stripped; gateway ids pass through). */
export function providerModelName(modelId: string): string {
  return providerOf(modelId) === "gateway" ? modelId : modelId.slice(modelId.indexOf("/") + 1);
}

/** A per-match key wins; the server env is a fallback for self-hosting. */
export function resolveKey(provider: KeyedProvider, keys?: ApiKeys): string | undefined {
  const own = keys?.[provider]?.trim();
  if (own) return own;
  return process.env[ENV_KEY[provider]]?.trim() || undefined;
}

export function timeoutFor(provider: ProviderId, effort: Effort): number {
  if (provider === "local") return AI_TIMEOUTS.MAX_MS;
  const base = AI_TIMEOUTS.BASE_MS[provider];
  return Math.min(AI_TIMEOUTS.MAX_MS, Math.round(base * AI_TIMEOUTS.EFFORT_MULTIPLIER[effort]));
}

type ProviderOptions = Record<string, Record<string, unknown>>;

export interface CallPlan {
  provider: ProviderId;
  model: LanguageModel;
  /** Omitted for models that reject a custom temperature while thinking. */
  temperature?: number;
  maxOutputTokens: number;
  /** Reasoning-effort knobs. Dropped on a retry if the provider rejects them. */
  providerOptions?: ProviderOptions;
  timeoutMs: number;
}

/**
 * Maps a skill mode's effort onto each provider's reasoning controls:
 * Groq reasoning_effort (gpt-oss / qwen), Gemini thinkingLevel (3.x) or
 * thinkingBudget (2.5), Claude extended thinking, OpenAI reasoningEffort.
 */
export function effortOptions(modelId: string, effort: Effort): ProviderOptions | undefined {
  const provider = providerOf(modelId);
  const name = providerModelName(modelId).toLowerCase();

  if (provider === "groq") {
    if (name.includes("gpt-oss")) {
      return { groq: { reasoningEffort: effort === "high" ? "high" : effort === "medium" ? "medium" : "low" } };
    }
    if (name.includes("qwen")) {
      // Qwen thinks in-band; hide the trace so the answer stays parseable.
      return {
        groq: {
          reasoningEffort: effort === "medium" || effort === "high" ? "default" : "none",
          reasoningFormat: "hidden",
        },
      };
    }
    return undefined;
  }

  if (provider === "google") {
    if (/gemini-([3-9]|\d{2,})/.test(name)) {
      return { google: { thinkingConfig: { thinkingLevel: effort === "high" ? "high" : "low" } } };
    }
    if (name.includes("gemini-2.5")) {
      const isPro = name.includes("pro"); // 2.5 Pro cannot disable thinking (min 128)
      const budget = { minimal: isPro ? 128 : 0, low: 1_024, medium: 2_048, high: 8_192 }[effort];
      return { google: { thinkingConfig: { thinkingBudget: budget } } };
    }
    return undefined;
  }

  if (provider === "anthropic") {
    if (effort === "medium") return { anthropic: { thinking: { type: "enabled", budgetTokens: 1_024 } } };
    if (effort === "high") return { anthropic: { thinking: { type: "enabled", budgetTokens: 4_096 } } };
    return undefined;
  }

  if (provider === "openai") {
    // "minimal" isn't accepted by every GPT-5.x release; "low" is universal.
    return { openai: { reasoningEffort: effort === "high" ? "high" : effort === "medium" ? "medium" : "low" } };
  }

  return undefined;
}

function thinkingBudget(options: ProviderOptions | undefined): number {
  const thinking = options?.anthropic?.thinking as { budgetTokens?: number } | undefined;
  return thinking?.budgetTokens ?? 0;
}

/** Builds everything needed for one model call. Throws if a required key is absent. */
export function planCall(
  modelId: string,
  opts: { effort: Effort; temperature: number; keys?: ApiKeys },
): CallPlan {
  const provider = providerOf(modelId);
  if (provider === "local") throw new Error(`${modelId} is a built-in engine, not a language model`);
  const name = providerModelName(modelId);
  const providerOptions = effortOptions(modelId, opts.effort);
  const timeoutMs = timeoutFor(provider, opts.effort);
  const budget = thinkingBudget(providerOptions);

  let model: LanguageModel;
  if (provider === "gateway") {
    model = createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY })(name);
  } else {
    const apiKey = resolveKey(provider, opts.keys);
    if (!apiKey) throw new APIKeyError(PROVIDER_LABEL[provider]);
    model =
      provider === "groq"
        ? createGroq({ apiKey })(name)
        : provider === "google"
          ? createGoogleGenerativeAI({ apiKey })(name)
          : provider === "anthropic"
            ? createAnthropic({ apiKey })(name)
            : createOpenAI({ apiKey })(name);
  }

  return {
    provider,
    model,
    // Extended thinking requires the default temperature.
    temperature: budget > 0 ? undefined : opts.temperature,
    maxOutputTokens: OUTPUT_TOKENS[opts.effort] + budget,
    providerOptions,
    timeoutMs,
  };
}
