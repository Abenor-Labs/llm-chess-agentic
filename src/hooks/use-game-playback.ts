"use client";

import { useCallback, useEffect, useState } from "react";
import { MOVE_PLAYBACK_MS } from "@/lib/config";
import type { Move } from "@/db/schema";

export interface GamePlayback {
  /** How many moves are currently shown on the board. */
  shownCount: number;
  /** True when the board has caught up to every move produced so far. */
  caughtUp: boolean;
  /** Reveal everything at once (the viewer pressed End). */
  skipToEnd: () => void;
}

const MIN_PLAYBACK_MS = 120;

/** Delay before revealing the next move, given how many are still queued. */
export function playbackDelay(backlog: number): number {
  if (backlog <= 1) return MOVE_PLAYBACK_MS;
  return Math.max(MIN_PLAYBACK_MS, Math.round(MOVE_PLAYBACK_MS / Math.sqrt(backlog)));
}

/**
 * Paces a live game so moves appear one at a time.
 *
 * The server plays moves in bursts (many per tick), which would make the board
 * jump several moves per poll. This walks a "shown" cursor forward one move
 * at a time (faster when far behind) toward the latest move, so react-chessboard animates
 * each move individually. When the board is already current it simply waits, so
 * a live game runs at the AI's own pace, not artificially fast.
 *
 * On a new game the cursor jumps straight to the current position (no replay of
 * history); only moves that arrive afterwards are animated.
 */
export function useGamePlayback(moves: Move[] | undefined, gameId: string | undefined): GamePlayback {
  const total = moves?.length ?? 0;
  const [shown, setShown] = useState(total);
  const [seenGame, setSeenGame] = useState(gameId);

  // On a new game (or once its data first arrives), jump to the current
  // position instead of replaying from move 1. Storing the previous prop in
  // state and adjusting during render is React's recommended pattern for
  // "reset state when a prop changes" — no effect, no cascade.
  if (gameId !== seenGame) {
    setSeenGame(gameId);
    setShown(total);
  }

  // Advance one move at a time toward the latest, faster the further behind the
  // board is: fast engines can produce dozens of moves per tick, and a fixed
  // pace would leave the board minutes behind the real game.
  useEffect(() => {
    if (shown >= total) return;
    const t = setTimeout(() => setShown((n) => Math.min(n + 1, total)), playbackDelay(total - shown));
    return () => clearTimeout(t);
  }, [shown, total]);

  const clamped = Math.min(shown, total);
  const skipToEnd = useCallback(() => setShown(total), [total]);
  return { shownCount: clamped, caughtUp: clamped >= total, skipToEnd };
}
