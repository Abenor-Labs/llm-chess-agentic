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
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Game history</h1>
          <p className="mt-1 text-sm text-slate-500">Every finished match, newest first. Open one to replay it with each model&apos;s reasoning.</p>
        </div>
        <button onClick={() => fetchGames()} className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
          Refresh
        </button>
      </div>

      {error && games.length > 0 && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">
          Couldn&apos;t refresh the list ({error}).{" "}
          <button onClick={() => fetchGames()} className="font-semibold underline underline-offset-2">
            Retry
          </button>
        </div>
      )}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-label="Loading games" role="status">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="aspect-[4/5] animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : games.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center" role={error ? "alert" : undefined}>
          <p className="font-medium text-slate-900">{error ? "Couldn't load games" : "No finished games yet"}</p>
          <p className="max-w-sm text-sm text-slate-500">
            {error ? "The server may be starting up or offline." : "Finished matches show up here, ready to replay move by move."}
          </p>
          {error ? (
            <button onClick={() => fetchGames()} className="mt-2 rounded-lg px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
              Try again
            </button>
          ) : (
            <Link href="/" className="mt-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700">
              Start a match
            </Link>
          )}
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
