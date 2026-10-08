"use client";

import { useStockfish, type Evaluation } from "@/hooks/use-stockfish";
import { cn } from "@/lib/utils";

/** White's share of the bar, 0..100. Logistic so ±4 pawns already reads as "winning". */
export function whiteShare(e: Evaluation | null): number {
  if (!e) return 50;
  if (e.mate !== null) return e.mate > 0 ? 100 : e.mate < 0 ? 0 : 50;
  const cp = e.cp ?? 0;
  return 100 / (1 + Math.exp(-0.004 * cp));
}

export function evalLabel(e: Evaluation | null): string {
  if (!e) return "…";
  if (e.mate !== null) return e.mate === 0 ? "#" : `M${Math.abs(e.mate)}`;
  const pawns = (e.cp ?? 0) / 100;
  return `${pawns > 0 ? "+" : ""}${pawns.toFixed(1)}`;
}

export function EvalBar({ fen, orientation = "white", className }: { fen: string; orientation?: "white" | "black"; className?: string }) {
  const { evaluation } = useStockfish(fen);
  const share = whiteShare(evaluation);
  const whiteAhead = share >= 50;
  return (
    <div
      className={cn("relative w-5 overflow-hidden rounded bg-slate-800 ring-1 ring-slate-900/20", className)}
      title={evaluation ? `Stockfish: ${evalLabel(evaluation)} (depth ${evaluation.depth})` : "Stockfish is warming up"}
      data-testid="eval-bar"
    >
      <div
        className={cn("absolute inset-x-0 bg-slate-50 transition-[height] duration-500 ease-out", orientation === "white" ? "bottom-0" : "top-0")}
        style={{ height: `${share}%` }}
      />
      <span
        className={cn(
          "absolute inset-x-0 text-center text-[9px] font-bold tabular-nums",
          whiteAhead === (orientation === "white") ? "bottom-1" : "top-1",
          whiteAhead ? "text-slate-800" : "text-slate-100",
        )}
      >
        {evalLabel(evaluation)}
      </span>
    </div>
  );
}
