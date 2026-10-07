"use client";

import { useEffect, useMemo, useState } from "react";
import { useLeaderboard } from "@/contexts/leaderboard-context";
import { ProviderChip } from "@/components/badges";
import { cn } from "@/lib/utils";
import type { AccuracyStat } from "@/types/api";

export default function LeaderboardPage() {
  const { models, isLoading, error, refetch, isRefetching } = useLeaderboard();
  const [accuracy, setAccuracy] = useState<Record<string, AccuracyStat>>({});
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    void refetch();
    fetch("/api/analytics/accuracy", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { models: [] }))
      .then((d: { models?: AccuracyStat[] }) => setAccuracy(Object.fromEntries((d.models ?? []).map((m) => [m.modelId, m]))))
      .catch(() => {});
  }, [refetch]);

  const rows = useMemo(() => models.filter((m) => showAll || m.gamesPlayed > 0), [models, showAll]);

  return (
    <div className="mx-auto max-w-[1200px] px-3 py-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Leaderboard</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            ELO (K=32, start 1500) from rated games — both sides on the same skill mode. Accuracy, ACPL and blunder rate come from the
            post-game Stockfish review. Built-in engines are fixed anchors for the pool.
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

      {error && <p className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[760px] text-sm" data-testid="leaderboard-table">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
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
                      <ProviderChip modelId={m.id} />
                      {!m.active && <span className="text-[11px] text-slate-400">retired</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums">{m.elo}</td>
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
