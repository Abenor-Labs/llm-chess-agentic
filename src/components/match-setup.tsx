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
import posthog from "posthog-js";
import { Board } from "./board";
import { useSessionUser } from "./user-menu";
import { RatedChip, SideDot } from "./badges";

type KeyState = "built-in" | "browser" | "server" | "missing";

const PROVIDER_ORDER: ProviderId[] = ["local", "groq", "google", "anthropic", "openai", "subq", "gateway"];

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
  const { models, isLoading, error: rosterError, refetch } = useLeaderboard();
  const { openSettings } = useSettings();
  const keyState = useKeyAvailability();
  const [whiteId, setWhiteId] = useState<string | null>(null);
  const [blackId, setBlackId] = useState<string | null>(null);
  const [whiteMode, setWhiteMode] = useState<SkillMode>("scholar");
  const [blackMode, setBlackMode] = useState<SkillMode>("scholar");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<{ message: string; provider?: KeyedProvider; running?: boolean } | null>(null);

  const playable = useMemo(() => models.filter((m) => m.active), [models]);
  const { user } = useSessionUser();
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
    if (!user) {
      window.location.assign("/auth/sign-in?next=/");
      return;
    }
    if (white.id === black.id && whiteMode === blackMode) {
      setError({ message: "Same model on both sides? Give each side a different skill mode." });
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
      posthog.capture("match_started", { game_id: body.gameId, white: white.id, black: black.id, white_mode: whiteMode, black_mode: blackMode });
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
    <div className="mx-auto grid w-full max-w-[1400px] gap-4 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)_minmax(0,1fr)]">
      <div className="lg:col-span-3">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Set up a match</h1>
        <p className="mt-1 text-sm text-slate-500">Pick a model for White and for Black, then start. Built-in engines need no API key.</p>
      </div>
      <SideSetup
        color="white"
        models={playable}
        loading={isLoading}
        rosterError={rosterError}
        onRetry={refetch}
        selected={whiteId}
        onSelect={fresh(setWhiteId)}
        mode={whiteMode}
        onMode={fresh(setWhiteMode)}
        disabledId={whiteMode === blackMode ? blackId : null}
        keyState={keyState}
      />

      <div className="order-last flex flex-col gap-4 lg:sticky lg:top-20 lg:order-none lg:self-start">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="hidden aspect-square w-full lg:block">
            <Board id="setup-preview" fen={STARTING_FEN} animate={false} />
          </div>
          <div className="space-y-3 lg:mt-4">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-sm" aria-live="polite">
              <span className="flex min-w-0 items-center gap-1.5">
                <SideDot color="white" />
                <span className={cn("truncate font-medium", !white && "text-slate-400")}>{white?.name ?? "Pick White"}</span>
              </span>
              <span className="text-xs text-slate-400">vs</span>
              <span className="flex min-w-0 items-center justify-end gap-1.5">
                <span className={cn("truncate font-medium", !black && "text-slate-400")}>{black?.name ?? "Pick Black"}</span>
                <SideDot color="black" />
              </span>
            </div>
            <button
              onClick={start}
              disabled={!white || !black || starting}
              className={cn(
                "w-full rounded-lg py-3 text-base font-semibold transition-colors",
                !white || !black || starting ? "cursor-not-allowed bg-slate-100 text-slate-400" : "bg-slate-900 text-white hover:bg-slate-700",
              )}
              data-testid="start-match"
            >
              {starting ? `${white?.name ?? "White"} is choosing the first move…` : user ? "Start match" : "Sign in to start a match"}
            </button>
            <p className="flex items-center justify-center gap-2 text-xs text-slate-500">
              <RatedChip rated={rated} />
              {rated ? "Counts toward the leaderboard." : "Modes differ, so ratings won't change."}
            </p>
            {!white || !black ? (
              <div className="border-t border-slate-100 pt-3 text-center">
                <button
                  onClick={quickEngines}
                  className="w-full rounded-lg px-3 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50"
                  data-testid="quick-engines"
                >
                  Or watch two built-in engines
                </button>
                <p className="mt-1.5 text-[11px] text-slate-400">Instant demo, no API key needed.</p>
              </div>
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
        onRetry={refetch}
        selected={blackId}
        onSelect={fresh(setBlackId)}
        mode={blackMode}
        onMode={fresh(setBlackMode)}
        disabledId={whiteMode === blackMode ? whiteId : null}
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
  onRetry,
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
  onRetry: () => void;
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
    const ready = (p: ProviderId) => keyState(p) !== "missing";
    // Providers you can play right now first; the rest keep their usual order.
    const order = [...PROVIDER_ORDER.filter(ready), ...PROVIDER_ORDER.filter((p) => !ready(p))];
    return order.map((p) => ({ provider: p, models: filtered.filter((m) => providerOf(m.id) === p) })).filter((g) => g.models.length);
  }, [models, query, keyState]);
  const modeInfo = SKILL_MODES.find((m) => m.id === mode)!;

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:max-h-[calc(100vh-7rem)]" data-testid={`setup-${color}`}>
      <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <SideDot color={color} />
        <h2 className="text-sm font-semibold capitalize text-slate-900">{color}</h2>
      </header>

      <div className="space-y-3 border-b border-slate-100 p-3">
        <div>
          <label htmlFor={`mode-${color}`} className="mb-1 block text-xs font-medium text-slate-600">
            Skill mode
          </label>
          <select
            id={`mode-${color}`}
            value={mode}
            onChange={(e) => onMode(e.target.value as SkillMode)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 hover:border-slate-300"
            aria-describedby={`mode-${color}-help`}
          >
            {SKILL_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <p id={`mode-${color}-help`} className="mt-1 text-xs text-slate-500">
            {modeInfo.description}
          </p>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search models…"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 hover:border-slate-300"
          aria-label={`Search ${color} models`}
        />
      </div>

      <div className="max-h-80 min-h-[12rem] flex-1 overflow-y-auto p-2 lg:max-h-none" role="listbox" aria-label={`${color} model`}>
        {loading && (
          <div className="space-y-2 p-1" aria-label="Loading models">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        )}
        {!loading && rosterError && (
          <div className="flex flex-col items-center gap-2 px-3 py-8 text-center" role="alert">
            <p className="text-sm text-slate-700">Couldn&apos;t load the models.</p>
            <p className="text-xs text-slate-500">The server may be starting up or offline.</p>
            <button onClick={onRetry} className="mt-1 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
              Try again
            </button>
          </div>
        )}
        {!loading && !rosterError && groups.length === 0 && (
          <p className="px-3 py-8 text-center text-sm text-slate-500">{query ? `No models match “${query.trim()}”.` : "No models available."}</p>
        )}
        {groups.map((g) => (
          <div key={g.provider} className="mb-2">
            <h3 className="px-2 pb-1 pt-2 text-[11px] font-medium text-slate-400">{PROVIDER_LABEL[g.provider]}</h3>
            <ul className="space-y-0.5">
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
                        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left ring-inset transition-colors",
                        isSelected ? "bg-slate-50 ring-2 ring-slate-900" : "hover:bg-slate-50",
                        isTaken && "cursor-not-allowed opacity-40 hover:bg-transparent",
                      )}
                      title={isTaken ? "Playing the other side at this skill mode. Change a skill mode to use it on both sides." : undefined}
                      data-testid={`pick-${color}-${m.id}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900">{m.name}</span>
                        <span className="block text-[11px] tabular-nums text-slate-500">
                          {m.elo} ELO · {m.wins}W {m.losses}L {m.draws}D
                        </span>
                      </span>
                      <KeyBadge state={state} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function KeyBadge({ state }: { state: KeyState }) {
  if (state === "built-in") return <span className="text-[11px] text-slate-400">no key</span>;
  if (state === "missing") return <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200">needs key</span>;
  return (
    <span className="text-[11px] font-medium text-emerald-700" title={state === "server" ? "Using the server's key" : "Using your key"}>
      key ✓
    </span>
  );
}
