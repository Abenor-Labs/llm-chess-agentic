"use client";

import { useCallback, useEffect, useState } from "react";
import { GameView } from "@/components/game-view";
import { MatchSetup } from "@/components/match-setup";
import { useLeaderboard } from "@/contexts/leaderboard-context";

/** Home: the live game if one is running, otherwise match setup. */
export default function Home() {
  // undefined = still checking for a running game
  const [gameId, setGameId] = useState<string | null | undefined>(undefined);
  const { refetch } = useLeaderboard();

  useEffect(() => {
    let cancelled = false;
    // Your own live human game comes first, then the AI arena's live game.
    const first = (url: string) =>
      fetch(url, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { games: [] }))
        .then((d) => (d.games?.[0]?.id as string | undefined) ?? null);
    first("/api/games?status=active&limit=1&mine=1")
      .then((mine) => mine ?? first("/api/games?status=active&limit=1&arena=1"))
      .then((id) => !cancelled && setGameId(id))
      .catch(() => !cancelled && setGameId(null));
    return () => {
      cancelled = true;
    };
  }, []);

  const backToSetup = useCallback(() => {
    setGameId(null);
    void refetch(); // ratings may have changed
  }, [refetch]);

  if (gameId === undefined) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-slate-500" role="status">
        Loading…
      </div>
    );
  }
  if (gameId) return <GameView key={gameId} gameId={gameId} onNewGame={backToSetup} onGone={backToSetup} />;
  return <MatchSetup onStarted={setGameId} />;
}
