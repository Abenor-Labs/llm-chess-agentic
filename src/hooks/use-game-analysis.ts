"use client";

import { useEffect, useRef, useState } from "react";
import { STARTING_FEN } from "@/lib/chess";
import type { Game, Move } from "@/db/schema";

const ANALYSIS_DEPTH = 12;
const PER_POSITION_TIMEOUT_MS = 15_000;

export interface AnalysisProgress {
  done: number;
  total: number;
}

/** Waits for the Stockfish worker to report `readyok`. */
function waitReady(worker: Worker): Promise<void> {
  return new Promise((resolve) => {
    const onMessage = (e: MessageEvent) => {
      const line = typeof e.data === "string" ? e.data : "";
      if (line === "uciok") worker.postMessage("isready");
      if (line === "readyok") {
        worker.removeEventListener("message", onMessage);
        resolve();
      }
    };
    worker.addEventListener("message", onMessage);
    worker.postMessage("uci");
  });
}

/** Evaluates a single FEN to a fixed depth; returns centipawns from White's perspective. */
function evaluateFen(worker: Worker, fen: string, depth: number): Promise<number> {
  return new Promise((resolve) => {
    let lastCp = 0;
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const isBlackToMove = fen.split(" ")[1] === "b";

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
      // Stockfish reports from the side-to-move's perspective; normalize to White.
      resolve(isBlackToMove ? -lastCp : lastCp);
    };

    const onMessage = (e: MessageEvent) => {
      const line = typeof e.data === "string" ? e.data : "";
      if (line.startsWith("info")) {
        const cp = line.match(/score cp (-?\d+)/);
        const mate = line.match(/score mate (-?\d+)/);
        if (cp) lastCp = parseInt(cp[1], 10);
        else if (mate) lastCp = parseInt(mate[1], 10) > 0 ? 100000 : -100000;
      }
      if (line.startsWith("bestmove")) finish();
    };

    const start = () => {
      timer = setTimeout(finish, PER_POSITION_TIMEOUT_MS);
      worker.addEventListener("message", onMessage);
      worker.postMessage(`position fen ${fen}`);
      worker.postMessage(`go depth ${depth}`);
    };

    // Synchronize before searching: if a previous search is still running (e.g.
    // the prior evaluateFen resolved via its timeout), "stop" flushes it and its
    // stale bestmove/info lines land BEFORE "readyok" — so a listener attached
    // after readyok can never consume the old search's output.
    const onReady = (e: MessageEvent) => {
      if (e.data === "readyok") {
        worker.removeEventListener("message", onReady);
        start();
      }
    };
    worker.addEventListener("message", onReady);
    worker.postMessage("stop");
    worker.postMessage("isready");
  });
}

/**
 * Runs post-game Stockfish analysis in the browser for a completed, not-yet-analyzed
 * game: evaluates every position, POSTs the evals to the server (which computes and
 * persists per-move centipawn loss / accuracy), then calls `onComplete`.
 *
 * Returns live progress while analyzing, or null when idle/done.
 */
export function useGameAnalysis(
  game: Pick<Game, "id" | "status" | "analyzed"> | undefined,
  moves: Pick<Move, "id" | "fenAfter">[] | undefined,
  onComplete?: () => void
): AnalysisProgress | null {
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const startedForGame = useRef<string | null>(null);

  const eligible =
    !!game && game.status === "complete" && !game.analyzed && !!moves && moves.length > 0;

  useEffect(() => {
    if (!eligible || !game || !moves) return;
    if (startedForGame.current === game.id) return; // run once per game
    startedForGame.current = game.id;

    let cancelled = false;
    let completed = false;
    let worker: Worker | null = null;

    (async () => {
      try {
        worker = new Worker("/stockfish.js");
        await waitReady(worker);

        const positions = [STARTING_FEN, ...moves.map((m) => m.fenAfter)];
        const total = positions.length;
        const cps: number[] = [];
        for (let i = 0; i < positions.length; i++) {
          if (cancelled) return;
          cps.push(await evaluateFen(worker, positions[i], ANALYSIS_DEPTH));
          setProgress({ done: i + 1, total });
        }

        const body = {
          startEvalCp: cps[0],
          evals: moves.map((m, i) => ({ moveId: m.id, evalCp: cps[i + 1] })),
        };
        const res = await fetch(`/api/games/${game.id}/analysis`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) completed = true;
        if (res.ok && !cancelled) onComplete?.();
      } catch (err) {
        console.error("[useGameAnalysis] failed:", err);
        startedForGame.current = null; // allow a retry on next mount
      } finally {
        worker?.terminate();
        if (!cancelled) setProgress(null);
      }
    })();

    return () => {
      cancelled = true;
      worker?.terminate();
      // If this run was cancelled before finishing (e.g. StrictMode's
      // mount-cleanup-remount in dev), let the next mount start over.
      if (!completed) startedForGame.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, game?.id, moves?.length]);

  return progress;
}
