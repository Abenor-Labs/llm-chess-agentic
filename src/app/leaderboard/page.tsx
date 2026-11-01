"use client";

import { useEffect, useMemo, useState } from "react";
import { useLeaderboard } from "@/contexts/leaderboard-context";
import { usePageVisibility } from "@/hooks/use-page-visibility";
import { POLLING_INTERVALS } from "@/lib/config";
import { ProviderChip } from "@/components/badges";
import { cn } from "@/lib/utils";
import type { AccuracyStat } from "@/types/api";

function AiLeaderboard() {
  const { models, isLoading, error, refetch, isRefetching } = useLeaderboard();
  const [accuracy, setAccuracy] = useState<Record<string, AccuracyStat>>({});
  const [showAll, setShowAll] = useState(false);

  const visible = usePageVisibility();
  useEffect(() => {
    if (!visible) return;
    const load = () => {
      void refetch();
      fetch("/api/analytics/accuracy", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { models: [] }))
        .then((d: { models?: AccuracyStat[] }) => setAccuracy(Object.fromEntries((d.models ?? []).map((m) => [m.modelId, m]))))
        .catch(() => {});
    };
    load();
    // Live while the tab is visible: finished games show up without a manual refresh.
    const t = setInterval(load, POLLING_INTERVALS.GAMES_LIST_REFRESH_MS);
    return () => clearInterval(t);
  }, [refetch, visible]);

  const rows = useMemo(() => models.filter((m) => showAll || m.gamesPlayed > 0), [models, showAll]);

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Leaderboard</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Every finished game counts in Games and W/L/D. ELO only moves in <strong className="font-medium text-slate-700">rated</strong> games, where
            both sides used the same skill mode (K=32, start 1500); <strong className="font-medium text-slate-700">casual</strong>{" "}games with different
            modes don&apos;t, so a Grandmaster beating a Novice can&apos;t inflate a rating. Accuracy, ACPL and blunders come from the post-game
            Stockfish review. Updates live while this page is open.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="accent-slate-900" />
            Show unplayed models
          </label>
          <button
            onClick={() => refetch()}
            disabled={isRefetching}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
          >
            {isRefetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">
          Couldn&apos;t load ratings. The server may be starting up or offline.{" "}
          <button onClick={() => refetch()} className="font-semibold underline underline-offset-2">
            Try again
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[680px] text-sm" data-testid="leaderboard-table">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Model</th>
              <th className="px-4 py-3 text-right">ELO</th>
              <th className="px-4 py-3 text-right">Games</th>
              <th className="px-4 py-3 text-right">W / L / D</th>
              <th className="px-4 py-3 text-right">Score</th>
              <th className="px-4 py-3 text-right" title="Average Stockfish move accuracy">Accuracy</th>
              <th className="px-4 py-3 text-right" title="Average centipawn loss — lower is better">ACPL</th>
              <th className="px-4 py-3 text-right" title="Share of moves losing 3+ pawns">Blunders</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-slate-400">
                  No rated games yet. Play a match with the same mode on both sides.
                </td>
              </tr>
            )}
            {rows.map((m, i) => {
              const score = m.gamesPlayed ? ((m.wins + m.draws / 2) / m.gamesPlayed) * 100 : null;
              const acc = accuracy[m.id];
              return (
                <tr key={m.id} className={cn("hover:bg-slate-50", !m.active && "opacity-60")}>
                  <td className="px-4 py-3 tabular-nums text-slate-400">{i + 1}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{m.name}</span>
                      <ProviderChip modelId={m.id} className="hidden shrink-0 sm:inline-flex" />
                      {!m.active && <span className="text-[11px] text-slate-400">retired</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{m.elo}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{m.gamesPlayed}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <span className="text-emerald-700">{m.wins}</span> / <span className="text-rose-700">{m.losses}</span> /{" "}
                    <span className="text-slate-500">{m.draws}</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-600">{score === null ? "—" : `${score.toFixed(0)}%`}</td>
                  <td className="px-4 py-3 text-right tabular-nums" title={acc ? `${acc.moveCount} analyzed moves` : undefined}>
                    {acc ? `${acc.accuracy}%` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{acc ? acc.acpl : "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{acc ? `${acc.blunderRate}%` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type Tab = "ai" | "vs-ai" | "humans";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "ai", label: "AI models" },
  { id: "vs-ai", label: "Humans vs AI" },
  { id: "humans", label: "Human vs Human" },
];

export default function LeaderboardPage() {
  const [tab, setTab] = useState<Tab>("ai");
  return (
    <>
      <div className="mx-auto max-w-[1200px] px-3 pt-6 sm:px-6">
        <div role="tablist" aria-label="Leaderboards" className="inline-flex rounded-lg bg-slate-100 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                tab === t.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900",
              )}
              data-testid={`tab-${t.id}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === "ai" ? <AiLeaderboard /> : <HumanLeaderboard board={tab} />}
    </>
  );
}

interface HumanRow {
  userId: string;
  name: string;
  elo?: number;
  games?: number;
  gamesPlayed?: number;
  wins: number;
  losses: number;
  draws: number;
  avgOpponentElo?: number;
}

/** Players ranked by their Human vs AI record, or by the Human vs Human ladder. */
function HumanLeaderboard({ board }: { board: "vs-ai" | "humans" }) {
  const visible = usePageVisibility();
  const [rows, setRows] = useState<HumanRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const load = () =>
      fetch(`/api/leaderboard?board=${board}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => {
          if (cancelled) return;
          setRows(d.players ?? []);
          setFailed(false);
        })
        .catch(() => !cancelled && setFailed(true));
    void load();
    const t = setInterval(load, POLLING_INTERVALS.GAMES_LIST_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [board, visible]);

  const vsAi = board === "vs-ai";
  return (
    <div className="mx-auto max-w-[1200px] px-3 py-6 sm:px-6">
      <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{vsAi ? "Humans vs AI" : "Human vs Human"}</h1>
      <p className="mt-1 max-w-2xl text-sm text-slate-500">
        {vsAi
          ? "Players ranked by score against AI models (win 1, draw ½). AI ratings never change in these games."
          : "Rooms between two signed-in players. Everyone starts at 1500 ELO (K=32)."}{" "}
        Updates live while this page is open.
      </p>
      <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[520px] text-sm" data-testid={`leaderboard-${board}`}>
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs font-medium text-slate-500">
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Player</th>
              {!vsAi && <th className="px-4 py-3 text-right">ELO</th>}
              <th className="px-4 py-3 text-right">Games</th>
              <th className="px-4 py-3 text-right">W / L / D</th>
              <th className="px-4 py-3 text-right">Score</th>
              {vsAi && <th className="px-4 py-3 text-right">Avg AI rating</th>}
            </tr>
          </thead>
          <tbody>
            {rows?.map((r, i) => {
              const games = r.games ?? r.gamesPlayed ?? 0;
              return (
                <tr key={r.userId} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-3 tabular-nums text-slate-400">{i + 1}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{r.name}</td>
                  {!vsAi && <td className="px-4 py-3 text-right font-semibold tabular-nums">{r.elo}</td>}
                  <td className="px-4 py-3 text-right tabular-nums">{games}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {r.wins} / {r.losses} / {r.draws}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{games ? Math.round(((r.wins + r.draws / 2) / games) * 100) : 0}%</td>
                  {vsAi && <td className="px-4 py-3 text-right tabular-nums">{r.avgOpponentElo}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows === null && !failed && <p className="px-4 py-8 text-center text-sm text-slate-400">Loading…</p>}
        {failed && <p className="px-4 py-8 text-center text-sm text-rose-700">Couldn&apos;t load this board. It retries automatically.</p>}
        {rows?.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            {vsAi ? "No finished games against AI yet. Play one from the Play page." : "No finished rooms yet. Open one from the Play page."}
          </p>
        )}
      </div>
    </div>
  );
}
