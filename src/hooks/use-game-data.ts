"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameDetailResponse } from "@/types/api";
import { usePageVisibility } from "@/hooks/use-page-visibility";
import { POLLING_INTERVALS } from "@/lib/config";

export interface UseGameDataResult {
  data: GameDetailResponse | null;
  loading: boolean;
  /** "not-found" when the game no longer exists (e.g. aborted before its first move). */
  error: "not-found" | "network" | null;
  refetch: () => Promise<void>;
}

/**
 * Polls one game. Fast while it is live and the tab is visible, slow when the
 * tab is hidden or the game is over, and not at all once a finished game has
 * been analyzed (nothing about it can change any more).
 */
export function useGameData(gameId: string | null): UseGameDataResult {
  // Results are tagged with the id they belong to, so switching games never
  // shows the previous game's data (no reset effect needed).
  const [result, setResult] = useState<{ id: string | null; data: GameDetailResponse | null; error: UseGameDataResult["error"] }>({
    id: gameId,
    data: null,
    error: null,
  });
  const current = result.id === gameId ? result : { id: gameId, data: null, error: null };
  const data = current.data;
  const error = current.error;
  const loading = Boolean(gameId) && !data && !error;
  const visible = usePageVisibility();
  const latestId = useRef(gameId);
  useEffect(() => {
    latestId.current = gameId;
  }, [gameId]);

  const fetchGame = useCallback(async () => {
    if (!gameId) return;
    try {
      const res = await fetch(`/api/games/${gameId}`, { cache: "no-store" });
      if (latestId.current !== gameId) return; // switched games mid-flight
      if (res.status === 404) {
        setResult({ id: gameId, data: null, error: "not-found" });
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as GameDetailResponse;
      if (latestId.current === gameId) setResult({ id: gameId, data: body, error: null });
    } catch {
      if (latestId.current === gameId) setResult((prev) => ({ id: gameId, data: prev.id === gameId ? prev.data : null, error: "network" }));
    }
  }, [gameId]);

  const status = data?.game.status;
  const settled = status === "complete" && data?.game.analyzed;
  useEffect(() => {
    if (!gameId || settled) return;
    void fetchGame();
    const ms = !visible
      ? POLLING_INTERVALS.WHEN_TAB_HIDDEN_MS
      : status === "complete"
        ? POLLING_INTERVALS.COMPLETED_GAME_REFRESH_MS
        : POLLING_INTERVALS.GAME_REFRESH_MS;
    const timer = setInterval(fetchGame, ms);
    return () => clearInterval(timer);
  }, [gameId, visible, status, settled, fetchGame]);

  return { data, loading, error, refetch: fetchGame };
}
