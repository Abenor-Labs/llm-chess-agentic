"use client";

import { useEffect, useRef, useState } from "react";

export interface Evaluation {
  /** Centipawns from White's perspective (null while mate is reported). */
  cp: number | null;
  /** Moves to mate, positive = White mates. */
  mate: number | null;
  depth: number;
}

/**
 * Live Stockfish evaluation of `fen` in a Web Worker.
 *
 * Every search is fenced with stop + isready: output from the previous search
 * arrives before "readyok", so it can never be attributed (with the wrong
 * sign) to the new position. The last evaluation stays on screen until the new
 * search reports, so the bar doesn't flicker between moves.
 */
export function useStockfish(fen: string, depth = 14): { evaluation: Evaluation | null; ready: boolean } {
  const worker = useRef<Worker | null>(null);
  const [ready, setReady] = useState(false);
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const searching = useRef<{ fen: string; active: boolean }>({ fen: "", active: false });
  const pendingFen = useRef<string | null>(null);

  useEffect(() => {
    let w: Worker;
    try {
      w = new Worker("/stockfish.js");
    } catch {
      return;
    }
    worker.current = w;
    w.onmessage = (e: MessageEvent) => {
      const line = typeof e.data === "string" ? e.data : "";
      if (line === "uciok") w.postMessage("isready");
      else if (line === "readyok") {
        setReady(true);
        const next = pendingFen.current;
        if (next) {
          pendingFen.current = null;
          searching.current = { fen: next, active: true };
          w.postMessage(`position fen ${next}`);
          w.postMessage(`go depth ${depth}`);
        }
      } else if (line.startsWith("info depth") && searching.current.active) {
        const d = Number(line.match(/ depth (\d+)/)?.[1] ?? 0);
        const cp = line.match(/score cp (-?\d+)/);
        const mate = line.match(/score mate (-?\d+)/);
        if (!cp && !mate) return;
        const sign = searching.current.fen.split(" ")[1] === "b" ? -1 : 1;
        setEvaluation({
          cp: cp ? sign * Number(cp[1]) : null,
          mate: mate ? sign * Number(mate[1]) : null,
          depth: d,
        });
      } else if (line.startsWith("bestmove")) {
        searching.current.active = false;
      }
    };
    w.postMessage("uci");
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, [depth]);

  useEffect(() => {
    const w = worker.current;
    if (!w || !ready || !fen) return;
    searching.current.active = false;
    pendingFen.current = fen;
    w.postMessage("stop");
    w.postMessage("isready");
  }, [fen, ready]);

  return { evaluation, ready };
}
