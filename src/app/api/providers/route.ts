import { NextResponse } from "next/server";
import { KEYED_PROVIDERS, resolveKey, type KeyedProvider } from "@/lib/ai";

export const dynamic = "force-dynamic";

/**
 * Which providers have a server-side fallback key (self-hosting). Booleans
 * only — never the key — so the UI knows when a browser key is optional.
 */
export async function GET() {
  const serverKeys = Object.fromEntries(KEYED_PROVIDERS.map((p) => [p, Boolean(resolveKey(p))])) as Record<KeyedProvider, boolean>;
  return NextResponse.json({ serverKeys });
}
