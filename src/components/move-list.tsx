"use client";

import { useEffect, useRef } from "react";
import type { Move } from "@/db/schema";
import { classifyMove, MOVE_CLASS_SYMBOL } from "@/lib/view-model";
import { cn } from "@/lib/utils";

const CLASS_TEXT = { blunder: "text-rose-600", mistake: "text-orange-600", inaccuracy: "text-amber-600" } as const;

/**
 * Numbered move list. Each move is a button that jumps the board there;
 * annotations come from post-game analysis (?!, ?, ??), and a dot marks moves
 * where the judge stepped in.
 */
export function MoveList({ moves, shown, onSelectPly }: { moves: Move[]; shown: number; onSelectPly: (ply: number) => void }) {
  const active = useRef<HTMLButtonElement | null>(null);
  // Keep the current move visible by scrolling the list's own container only —
  // scrollIntoView would also yank the page around on every live move.
  useEffect(() => {
    const el = active.current;
    const box = el?.closest<HTMLElement>("[data-scroll-box]");
    if (!el || !box) return;
    const top = el.offsetTop - box.offsetTop;
    if (top < box.scrollTop) box.scrollTop = top - 8;
    else if (top + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + el.offsetHeight - box.clientHeight + 8;
  }, [shown]);

  if (moves.length === 0) return <p className="px-1 text-sm italic text-slate-400">The game hasn&apos;t started yet.</p>;

  const pairs: Array<[Move, Move | undefined, number]> = [];
  for (let i = 0; i < moves.length; i += 2) pairs.push([moves[i], moves[i + 1], i]);

  const cell = (m: Move | undefined, ply: number) => {
    if (!m) return <span />;
    const cls = classifyMove(m.cpLoss);
    const judged = m.judge && !m.judge.engine && m.judge.events.some((e) => e.type !== "notation");
    const isCurrent = ply === shown;
    return (
      <button
        ref={isCurrent ? active : undefined}
        onClick={() => onSelectPly(ply)}
        className={cn(
          "flex items-center gap-1 rounded px-1.5 py-0.5 text-left font-mono text-sm transition-colors",
          isCurrent ? "bg-slate-900 text-white" : "text-slate-800 hover:bg-slate-100",
          ply > shown && "text-slate-400",
        )}
        aria-current={isCurrent ? "step" : undefined}
        data-testid="move-list-item"
      >
        {m.moveSan}
        {cls && cls !== "good" && <span className={cn("font-bold", !isCurrent && CLASS_TEXT[cls])}>{MOVE_CLASS_SYMBOL[cls]}</span>}
        {judged && <span className="h-1.5 w-1.5 rounded-full bg-violet-500" title="The judge intervened on this move" />}
      </button>
    );
  };

  return (
    <ol className="grid grid-cols-[2.25rem_1fr_1fr] gap-x-1 gap-y-0.5" data-testid="move-list">
      {pairs.map(([w, b, i]) => (
        <li key={w.id} className="contents">
          <span className="py-0.5 text-right font-mono text-xs leading-6 text-slate-400">{w.moveNumber}.</span>
          {cell(w, i + 1)}
          {cell(b, i + 2)}
        </li>
      ))}
    </ol>
  );
}
