/**
 * Provider identity, shared by server and browser (no SDK imports here).
 *
 * Model ids are "<provider>/<provider model id>", e.g. "groq/openai/gpt-oss-120b"
 * or "google/models/gemini-3.5-flash". "local/..." ids are built-in engine bots
 * that never call an API. "human" is a person playing from the browser.
 * Anything else is routed through the Vercel AI Gateway.
 */
export type ProviderId = "groq" | "google" | "anthropic" | "openai" | "subq" | "local" | "human" | "gateway";

/** Providers whose keys users bring themselves. */
export const KEYED_PROVIDERS = ["groq", "google", "anthropic", "openai", "subq"] as const;
export type KeyedProvider = (typeof KEYED_PROVIDERS)[number];

export type ApiKeys = Partial<Record<KeyedProvider, string | null | undefined>>;

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  groq: "Groq",
  google: "Google",
  anthropic: "Anthropic",
  openai: "OpenAI",
  subq: "SubQ",
  local: "Built-in",
  human: "Human",
  gateway: "AI Gateway",
};

export function providerOf(modelId: string): ProviderId {
  const prefix = modelId.split("/")[0];
  if (prefix === "groq" || prefix === "google" || prefix === "anthropic" || prefix === "openai" || prefix === "subq" || prefix === "local" || prefix === "human") {
    return prefix;
  }
  return "gateway";
}

/** The single roster row that stands for whoever started the match from the browser. */
export const HUMAN_ID = "human";
export const isHuman = (modelId: string) => modelId === HUMAN_ID;

export function isKeyedProvider(p: ProviderId): p is KeyedProvider {
  return (KEYED_PROVIDERS as readonly string[]).includes(p);
}
