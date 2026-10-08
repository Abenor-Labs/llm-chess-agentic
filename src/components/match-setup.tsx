"use client";

import { useEffect, useMemo, useState } from "react";
import type { Model } from "@/db/schema";
import { useLeaderboard } from "@/contexts/leaderboard-context";
import { useSettings } from "@/contexts/settings-context";
import { SKILL_MODES, isRatedPairing, type SkillMode } from "@/lib/modes";
import { KEYED_PROVIDERS, PROVIDER_LABEL, isKeyedProvider, providerOf, type KeyedProvider, type ProviderId } from "@/lib/provider-ids";
import { KEYS_CHANGED_EVENT, readAllKeys } from "@/lib/client-keys";
import { STARTING_FEN } from "@/lib/chess";
import { cn } from "@/lib/utils";
import { Board } from "./board";
import { ProviderChip, RatedChip, SideDot } from "./badges";

type KeyState = "built-in" | "browser" | "server" | "missing";

const PROVIDER_ORDER: ProviderId[] = ["local", "groq", "google", "anthropic", "openai", "gateway"];

/** Which keys are available: this browser's, or the server's fallback. */
function useKeyAvailability() {
  const [browser, setBrowser] = useState<Partial<Record<KeyedProvider, boolean>>>({});
  const [server, setServer] = useState<Partial<Record<KeyedProvider, boolean>>>({});
  useEffect(() => {
    const read = () => {
      const keys = readAllKeys();
      setBrowser(Object.fromEntries(KEYED_PROVIDERS.map((p) => [p, Boolean(keys[p])])));
    };
    read();
    window.addEventListener(KEYS_CHANGED_EVENT, read);
    window.addEventListener("storage", read);
    fetch("/api/providers")
      .then((r) => (r.ok ? r.json() : { serverKeys: {} }))
      .then((d: { serverKeys?: Record<KeyedProvider, boolean> }) => setServer(d.serverKeys ?? {}))
      .catch(() => {});
    return () => {
      window.removeEventListener(KEYS_CHANGED_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);
  return (p: ProviderId): KeyState => {
    if (!isKeyedProvider(p)) return "built-in";
    if (browser[p]) return "browser";
    if (server[p]) return "server";
    return "missing";
  };
}

export function MatchSetup({ onStarted }: { onStarted: (gameId: string) => void }) {
  const { models, isLoading, error: rosterError } = useLeaderboard();
  const { openSettings } = useSettings();
  const keyState = useKeyAvailability();
  const [whiteId, setWhiteId] = useState<string | null>(null);
  const [blackId, setBlackId] = useState<string | null>(null);
  const [whiteMode, setWhiteMode] = useState<SkillMode>("scholar");
  const [blackMode, setBlackMode] = useState<SkillMode>("scholar");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<{ message: string; provider?: KeyedProvider; running?: boolean } | null>(null);

  const playable = useMemo(() => models.filter((m) => m.active), [models]);
  const white = playable.find((m) => m.id === whiteId) ?? null;
  const black = playable.find((m) => m.id === blackId) ?? null;
  const missing = [white, black]
    .filter((m): m is Model => Boolean(m))
    .map((m) => providerOf(m.id))
    .filter((p, i, all): p is KeyedProvider => isKeyedProvider(p) && all.indexOf(p) === i)
    .filter((p) => keyState(p) === "missing");

  // Any new choice is a fresh attempt: drop the previous error with it.
  const fresh = <T,>(set: (v: T) => void) => (v: T) => {
    setError(null);
    set(v);
  };

  function quickEngines() {
    setError(null);
    setWhiteId("local/engine-2");
    setBlackId("local/greedy");
  }

  async function start() {
    if (!white || !black) return;
    if (white.id === black.id) {
      setError({ message: "Pick two different models — a model can't play itself." });
      return;
    }
    if (missing.length) {
      setError({ message: `Add your ${missing.map((p) => PROVIDER_LABEL[p]).join(" and ")} API key first.`, provider: missing[0] });
      openSettings();
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const all = readAllKeys();
      const needed = new Set([providerOf(white.id), providerOf(black.id)]);
      const keys = Object.fromEntries(KEYED_PROVIDERS.filter((p) => needed.has(p) && all[p]).map((p) => [p, all[p]]));
      const res = await fetch("/api/games/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelIds: [white.id, black.id], whiteMode, blackMode, keys }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ message: body.error ?? "Failed to start the match", provider: body.provider, running: res.status === 409 });
        return;
      }
      onStarted(body.gameId);
    } catch {
      setError({ message: "Couldn't reach the server. Check your connection and try again." });
    } finally {
      setStarting(false);
    }
  }

  async function watchRunning() {
    const res = await fetch("/api/games?status=active&limit=1").catch(() => null);
    const id = res && res.ok ? (await res.json()).games?.[0]?.id : null;
    if (id) onStarted(id);
  }

  const rated = isRatedPairing(whiteMode, blackMode);

  return (
    <div className="mx-auto grid w-full max-w-[1400px] gap-4 px-3 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)_minmax(0,1fr)]">
      <SideSetup
        color="white"
        models={playable}
        loading={isLoading}
        rosterError={rosterError}
        selected={whiteId}
        onSelect={fresh(setWhiteId)}
        mode={whiteMode}
        onMode={fresh(setWhiteMode)}
        disabledId={blackId}
        keyState={keyState}
      />

      <div className="flex flex-col gap-4 lg:order-none">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="aspect-square w-full">
            <Board id="setup-preview" fen={STARTING_FEN} animate={false} />
          </div>
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-1.5">
                <SideDot color="white" />
                <span className="truncate font-medium">{white?.name ?? "White"}</span>
              </span>
              <span className="text-slate-400">vs</span>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-medium">{black?.name ?? "Black"}</span>
                <SideDot color="black" />
              </span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <RatedChip rated={rated} />
              {!rated && <span className="text-[11px] text-slate-500">Use the same mode on both sides for a rated game.</span>}
            </div>
            <button
              onClick={start}
              disabled={!white || !black || starting}
              className={cn(
                "w-full rounded-xl py-3 text-base font-bold transition",
                !white || !black || starting ? "cursor-not-allowed bg-slate-200 text-slate-500" : "bg-slate-900 text-white shadow hover:bg-slate-700 active:scale-[0.99]",
              )}
              data-testid="start-match"
            >
              {starting ? `${white?.name ?? "White"} is choosing the first move…` : "Start match"}
            </button>
            {!white || !black ? (
              <p className="text-center text-xs text-slate-500">
                Choose a model for each side, or{" "}
                <button onClick={quickEngines} className="font-medium text-slate-900 underline underline-offset-2" data-testid="quick-engines">
                  watch two built-in engines
                </button>{" "}
                (no API key needed).
              </p>
            ) : missing.length > 0 ? (
              <p className="text-center text-xs text-amber-700">
                Needs your {missing.map((p) => PROVIDER_LABEL[p]).join(" + ")} key —{" "}
                <button onClick={openSettings} className="font-semibold underline underline-offset-2">
                  add it in Settings
                </button>
                .
              </p>
            ) : null}
            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert" data-testid="start-error">
                {error.message}
                {error.provider && (
                  <button onClick={openSettings} className="ml-1 font-semibold underline underline-offset-2">
                    Open Settings
                  </button>
                )}
                {error.running && (
                  <button onClick={watchRunning} className="ml-1 font-semibold underline underline-offset-2">
                    Watch it
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <SideSetup
        color="black"
        models={playable}
        loading={isLoading}
        rosterError={rosterError}
        selected={blackId}
        onSelect={fresh(setBlackId)}
        mode={blackMode}
        onMode={fresh(setBlackMode)}
        disabledId={whiteId}
        keyState={keyState}
      />
    </div>
  );
}

function SideSetup({
  color,
  models,
  loading,
  rosterError,
  selected,
  onSelect,
  mode,
  onMode,
  disabledId,
  keyState,
}: {
  color: "white" | "black";
  models: Model[];
  loading: boolean;
  rosterError: string | null;
  selected: string | null;
  onSelect: (id: string) => void;
  mode: SkillMode;
  onMode: (m: SkillMode) => void;
  disabledId: string | null;
  keyState: (provider: ProviderId) => KeyState;
}) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = models.filter((m) => !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q));
    return PROVIDER_ORDER.map((p) => ({ provider: p, models: filtered.filter((m) => providerOf(m.id) === p) })).filter((g) => g.models.length);
  }, [models, query]);
  const modeInfo = SKILL_MODES.find((m) => m.id === mode)!;

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:max-h-[calc(100vh-7rem)]" data-testid={`setup-${color}`}>
      <header className={cn("flex items-center gap-2 px-4 py-3", color === "white" ? "bg-slate-50" : "bg-slate-900 text-white")}>
        <SideDot color={color} className={color === "black" ? "ring-white/70" : undefined} />
        <h2 className="text-sm font-bold uppercase tracking-wider">{color}</h2>
      </header>

      <div className="border-b border-slate-100 p-3">
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Skill mode</label>
        <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label={`${color} skill mode`}>
          {SKILL_MODES.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={m.id === mode}
              onClick={() => onMode(m.id)}
              className={cn(
                "rounded-lg px-2 py-1.5 text-xs font-medium transition",
                m.id === mode ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">{modeInfo.description}</p>
      </div>

      <div className="p-3 pb-0">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search models…"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          aria-label={`Search ${color} models`}
        />
      </div>

      <div className="min-h-[12rem] flex-1 overflow-y-auto p-3" role="listbox" aria-label={`${color} model`}>
        {loading && <p className="text-sm text-slate-400">Loading models…</p>}
        {rosterError && <p className="text-sm text-rose-600">Couldn&apos;t load models: {rosterError}</p>}
        {!loading && groups.length === 0 && <p className="text-sm text-slate-400">No models match.</p>}
        {groups.map((g) => (
          <div key={g.provider} className="mb-3">
            <h3 className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{PROVIDER_LABEL[g.provider]}</h3>
            <ul className="space-y-1">
              {g.models.map((m) => {
                const state = keyState(providerOf(m.id));
                const isSelected = m.id === selected;
                const isTaken = m.id === disabledId;
                return (
                  <li key={m.id}>
                    <button
                      role="option"
                      aria-selected={isSelected}
                      disabled={isTaken}
                      onClick={() => onSelect(m.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition",
                        isSelected ? "bg-slate-900 text-white" : "hover:bg-slate-100",
                        isTaken && "cursor-not-allowed opacity-40",
                      )}
                      data-testid={`pick-${color}-${m.id}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{m.name}</span>
                        <span className={cn("block text-[11px] tabular-nums", isSelected ? "text-slate-300" : "text-slate-500")}>
                          {m.elo} ELO · {m.wins}W {m.losses}L {m.draws}D
                        </span>
                      </span>
                      <KeyBadge state={state} inverted={isSelected} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {selected && (
        <footer className="border-t border-slate-100 px-4 py-2">
          <ProviderChip modelId={selected} />
        </footer>
      )}
    </section>
  );
}

function KeyBadge({ state, inverted }: { state: KeyState; inverted: boolean }) {
  if (state === "built-in") return <span className={cn("text-[10px] font-medium", inverted ? "text-slate-300" : "text-slate-400")}>no key</span>;
  if (state === "missing") return <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">needs key</span>;
  return (
    <span className={cn("text-[10px] font-medium", inverted ? "text-emerald-300" : "text-emerald-600")} title={state === "server" ? "Using the server's key" : "Using your key"}>
      key ✓
    </span>
  );
}
