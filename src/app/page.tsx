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
    fetch("/api/games?status=active&limit=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { games: [] }))
      .then((d) => !cancelled && setGameId(d.games?.[0]?.id ?? null))
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
    return <div className="flex min-h-[60vh] items-center justify-center text-slate-500">Loading…</div>;
  }
  if (gameId) return <GameView key={gameId} gameId={gameId} onNewGame={backToSetup} onGone={backToSetup} />;
  return <MatchSetup onStarted={setGameId} />;
}
