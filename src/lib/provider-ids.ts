/**
 * Provider identity, shared by server and browser (no SDK imports here).
 *
 * Model ids are "<provider>/<provider model id>", e.g. "groq/openai/gpt-oss-120b"
 * or "google/models/gemini-3.5-flash". "local/..." ids are built-in engine bots
 * that never call an API. Anything else is routed through the Vercel AI Gateway.
 */
export type ProviderId = "groq" | "google" | "anthropic" | "openai" | "local" | "gateway";

/** Providers whose keys users bring themselves. */
export const KEYED_PROVIDERS = ["groq", "google", "anthropic", "openai"] as const;
export type KeyedProvider = (typeof KEYED_PROVIDERS)[number];

export type ApiKeys = Partial<Record<KeyedProvider, string | null | undefined>>;

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  groq: "Groq",
  google: "Google",
  anthropic: "Anthropic",
  openai: "OpenAI",
  local: "Built-in",
  gateway: "AI Gateway",
};

export function providerOf(modelId: string): ProviderId {
  const prefix = modelId.split("/")[0];
  if (prefix === "groq" || prefix === "google" || prefix === "anthropic" || prefix === "openai" || prefix === "local") {
    return prefix;
  }
  return "gateway";
}

export function isKeyedProvider(p: ProviderId): p is KeyedProvider {
  return (KEYED_PROVIDERS as readonly string[]).includes(p);
}
