"use client";

/**
 * Move sounds synthesized with Web Audio. One shared AudioContext (browsers cap
 * how many a page may create), and settings are read from storage on every
 * play, so toggling sound in Settings takes effect immediately everywhere.
 */

export interface SoundSettings {
  enabled: boolean;
  /** 0..1 */
  volume: number;
}

export type SoundKind = "move" | "capture" | "check" | "checkmate" | "castle" | "promotion";

const STORAGE_KEY = "chess-sound-settings";
const DEFAULTS: SoundSettings = { enabled: true, volume: 0.5 };

let context: AudioContext | null = null;

export function getSoundSettings(): SoundSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<SoundSettings>;
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULTS.enabled,
      volume: typeof parsed.volume === "number" ? Math.min(1, Math.max(0, parsed.volume)) : DEFAULTS.volume,
    };
  } catch {
    return DEFAULTS;
  }
}

export function setSoundSettings(update: Partial<SoundSettings>): SoundSettings {
  const next = { ...getSoundSettings(), ...update };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable; settings last for this page only
  }
  return next;
}

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context ??= new Ctor();
    if (context.state === "suspended") void context.resume();
    return context;
  } catch {
    return null;
  }
}

function tone(ctx: AudioContext, frequency: number, duration: number, volume: number, delay = 0, type: OscillatorType = "sine") {
  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

const RECIPES: Record<SoundKind, Array<[freq: number, dur: number, gain: number, delay: number, type?: OscillatorType]>> = {
  move: [[800, 0.05, 0.3, 0]],
  capture: [[600, 0.08, 0.35, 0, "triangle"], [400, 0.1, 0.3, 0.05, "triangle"]],
  check: [[600, 0.15, 0.45, 0], [800, 0.15, 0.45, 0.1]],
  checkmate: [[523, 0.2, 0.55, 0], [440, 0.2, 0.55, 0.1], [349, 0.35, 0.6, 0.2]],
  castle: [[400, 0.12, 0.35, 0], [500, 0.12, 0.35, 0.06]],
  promotion: [[523, 0.1, 0.4, 0], [659, 0.1, 0.4, 0.08], [784, 0.15, 0.45, 0.16]],
};

export function playSound(kind: SoundKind, force = false): void {
  const settings = getSoundSettings();
  if (!settings.enabled && !force) return;
  const ctx = audio();
  if (!ctx) return;
  for (const [freq, dur, gain, delay, type] of RECIPES[kind]) tone(ctx, freq, dur, gain * settings.volume, delay, type);
}

/** Which sound a SAN move makes. */
export function soundForSan(san: string): SoundKind {
  if (san.includes("#")) return "checkmate";
  if (san.includes("+")) return "check";
  if (san.startsWith("O-O")) return "castle";
  if (san.includes("=")) return "promotion";
  if (san.includes("x")) return "capture";
  return "move";
}
