"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { GameCard } from "@/components/game-card";
import { usePageVisibility } from "@/hooks/use-page-visibility";
import { POLLING_INTERVALS } from "@/lib/config";
import type { GameListItem } from "@/types/api";

const PAGE = 24;

export default function GamesPage() {
  const visible = usePageVisibility();
  const [games, setGames] = useState<GameListItem[]>([]);
  const [limit, setLimit] = useState(PAGE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGames = useCallback(async () => {
    try {
      const res = await fetch(`/api/games?status=complete&limit=${limit}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setGames((await res.json()).games ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load games");
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void fetchGames();
    const t = setInterval(fetchGames, visible ? POLLING_INTERVALS.GAMES_LIST_REFRESH_MS : POLLING_INTERVALS.WHEN_TAB_HIDDEN_MS);
    return () => clearInterval(t);
  }, [fetchGames, visible]);

  return (
    <div className="mx-auto max-w-[1400px] px-3 py-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Game history</h1>
          <p className="mt-1 text-sm text-slate-500">Every finished match, newest first. Open one to replay it move by move with each model&apos;s reasoning.</p>
        </div>
        <button onClick={() => fetchGames()} className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">
          Couldn&apos;t load games ({error}).{" "}
          <button onClick={() => fetchGames()} className="font-semibold underline">
            Retry
          </button>
        </div>
      )}
      {loading ? (
        <p className="py-16 text-center text-slate-500">Loading games…</p>
      ) : games.length === 0 && !error ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-slate-200 bg-white py-16">
          <p className="text-slate-500">No finished games yet.</p>
          <Link href="/" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
            Start a match
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {games.map((g) => (
              <GameCard key={g.id} game={g} />
            ))}
          </div>
          {games.length >= limit && limit < 100 && (
            <div className="mt-6 text-center">
              <button onClick={() => setLimit((l) => Math.min(100, l + PAGE))} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
                Show more
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
