"use client";

import { KEYED_PROVIDERS, type ApiKeys, type KeyedProvider } from "./provider-ids";

/**
 * Bring-your-own keys live only in this browser and are sent with the start
 * request of each match that needs them. Storage keys are kept compatible with
 * earlier versions ("groqApiKey", "geminiApiKey").
 */
const STORAGE_KEY: Record<KeyedProvider, string> = {
  groq: "groqApiKey",
  google: "geminiApiKey",
  anthropic: "anthropicApiKey",
  openai: "openaiApiKey",
};

export const KEY_HELP: Record<KeyedProvider, { label: string; placeholder: string; url: string; host: string }> = {
  groq: { label: "Groq", placeholder: "gsk_…", url: "https://console.groq.com/keys", host: "console.groq.com" },
  google: { label: "Google Gemini", placeholder: "AIza…", url: "https://aistudio.google.com/apikey", host: "aistudio.google.com" },
  anthropic: { label: "Anthropic", placeholder: "sk-ant-…", url: "https://console.anthropic.com/settings/keys", host: "console.anthropic.com" },
  openai: { label: "OpenAI", placeholder: "sk-…", url: "https://platform.openai.com/api-keys", host: "platform.openai.com" },
};

export const KEYS_CHANGED_EVENT = "arena:keys-changed";

export function readKey(provider: KeyedProvider): string {
  try {
    return localStorage.getItem(STORAGE_KEY[provider])?.trim() ?? "";
  } catch {
    return "";
  }
}

export function readAllKeys(): ApiKeys {
  return Object.fromEntries(KEYED_PROVIDERS.map((p) => [p, readKey(p) || undefined]));
}

export function writeKey(provider: KeyedProvider, value: string): void {
  try {
    const trimmed = value.trim();
    if (trimmed) localStorage.setItem(STORAGE_KEY[provider], trimmed);
    else localStorage.removeItem(STORAGE_KEY[provider]);
    window.dispatchEvent(new Event(KEYS_CHANGED_EVENT));
  } catch {
    // storage unavailable (private mode); the key simply isn't remembered
  }
}

/** "gsk_…9f2c" — enough to recognise a key without showing it. */
export function maskKey(key: string): string {
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
