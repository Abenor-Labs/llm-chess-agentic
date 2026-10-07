/**
 * Lists the model ids each provider currently serves, to keep the seed roster
 * (src/db/seed.ts) current. Uses keys from .env.local.
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const SOURCES: Array<{ name: string; env: string; url: (key: string) => string; headers: (key: string) => Record<string, string>; ids: (data: unknown) => string[] }> = [
  {
    name: "Groq",
    env: "GROQ_API_KEY",
    url: () => "https://api.groq.com/openai/v1/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    ids: (d) => ((d as { data?: Array<{ id: string }> }).data ?? []).map((m) => `groq/${m.id}`),
  },
  {
    name: "Gemini",
    env: "GEMINI_API_KEY",
    url: (key) => `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
    headers: () => ({}),
    ids: (d) => ((d as { models?: Array<{ name: string }> }).models ?? []).map((m) => `google/${m.name}`),
  },
  {
    name: "Anthropic",
    env: "ANTHROPIC_API_KEY",
    url: () => "https://api.anthropic.com/v1/models",
    headers: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
    ids: (d) => ((d as { data?: Array<{ id: string }> }).data ?? []).map((m) => `anthropic/${m.id}`),
  },
  {
    name: "OpenAI",
    env: "OPENAI_API_KEY",
    url: () => "https://api.openai.com/v1/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    ids: (d) => ((d as { data?: Array<{ id: string }> }).data ?? []).map((m) => `openai/${m.id}`),
  },
];

async function main() {
  for (const source of SOURCES) {
    const key = process.env[source.env];
    if (!key) {
      console.log(`${source.name}: skipped (${source.env} not set)`);
      continue;
    }
    const res = await fetch(source.url(key), { headers: source.headers(key) });
    if (!res.ok) {
      console.error(`${source.name}: HTTP ${res.status} ${await res.text()}`);
      continue;
    }
    console.log(`${source.name}:\n  ${source.ids(await res.json()).sort().join("\n  ")}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
