import { providerOf, type ProviderId } from "./provider-ids";

/** Visual identity per provider (Tailwind classes + a glyph). */
export const PROVIDER_STYLE: Record<ProviderId, { dot: string; chip: string; glyph: string }> = {
  groq: { dot: "bg-orange-500", chip: "bg-orange-50 text-orange-800 ring-orange-200", glyph: "⚡" },
  google: { dot: "bg-blue-500", chip: "bg-blue-50 text-blue-800 ring-blue-200", glyph: "◆" },
  anthropic: { dot: "bg-amber-600", chip: "bg-amber-50 text-amber-900 ring-amber-200", glyph: "✳" },
  openai: { dot: "bg-emerald-600", chip: "bg-emerald-50 text-emerald-800 ring-emerald-200", glyph: "◎" },
  local: { dot: "bg-slate-500", chip: "bg-slate-100 text-slate-700 ring-slate-200", glyph: "♞" },
  gateway: { dot: "bg-violet-500", chip: "bg-violet-50 text-violet-800 ring-violet-200", glyph: "✦" },
};

export function providerStyle(modelId: string) {
  return PROVIDER_STYLE[providerOf(modelId)];
}
