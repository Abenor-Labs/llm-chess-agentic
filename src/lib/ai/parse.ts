/**
 * Turns a model's raw text into { move, reasoning, plan }.
 *
 * Real responses are messy: reasoning models leak <think> blocks that contain
 * draft JSON, answers come wrapped in code fences or prose, reasoning strings
 * contain braces. The rule is: strip thinking traces, then take the LAST
 * well-formed JSON object that has a "move" — that is the final answer, not a
 * draft from earlier in the text.
 */

export interface ParsedReply {
  move: string;
  reasoning: string;
  plan: string | null;
}

const MAX_REASONING_CHARS = 1_200;
const MAX_PLAN_CHARS = 300;

/** Removes <think>/<thinking>/<reasoning> traces, including an unclosed trailing one. */
export function stripThinking(text: string): string {
  let out = text.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, "");
  // A closing tag with no opener (provider stripped the opener): drop everything before it.
  const orphanClose = out.search(/<\/(think|thinking|reasoning)>/i);
  if (orphanClose >= 0) out = out.slice(out.indexOf(">", orphanClose) + 1);
  // An opener that never closed means the answer was cut off inside thinking.
  const unclosed = out.search(/<(think|thinking|reasoning)>/i);
  if (unclosed >= 0) out = out.slice(0, unclosed);
  return out.trim();
}

/** Every balanced top-level {...} span, string-aware so braces inside strings don't confuse it. */
export function jsonObjects(text: string): string[] {
  const spans: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"' && depth > 0) inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0) spans.push(text.slice(start, i + 1));
    }
  }
  return spans;
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function asString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function fromObject(obj: unknown): ParsedReply | null {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  const move = asString(o.move) ?? asString(o.Move) ?? asString(o.san) ?? asString(o.best_move) ?? asString(o.bestMove);
  if (!move || move.length > 20) return null;
  const reasoning =
    asString(o.reasoning) ?? asString(o.reason) ?? asString(o.thought) ?? asString(o.analysis) ?? asString(o.explanation);
  const plan = asString(o.plan);
  return {
    move,
    reasoning: reasoning ? clip(reasoning, MAX_REASONING_CHARS) : "No reasoning provided",
    plan: plan ? clip(plan, MAX_PLAN_CHARS) : null,
  };
}

// SAN, castling or UCI — used only for the prose fallback.
const MOVE_TOKEN = String.raw`(O-O-O|O-O|0-0-0|0-0|[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|[a-h]x[a-h][1-8](?:=[QRBN])?[+#]?|[a-h][1-8](?:=[QRBN])?[+#]?|[a-h][1-8][a-h][1-8][qrbn]?)`;

const PROSE_PATTERNS = [
  new RegExp(String.raw`"move"\s*:\s*"([^"]{1,20})"`, "i"),
  new RegExp(String.raw`\b(?:final\s+)?(?:move|answer)\s*(?:is|:)\s*\**\s*${MOVE_TOKEN}`, "i"),
  new RegExp(String.raw`\b(?:i\s+(?:will\s+)?play|i'll\s+play|playing|play)\s+\**${MOVE_TOKEN}`, "i"),
];

export function parseAIResponse(raw: string | null | undefined): ParsedReply | null {
  if (!raw || !raw.trim()) return null;
  const text = stripThinking(raw);
  if (!text) return null;

  const objects = jsonObjects(text);
  for (let i = objects.length - 1; i >= 0; i--) {
    for (const candidate of [objects[i], objects[i].replace(/'/g, '"')]) {
      try {
        const parsed = fromObject(JSON.parse(candidate));
        if (parsed) return parsed;
      } catch {
        // try the next candidate
      }
    }
  }

  for (const pattern of PROSE_PATTERNS) {
    const m = text.match(pattern);
    if (m?.[1]) {
      const reasoning = text.match(/"reasoning"\s*:\s*"([^"]+)"/i)?.[1] ?? text;
      return { move: m[1].trim(), reasoning: clip(reasoning, MAX_REASONING_CHARS), plan: null };
    }
  }
  return null;
}
